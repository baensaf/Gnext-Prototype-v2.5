import { AgentHealthService } from '../src/modules/agent-gateway/agent-health.service';
import { AgentSessionsService } from '../src/modules/agent-gateway/agent-sessions.service';
import { readTillReport } from '../src/modules/agent-gateway/agent-connection';

/** §16.10, §18.7: the web POS steps aside on a register the branch agent's Gnext POS serves. */
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
    till: { terminal_id: TILL, mode: 'ONLINE', open_orders: 0, registers: [], lan_url: null, reported_at: '' },
    ...over,
  });

  it('says yes for the register a connected till agent is bound to', () => {
    expect(serviceWith([agent()]).tillServedByAgent(TENANT, TILL)).toEqual({ agent_id: 'a1', url: 'http://127.0.0.1:47800/till/' });
  });

  it('says no for another register, another tenant, or an agent without pos.till', () => {
    expect(serviceWith([agent()]).tillServedByAgent(TENANT, '33333333-3333-3333-3333-333333333333')).toBeNull();
    expect(serviceWith([agent({ tenantId: 'other' })]).tillServedByAgent(TENANT, TILL)).toBeNull();
    expect(serviceWith([agent({ capabilities: ['pos.offline'] })]).tillServedByAgent(TENANT, TILL)).toBeNull();
    expect(serviceWith([agent({ till: null })]).tillServedByAgent(TENANT, TILL)).toBeNull();
  });

  it('says yes for a device paired on the LAN, with the LAN address', () => {
    const DEVICE = '44444444-4444-4444-4444-444444444444';
    const svc = serviceWith([
      agent({
        till: {
          terminal_id: TILL, mode: 'ONLINE', open_orders: 0, reported_at: '',
          registers: [{ terminal_id: TILL, kind: 'PC', device_name: null }, { terminal_id: DEVICE, kind: 'DEVICE', device_name: 'Tablet' }],
          lan_url: 'http://192.168.1.10:47801/till/',
        },
      }),
    ]);
    expect(svc.tillServedByAgent(TENANT, DEVICE)).toEqual({ agent_id: 'a1', url: 'http://192.168.1.10:47801/till/' });
  });
});

describe('readTillReport', () => {
  it('keeps well-formed registers and a LAN address, and drops the rest', () => {
    const id = '55555555-5555-5555-5555-555555555555';
    const r = readTillReport({
      terminal_id: id, mode: 'OFFLINE', open_orders: 2,
      registers: [{ terminal_id: id, kind: 'PC' }, { terminal_id: 'nope', kind: 'DEVICE' }, { terminal_id: id, kind: 'DEVICE', device_name: 'x'.repeat(80) }],
      lan_url: 'http://192.168.1.10:47801/till/',
    });
    expect(r?.registers).toEqual([{ terminal_id: id, kind: 'PC', device_name: null }, { terminal_id: id, kind: 'DEVICE', device_name: 'x'.repeat(60) }]);
    expect(r?.lan_url).toBe('http://192.168.1.10:47801/till/');
    expect(readTillReport({ lan_url: 'javascript:alert(1)' })?.lan_url).toBeNull();
    expect(readTillReport({})?.registers).toEqual([]);
  });
});
