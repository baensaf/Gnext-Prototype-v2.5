import { Injectable } from '@nestjs/common';
import { AGENT_CLOSE, Envelope, envelope } from './agent-protocol';

export { AGENT_CLOSE };

/** One live, handshaken agent connection, as the rest of the backend sees it. */
export interface AgentConnectionHandle {
  agentId: string;
  tenantId: string;
  branchId: string;
  sessionId: string;
  agentVersion: string | null;
  capabilities: string[];
  connectedAt: Date;
  /** Sends one envelope. Returns false when the socket is no longer open. */
  send(message: Envelope): boolean;
  /** Closes the socket with a protocol close code (§4.9). */
  close(code: number, reason: string): void;
}

/** The questions an agent answers live (agent.query, protocol §20). */
export type AgentQueryName = 'scan' | 'logs' | 'settings' | 'app.refresh';

/** Why a live query got no data: the agent is away, too old, said no, or did not answer in time. */
export class AgentQueryError extends Error {
  constructor(
    readonly code: 'AGENT_OFFLINE' | 'AGENT_TOO_OLD' | 'AGENT_QUERY_FAILED' | 'AGENT_NO_ANSWER',
    message: string,
  ) {
    super(message);
  }
}

type PendingQuery = { agentId: string; resolve: (data: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout };

export type AgentPresenceListener = (event: 'online' | 'offline', handle: AgentConnectionHandle) => void;

/**
 * The agents connected to this process right now: one connection per agent, and so at most
 * one per branch. The WebSocket gateway adds a connection after `welcome` and removes it when
 * the socket closes. Revoking an agent closes its connection through this map, so a revoked
 * PC is cut off in the request that revoked it rather than at its next heartbeat.
 *
 * In memory on purpose: the backend runs as a single container. A second instance would need
 * this to become a shared channel.
 */
@Injectable()
export class AgentSessionsService {
  private readonly byAgent = new Map<string, AgentConnectionHandle>();
  private readonly listeners = new Set<AgentPresenceListener>();
  private readonly queries = new Map<string, PendingQuery>();

  /**
   * Makes `handle` the agent's connection. An older connection for the same agent is closed
   * with 4008 REPLACED (§4.2). Returns the function that removes this handle again.
   */
  register(handle: AgentConnectionHandle): () => void {
    const previous = this.byAgent.get(handle.agentId);
    this.byAgent.set(handle.agentId, handle);
    if (previous && previous !== handle) {
      safeClose(previous, AGENT_CLOSE.REPLACED, 'REPLACED');
    }
    if (!previous) this.emit('online', handle);
    return () => this.unregister(handle);
  }

  unregister(handle: AgentConnectionHandle): void {
    if (this.byAgent.get(handle.agentId) !== handle) return;
    this.byAgent.delete(handle.agentId);
    // A query whose agent left is not coming back: say so now rather than at the timeout.
    for (const [id, pending] of this.queries) {
      if (pending.agentId !== handle.agentId) continue;
      this.queries.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new AgentQueryError('AGENT_OFFLINE', 'The branch agent went offline before it answered.'));
    }
    this.emit('offline', handle);
  }

  /**
   * Asks the agent something and waits for the answer (protocol §20). Nothing is stored: a query
   * that is not answered in time is the person's to ask again.
   */
  query(handle: AgentConnectionHandle, query: AgentQueryName, args: Record<string, any> = {}, timeoutMs = 45_000): Promise<any> {
    if (!handle.capabilities.includes('agent.query')) {
      return Promise.reject(new AgentQueryError('AGENT_TOO_OLD', 'The branch agent is too old for this. Update it to 2.5.0 or later.'));
    }
    const message = envelope('agent.query', { expires_at: new Date(Date.now() + timeoutMs).toISOString(), query, args });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.queries.delete(message.id);
        reject(new AgentQueryError('AGENT_NO_ANSWER', 'The branch agent did not answer in time.'));
      }, timeoutMs);
      this.queries.set(message.id, { agentId: handle.agentId, resolve, reject, timer });
      if (!handle.send(message)) {
        this.queries.delete(message.id);
        clearTimeout(timer);
        reject(new AgentQueryError('AGENT_OFFLINE', 'The branch agent is offline.'));
      }
    });
  }

  /** An agent.query.result came in; `ref` is the query's id. One nobody waits for is dropped. */
  answerQuery(agentId: string, ref: string | null, payload: Record<string, any>): void {
    const pending = ref ? this.queries.get(ref) : undefined;
    if (!pending || pending.agentId !== agentId) return;
    this.queries.delete(ref!);
    clearTimeout(pending.timer);
    if (payload?.ok) pending.resolve(payload.data ?? null);
    else pending.reject(new AgentQueryError('AGENT_QUERY_FAILED', payload?.error?.message || 'The branch agent could not do it.'));
  }

  get(agentId: string): AgentConnectionHandle | undefined {
    return this.byAgent.get(agentId);
  }

  isConnected(agentId: string): boolean {
    return this.byAgent.has(agentId);
  }

  /** The branch's live agent, if it has one. */
  forBranch(tenantId: string, branchId: string): AgentConnectionHandle | undefined {
    for (const handle of this.byAgent.values()) {
      if (handle.tenantId === tenantId && handle.branchId === branchId) return handle;
    }
    return undefined;
  }

  all(): AgentConnectionHandle[] {
    return [...this.byAgent.values()];
  }

  /** Closes the agent's connection, if any. Returns whether there was one. */
  closeAgent(agentId: string, code: number, reason: string): boolean {
    const handle = this.byAgent.get(agentId);
    if (!handle) return false;
    this.unregister(handle);
    safeClose(handle, code, reason);
    return true;
  }

  closeAll(code: number, reason: string): void {
    for (const handle of [...this.byAgent.values()]) this.closeAgent(handle.agentId, code, reason);
  }

  /** Online/offline changes. Replacing a connection is neither. */
  onPresence(listener: AgentPresenceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: 'online' | 'offline', handle: AgentConnectionHandle) {
    for (const listener of this.listeners) {
      try {
        listener(event, handle);
      } catch {
        // A listener's failure is its own; presence has still changed.
      }
    }
  }
}

function safeClose(handle: AgentConnectionHandle, code: number, reason: string) {
  try {
    handle.close(code, reason);
  } catch {
    // A socket that is already gone has nothing left to close.
  }
}
