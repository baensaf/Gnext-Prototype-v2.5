import { AgentConnection, AgentConnectionDeps, AgentSocket } from '../src/modules/agent-gateway/agent-connection';
import { AgentMessageHandlers } from '../src/modules/agent-gateway/agent-message-handlers.service';
import { compareVersions, negotiateVersion, parseFrame } from '../src/modules/agent-gateway/agent-protocol';
import { AgentSessionsService } from '../src/modules/agent-gateway/agent-sessions.service';
import { fakeHandle } from './utils/agent-fakes';

const agent: any = { id: 'agent-1', tenant_id: 'tenant-1', branch_id: 'branch-1', status: 'ACTIVE' };
const config = { config_version: 1, printers: [], terminals: [] };

class FakeSocket implements AgentSocket {
  sent: any[] = [];
  closed: { code: number; reason: string } | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
  }
  isOpen() {
    return !this.closed;
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
  ofType(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
}

const frame = (type: string, payload: Record<string, any> = {}, id = `m-${type}-${Math.random()}`) =>
  JSON.stringify({ v: 1, id, type, ts: new Date().toISOString(), payload });
const hello = (payload: Record<string, any> = {}) =>
  frame('hello', { agent_version: '1.0.0', protocol_versions: [1], capabilities: ['print.html'], ...payload }, 'hello-1');

describe('agent connection (protocol §4)', () => {
  let socket: FakeSocket;
  let sessions: AgentSessionsService;
  let handlers: AgentMessageHandlers;
  let deps: AgentConnectionDeps;
  let recordHello: jest.Mock;
  let touch: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    socket = new FakeSocket();
    sessions = new AgentSessionsService();
    handlers = new AgentMessageHandlers();
    recordHello = jest.fn().mockResolvedValue(true);
    touch = jest.fn().mockResolvedValue(undefined);
    deps = {
      sessions,
      handlers,
      loadConfig: jest.fn().mockResolvedValue(config),
      branchName: jest.fn().mockResolvedValue('Vanak'),
      recordHello,
      touch,
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const open = async (extraDeps: Partial<AgentConnectionDeps> = {}) => {
    const conn = new AgentConnection(socket, agent, { ...deps, ...extraDeps });
    await conn.onFrame(hello());
    return conn;
  };

  describe('handshake', () => {
    it('answers hello with welcome, then registers the connection', async () => {
      const conn = await open();

      const welcome = socket.last();
      expect(welcome).toMatchObject({
        v: 1,
        type: 'welcome',
        ref: 'hello-1',
        payload: {
          protocol_version: 1,
          heartbeat_interval_s: 20,
          branch: { id: 'branch-1', name: 'Vanak' },
          config,
          update: { available: false },
        },
      });
      expect(Date.parse(welcome.payload.server_time)).not.toBeNaN();
      expect(welcome.payload.session_id).toEqual(expect.any(String));
      expect(conn.isOpen).toBe(true);
      expect(recordHello).toHaveBeenCalledWith(agent, { agentVersion: '1.0.0', protocolVersion: 1 });

      const handle = sessions.forBranch('tenant-1', 'branch-1')!;
      expect(handle).toMatchObject({ agentId: 'agent-1', agentVersion: '1.0.0', capabilities: ['print.html'] });
      expect(handle.sessionId).toBe(welcome.payload.session_id);
    });

    it('keeps the device list the agent reports in hello', async () => {
      const conn = new AgentConnection(socket, agent, deps);
      await conn.onFrame(
        hello({ devices: [{ kind: 'printer', id: 'p1', status: 'online' }, { kind: 'toaster', id: 'x', status: 'ONLINE' }] }),
      );
      const devices = [...conn.connectionHandle!.devices.values()];
      expect(devices).toEqual([expect.objectContaining({ kind: 'printer', id: 'p1', status: 'ONLINE' })]);
    });

    it('refuses anything before hello, and keeps the socket', async () => {
      const conn = new AgentConnection(socket, agent, deps);
      await conn.onFrame(frame('heartbeat', {}, 'early'));
      expect(socket.last()).toMatchObject({ type: 'error', ref: 'early', payload: { code: 'NOT_READY' } });
      expect(socket.closed).toBeNull();
    });

    it('closes with 4000 when hello does not come within 10 s', () => {
      new AgentConnection(socket, agent, deps);
      jest.advanceTimersByTime(9_999);
      expect(socket.closed).toBeNull();
      jest.advanceTimersByTime(1);
      expect(socket.closed).toEqual({ code: 4000, reason: 'HANDSHAKE_TIMEOUT' });
    });

    it('closes with 4010 when no protocol version is shared', async () => {
      const conn = new AgentConnection(socket, agent, deps);
      await conn.onFrame(hello({ protocol_versions: [2, 3] }));
      expect(socket.closed?.code).toBe(4010);
      expect(sessions.isConnected('agent-1')).toBe(false);
    });

    it('closes with 4011 when the agent is older than the minimum', async () => {
      await open({ minAgentVersion: '1.2.0' });
      expect(socket.closed?.code).toBe(4011);
      expect(recordHello).not.toHaveBeenCalled();
    });

    it('closes with 4003 when the agent was revoked during the handshake', async () => {
      recordHello.mockResolvedValue(false);
      await open();
      expect(socket.closed?.code).toBe(4003);
      expect(socket.ofType('welcome')).toHaveLength(0);
      expect(sessions.isConnected('agent-1')).toBe(false);
    });

    it('does not register a socket that closed while the handshake loaded', async () => {
      (deps.loadConfig as jest.Mock).mockImplementation(async () => {
        socket.closed = { code: 1006, reason: '' };
        return config;
      });
      await open();
      expect(sessions.isConnected('agent-1')).toBe(false);
    });

    it('closes the older connection with 4008 when the agent connects again', async () => {
      const first = await open();
      const firstSocket = socket;

      socket = new FakeSocket();
      const second = await open();

      expect(firstSocket.closed).toEqual({ code: 4008, reason: 'REPLACED' });
      expect(first.isOpen).toBe(false);
      expect(second.isOpen).toBe(true);
      expect(sessions.get('agent-1')).toBe(second.connectionHandle);
    });
  });

  describe('after welcome', () => {
    it('answers each heartbeat and stamps last seen', async () => {
      const conn = await open();
      await conn.onFrame(frame('heartbeat', { in_flight: 0 }, 'hb-1'));
      expect(socket.last()).toMatchObject({ type: 'heartbeat.ack', ref: 'hb-1' });
      expect(Date.parse(socket.last().payload.server_time)).not.toBeNaN();
      expect(touch).toHaveBeenCalledWith(agent);
    });

    it('closes an agent that goes quiet for three heartbeat intervals', async () => {
      await open();
      jest.advanceTimersByTime(55_000);
      expect(socket.closed).toBeNull();
      jest.advanceTimersByTime(10_000);
      expect(socket.closed).toEqual({ code: 1001, reason: 'HEARTBEAT_TIMEOUT' });
      expect(sessions.isConnected('agent-1')).toBe(false);
    });

    it('keeps an agent that keeps talking', async () => {
      const conn = await open();
      for (let i = 0; i < 10; i++) {
        jest.advanceTimersByTime(20_000);
        await conn.onFrame(frame('heartbeat'));
      }
      expect(socket.closed).toBeNull();
    });

    it('records device status and acks it', async () => {
      const conn = await open();
      await conn.onFrame(
        frame('device.status', { devices: [{ kind: 'terminal', id: 't1', status: 'OFFLINE', detail: 'timeout' }] }, 'ds-1'),
      );
      expect(socket.last()).toMatchObject({ type: 'ack', ref: 'ds-1', payload: { ok: true } });
      expect(conn.connectionHandle!.devices.get('terminal:t1')).toMatchObject({ status: 'OFFLINE', detail: 'timeout' });
    });

    it('answers a malformed frame with an error and stays open', async () => {
      const conn = await open();
      await conn.onFrame('{not json');
      expect(socket.last()).toMatchObject({ type: 'error', ref: null, payload: { code: 'BAD_MESSAGE' } });
      await conn.onFrame(JSON.stringify({ v: 1, id: 'x1' }));
      expect(socket.last()).toMatchObject({ type: 'error', ref: 'x1', payload: { code: 'BAD_MESSAGE' } });
      expect(socket.closed).toBeNull();
    });

    it('refuses a type nobody handles, but never acks an ack', async () => {
      const conn = await open();
      await conn.onFrame(frame('sync.orders', {}, 'u-1'));
      expect(socket.last()).toMatchObject({ type: 'ack', ref: 'u-1', payload: { ok: false, error: { code: 'UNKNOWN_TYPE' } } });

      const count = socket.sent.length;
      await conn.onFrame(frame('ack', { ok: true }));
      expect(socket.sent).toHaveLength(count);
    });

    it('hands a message to its handler and acks with what the handler says', async () => {
      const handler = jest.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
      handlers.register('print.result', handler);
      const conn = await open();

      await conn.onFrame(frame('print.result', { job_id: 'j' }, 'r-1'));
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'r-1', payload: { job_id: 'j' } }), conn.connectionHandle);
      expect(socket.last()).toMatchObject({ type: 'ack', ref: 'r-1', payload: { ok: true } });

      await conn.onFrame(frame('print.result', {}, 'r-2'));
      expect(socket.last()).toMatchObject({ ref: 'r-2', payload: { ok: false, error: { code: 'INVALID_PAYLOAD' } } });
    });

    it('passes acks to their handler without answering them', async () => {
      const handler = jest.fn().mockResolvedValue({ ok: true });
      handlers.register('ack', handler);
      const conn = await open();
      const count = socket.sent.length;
      await conn.onFrame(frame('ack', { ok: true }));
      expect(handler).toHaveBeenCalled();
      expect(socket.sent).toHaveLength(count);
    });

    it('acks INTERNAL when a handler throws, and stays open', async () => {
      handlers.register('payment.result', () => {
        throw new Error('db down');
      });
      const conn = await open();
      await conn.onFrame(frame('payment.result', {}, 'p-1'));
      expect(socket.last()).toMatchObject({ ref: 'p-1', payload: { ok: false, error: { code: 'INTERNAL' } } });
      expect(conn.isOpen).toBe(true);
    });

    it('goes offline when the socket closes, and says so once', async () => {
      const events: string[] = [];
      sessions.onPresence((e, h) => events.push(`${e}:${h.agentId}`));
      const conn = await open();
      conn.onClosed();
      conn.onClosed();
      expect(events).toEqual(['online:agent-1', 'offline:agent-1']);
      expect(sessions.forBranch('tenant-1', 'branch-1')).toBeUndefined();
    });

    it('does not tell anyone the agent went offline when it was only replaced', async () => {
      const events: string[] = [];
      sessions.onPresence((e) => events.push(e));
      await open();
      socket = new FakeSocket();
      await open();
      expect(events).toEqual(['online']);
    });
  });

  describe('sessions', () => {
    it('finds a branch agent only within its tenant', () => {
      const s = new AgentSessionsService();
      s.register(fakeHandle('a', jest.fn(), { tenantId: 't1', branchId: 'b1' }));
      expect(s.forBranch('t1', 'b1')?.agentId).toBe('a');
      expect(s.forBranch('t2', 'b1')).toBeUndefined();
    });

    it('closes everyone on shutdown', () => {
      const s = new AgentSessionsService();
      const a = jest.fn();
      const b = jest.fn();
      s.register(fakeHandle('a', a));
      s.register(fakeHandle('b', b));
      s.closeAll(1012, 'SERVICE_RESTART');
      expect(a).toHaveBeenCalledWith(1012, 'SERVICE_RESTART');
      expect(b).toHaveBeenCalledWith(1012, 'SERVICE_RESTART');
      expect(s.all()).toHaveLength(0);
    });
  });

  describe('protocol helpers', () => {
    it('compares versions numerically', () => {
      expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
      expect(compareVersions('1.0', '1.0.0')).toBe(0);
      expect(compareVersions('v1.0.0-beta', '1.0.1')).toBe(-1);
    });

    it('picks the highest shared protocol version', () => {
      expect(negotiateVersion([1])).toBe(1);
      expect(negotiateVersion([1, 2], [1, 2])).toBe(2);
      expect(negotiateVersion([2])).toBeNull();
      expect(negotiateVersion('1')).toBeNull();
    });

    it('treats a missing payload as empty and keeps the id for the error reply', () => {
      expect(parseFrame('{"v":1,"id":"a","type":"heartbeat"}')).toMatchObject({ ok: true, message: { payload: {} } });
      expect(parseFrame('{"v":1,"id":"a"}')).toEqual({ ok: false, error: 'missing field: type', ref: 'a' });
      expect(parseFrame('[]')).toMatchObject({ ok: false });
    });
  });
});
