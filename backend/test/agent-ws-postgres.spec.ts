import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Agent } from '../src/entities/Agent.entity';
import { Printer } from '../src/entities/Printer.entity';
import { AgentEnrolmentService } from '../src/modules/agent-gateway/agent-enrolment.service';
import { AgentRegistryService } from '../src/modules/agent-gateway/agent-registry.service';
import { AgentSessionsService } from '../src/modules/agent-gateway/agent-sessions.service';
import { deleteTenantData } from './utils/tenant-teardown';
import { TestAgent, upgradeStatus } from './utils/agent-client';

// The gateway over a real socket on a real port, backed by the real database.
describe('agent WebSocket gateway (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let enrolment: AgentEnrolmentService;
  let registry: AgentRegistryService;
  let sessions: AgentSessionsService;
  let base: string;
  let tenantId: string;
  let branchId: string;
  const open: TestAgent[] = [];

  const newAgent = async () => {
    const { code } = await registry.createEnrolmentCode(tenantId, branchId, {});
    return enrolment.enrol({ code, agent_version: '1.0.0', protocol_version: 1 }, { clientKey: 'test', wsUrl: '' });
  };
  const connect = (key?: string, path = '/api/v1/agent/ws') => {
    const a = new TestAgent(`${base}${path}`, key);
    open.push(a);
    return a;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    base = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    dataSource = moduleRef.get(DataSource);
    enrolment = moduleRef.get(AgentEnrolmentService);
    registry = moduleRef.get(AgentRegistryService);
    sessions = moduleRef.get(AgentSessionsService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (
      await save(Tenant, { code: `AGENTWS-${Date.now()}`, name: 'Agent WS fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'AWS', name: 'Gateway branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    await save(Printer, { tenant_id: tenantId, branch_id: branchId, code: 'KIT1', name: 'Kitchen', printer_type: 'KITCHEN_IMPACT', is_active: true });
  }, 60000);

  afterEach(() => {
    for (const a of open.splice(0)) a.ws.terminate();
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('refuses the upgrade without a valid key, before any socket exists', async () => {
    expect(await upgradeStatus(`${base}/api/v1/agent/ws`)).toBe(401);
    expect(await upgradeStatus(`${base}/api/v1/agent/ws`, { Authorization: 'Bearer gak_' + 'x'.repeat(43) })).toBe(401);
    expect(await upgradeStatus(`${base}/api/v1/something-else`)).toBe(404);
  });

  it('refuses a revoked key with 403', async () => {
    const { device_key, agent_id } = await newAgent();
    await registry.revokeAgent(tenantId, agent_id, 'test', {});
    expect(await upgradeStatus(`${base}/api/v1/agent/ws`, { Authorization: `Bearer ${device_key}` })).toBe(403);
  });

  it('welcomes an enrolled agent with its branch and hardware, and answers heartbeats', async () => {
    const { device_key, agent_id } = await newAgent();
    const agent = connect(device_key);

    const welcome = await agent.handshake();

    expect(welcome.payload).toMatchObject({
      protocol_version: 1,
      heartbeat_interval_s: 20,
      branch: { id: branchId, name: 'Gateway branch' },
    });
    expect(welcome.payload.config.printers).toEqual([
      expect.objectContaining({ code: 'KIT1', type: 'KITCHEN_IMPACT', active: true, connection: null }),
    ]);
    expect(sessions.forBranch(tenantId, branchId)?.agentId).toBe(agent_id);
    const row = await dataSource.getRepository(Agent).findOneByOrFail({ id: agent_id });
    expect(row).toMatchObject({ agent_version: '1.0.0', protocol_version: 1 });

    const hb = agent.send('heartbeat', { in_flight: 0, unacked_results: 0 });
    await agent.next((m) => m.type === 'heartbeat.ack' && m.ref === hb);

    const ds = agent.send('device.status', { devices: [{ kind: 'printer', id: 'p', status: 'ONLINE' }] });
    await expect(agent.next((m) => m.type === 'ack' && m.ref === ds)).resolves.toMatchObject({ payload: { ok: true } });
  });

  it('cuts the agent off with 4003 the moment head office revokes it', async () => {
    const { device_key, agent_id } = await newAgent();
    const agent = connect(device_key);
    await agent.handshake();

    await registry.revokeAgent(tenantId, agent_id, 'stolen PC', {});

    await expect(agent.closed).resolves.toEqual({ code: 4003, reason: 'AGENT_REVOKED' });
    expect(sessions.isConnected(agent_id)).toBe(false);
  });

  it('keeps only the newest connection of an agent, and closes the older with 4008', async () => {
    const { device_key, agent_id } = await newAgent();
    const first = connect(device_key);
    await first.handshake();
    const second = connect(device_key);
    const welcome = await second.handshake();

    await expect(first.closed).resolves.toMatchObject({ code: 4008 });
    expect(sessions.get(agent_id)?.sessionId).toBe(welcome.payload.session_id);

    // The old socket's close must not take the new connection offline.
    await new Promise((r) => setTimeout(r, 100));
    expect(sessions.isConnected(agent_id)).toBe(true);
  });

  it('closes a socket that says the wrong thing first, or offers no shared version', async () => {
    const { device_key } = await newAgent();
    const agent = connect(device_key);
    await agent.opened;
    const early = agent.send('heartbeat');
    await expect(agent.next((m) => m.ref === early)).resolves.toMatchObject({ type: 'error', payload: { code: 'NOT_READY' } });

    agent.send('hello', { agent_version: '9.0.0', protocol_versions: [7] });
    await expect(agent.closed).resolves.toMatchObject({ code: 4010 });
  });

  it('takes the agent offline when its socket drops', async () => {
    const { device_key, agent_id } = await newAgent();
    const agent = connect(device_key);
    await agent.handshake();
    agent.ws.terminate();
    await agent.closed;
    await new Promise((r) => setTimeout(r, 100));
    expect(sessions.isConnected(agent_id)).toBe(false);
  });
});
