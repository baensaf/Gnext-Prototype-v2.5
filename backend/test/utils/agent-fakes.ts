import { AgentConnectionHandle } from '../../src/modules/agent-gateway/agent-sessions.service';

/**
 * A connection handle whose close is the given spy. The tenant and branch are well-formed ids
 * that match nothing, so a real app that reacts to the handle (a replay flush) finds no rows.
 */
export function fakeHandle(agentId: string, close: jest.Mock, extra: Partial<AgentConnectionHandle> = {}): AgentConnectionHandle {
  return {
    agentId,
    tenantId: '00000000-0000-4000-8000-00000000000a',
    branchId: '00000000-0000-4000-8000-00000000000b',
    sessionId: 's-' + agentId,
    agentVersion: '1.0.0',
    capabilities: [],
    connectedAt: new Date(),
    send: jest.fn(() => true),
    close,
    ...extra,
  };
}
