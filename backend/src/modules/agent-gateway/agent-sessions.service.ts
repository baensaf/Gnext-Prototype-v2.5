import { Injectable } from '@nestjs/common';

/** Closes one live agent connection with a WebSocket close code (protocol §4.9). */
export type AgentConnectionCloser = (code: number, reason: string) => void;

export const AGENT_CLOSE = {
  REVOKED: 4003,
  REPLACED: 4008,
} as const;

/**
 * The agents that hold a connection to this process right now. The WebSocket gateway
 * registers each socket here; revoking an agent closes its socket through the same map, so
 * a revoked PC is cut off in the request that revoked it rather than at its next heartbeat.
 *
 * In memory on purpose: the backend runs as a single container. A second instance would need
 * this to become a shared channel.
 */
@Injectable()
export class AgentSessionsService {
  private readonly connections = new Map<string, Set<AgentConnectionCloser>>();

  register(agentId: string, close: AgentConnectionCloser): () => void {
    let set = this.connections.get(agentId);
    if (!set) {
      set = new Set();
      this.connections.set(agentId, set);
    }
    set.add(close);
    return () => {
      const current = this.connections.get(agentId);
      if (!current) return;
      current.delete(close);
      if (current.size === 0) this.connections.delete(agentId);
    };
  }

  isConnected(agentId: string): boolean {
    return (this.connections.get(agentId)?.size ?? 0) > 0;
  }

  /** Closes every connection the agent holds. Returns how many were closed. */
  closeAgent(agentId: string, code: number, reason: string): number {
    const set = this.connections.get(agentId);
    if (!set) return 0;
    this.connections.delete(agentId);
    for (const close of set) {
      try {
        close(code, reason);
      } catch {
        // A socket that is already gone has nothing left to close.
      }
    }
    return set.size;
  }
}
