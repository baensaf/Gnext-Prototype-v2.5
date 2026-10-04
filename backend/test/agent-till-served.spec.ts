import { AgentHealthService } from '../src/modules/agent-gateway/agent-health.service';
import { AgentSessionsService } from '../src/modules/agent-gateway/agent-sessions.service';

/** §16.10: the web POS steps aside on a register the branch PC's Gnext POS serves. */
describe('AgentHealthService.tillServedByAgent', () => {
  const TENANT = '11111111-1111-1111-1111-111111111111';
  const TILL = '22222222-2222-2222-2222-222222222222';

  function serviceWith(handles: object[]) {
    const sessions = new AgentSessionsService();
    for (const h of handles) sessions.register({ close: () => undefined, send: () => true, ...h } as any);
    const none = undefined as any;
    return new AgentHealthService(none, none, none, none, none, sessions, none, none);
  }

  const agent = (over: object = {}) => ({
    agentId: 'a1',
    sessionId: 's1',
    tenantId: TENANT,
    branchId: 'b1',
    capabilities: ['pos.offline', 'pos.till'],
    till: { terminal_id: TILL, mode: 'ONLINE', open_orders: 0, reported_at: '' },
    ...over,
  });

  it('says yes for the register a connected till agent is bound to', () => {
    expect(serviceWith([agent()]).tillServedByAgent(TENANT, TILL)).toEqual({ agent_id: 'a1' });
  });

  it('says no for another register, another tenant, or an agent without pos.till', () => {
    expect(serviceWith([agent()]).tillServedByAgent(TENANT, '33333333-3333-3333-3333-333333333333')).toBeNull();
    expect(serviceWith([agent({ tenantId: 'other' })]).tillServedByAgent(TENANT, TILL)).toBeNull();
    expect(serviceWith([agent({ capabilities: ['pos.offline'] })]).tillServedByAgent(TENANT, TILL)).toBeNull();
    expect(serviceWith([agent({ till: null })]).tillServedByAgent(TENANT, TILL)).toBeNull();
  });
});
