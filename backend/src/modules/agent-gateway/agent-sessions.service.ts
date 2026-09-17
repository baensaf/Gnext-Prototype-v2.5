import { Injectable } from '@nestjs/common';
import { AGENT_CLOSE, Envelope } from './agent-protocol';

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
    this.emit('offline', handle);
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
