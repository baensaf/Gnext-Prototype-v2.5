import { AgentConnectionHandle } from '../../src/modules/agent-gateway/agent-sessions.service';

/** A connection handle whose close is the given spy. */
export function fakeHandle(agentId: string, close: jest.Mock, extra: Partial<AgentConnectionHandle> = {}): AgentConnectionHandle {
  return {
    agentId,
    tenantId: 't',
    branchId: 'b',
    sessionId: 's-' + agentId,
    agentVersion: '1.0.0',
    capabilities: [],
    connectedAt: new Date(),
    send: jest.fn(() => true),
    close,
    ...extra,
  };
}
