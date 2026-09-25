import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Agent } from '../src/entities/Agent.entity';
import { OperationalAlert } from '../src/entities/OperationalAlert.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { CashierShift } from '../src/entities/CashierShift.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { AgentEnrolmentService } from '../src/modules/agent-gateway/agent-enrolment.service';
import { AgentRegistryService } from '../src/modules/agent-gateway/agent-registry.service';
import { AgentCommandsService } from '../src/modules/agent-gateway/agent-commands.service';
import { AgentSessionsService } from '../src/modules/agent-gateway/agent-sessions.service';
import { AgentHealthService, OFFLINE_ALERT_AFTER_MS } from '../src/modules/agent-gateway/agent-health.service';
import { AgentRegistryController } from '../src/modules/agent-gateway/agent-registry.controller';
import { HEAD_OFFICE_ONLY_KEY } from '../src/common/decorators/roles.decorator';
import { deleteTenantData } from './utils/tenant-teardown';
import { TestAgent } from './utils/agent-client';

const until = async (check: () => Promise<boolean> | boolean, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
};

// What head office sees about each branch agent, and when it is told one has gone.
describe('agent health (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let health: AgentHealthService;
  let registry: AgentRegistryService;
  let wsUrl: string;
  let tenantId: string;
  let branchId: string;
  let agentId: string;
  let deviceKey: string;
  const open: TestAgent[] = [];

  const offlineAlerts = () =>
    dataSource.getRepository(OperationalAlert).find({ where: { tenant_id: tenantId, branch_id: branchId, type: 'AGENT_OFFLINE' } });
  const connect = async (capabilities = ['print.html', 'payment.charge']) => {
    const agent = new TestAgent(wsUrl, deviceKey);
    open.push(agent);
    await agent.opened;
    const id = agent.send('hello', {
      agent_version: '1.0.2',
      protocol_versions: [1],
      capabilities,
      devices: [{ kind: 'printer', id: 'p-1', status: 'ONLINE', checked_at: new Date().toISOString() }],
    });
    await agent.next((m) => m.type === 'welcome' && m.ref === id);
    return agent;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    wsUrl = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/agent/ws`;
    dataSource = moduleRef.get(DataSource);
    health = moduleRef.get(AgentHealthService);
    registry = moduleRef.get(AgentRegistryService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (
      await save(Tenant, { code: `AGENTHLT-${Date.now()}`, name: 'Agent health fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'AHL', name: 'Health branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const { code } = await registry.createEnrolmentCode(tenantId, branchId, {});
    const enrolled = await moduleRef.get(AgentEnrolmentService).enrol(
      { code, machine: { hostname: 'AHL-PC' } },
      { clientKey: 'test', wsUrl: '' },
    );
    deviceKey = enrolled.device_key;
    agentId = enrolled.agent_id;
  }, 60000);

  afterEach(async () => {
    for (const a of open.splice(0)) {
      a.ws.terminate();
      await a.closed;
    }
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('is head office only', () => {
    expect(Reflect.getMetadata(HEAD_OFFICE_ONLY_KEY, AgentRegistryController)).toBe(true);
  });

  it("shows a live agent's version, capabilities, devices and recent commands", async () => {
    const agent = await connect();
    const ds = agent.send('device.status', {
      devices: [{ kind: 'terminal', id: 't-1', status: 'OFFLINE', detail: 'no route to host' }],
    });
    await agent.next((m) => m.ref === ds);
    const command = await moduleRef.get(AgentCommandsService).enqueue(tenantId, branchId, 'agent.check_update', {});
    await agent.next((m) => m.id === command.id);

    const view = await health.health(tenantId, agentId);

    expect(view.agent).toMatchObject({ id: agentId, hostname: 'AHL-PC', agent_version: '1.0.2', connected: true });
    expect(view.connection).toMatchObject({ connected: true, agent_version: '1.0.2', capabilities: ['print.html', 'payment.charge'] });
    expect(view.connection.devices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'printer', id: 'p-1', status: 'ONLINE' }),
        expect.objectContaining({ kind: 'terminal', id: 't-1', status: 'OFFLINE', detail: 'no route to host' }),
      ]),
    );
    expect(view.recent_commands[0]).toMatchObject({ id: command.id, type: 'agent.check_update', status: 'SENT' });
    expect(view.recent_commands[0]).not.toHaveProperty('payload');
  });

  it("shows the agent's menu copy and offline backlog from its heartbeats, with what looks wrong", async () => {
    const agent = await connect();
    const long = new Date(Date.now() - 45 * 60_000).toISOString();
    const hb = agent.send('heartbeat', {
      in_flight: 0,
      unacked_results: 0,
      sync: { data_version: 'abc', data_pulled_at: long, pending_orders: 3, oldest_pending_at: long, last_upload_at: null, last_upload_error: 'HTTP 502', extra: 'x'.repeat(10) },
    });
    await agent.next((m) => m.type === 'heartbeat.ack' && m.ref === hb);

    const view = await health.health(tenantId, agentId);
    expect(view.connection.sync).toMatchObject({ data_version: 'abc', data_pulled_at: long, pending_orders: 3, last_upload_error: 'HTTP 502' });
    expect(view.connection.sync).not.toHaveProperty('extra');
    expect(view.sync_warnings).toEqual(['SNAPSHOT_STALE', 'BACKLOG_STUCK', 'UPLOAD_FAILING']);

    const fresh = new Date().toISOString();
    const hb2 = agent.send('heartbeat', { sync: { data_version: 'abc', data_pulled_at: fresh, pending_orders: 0, oldest_pending_at: null, last_upload_at: fresh, last_upload_error: null } });
    await agent.next((m) => m.type === 'heartbeat.ack' && m.ref === hb2);
    expect((await health.health(tenantId, agentId)).sync_warnings).toEqual([]);
  });

  // §16.8: whether the branch could sell offline if the internet went now, and what is missing.
  it('says whether the branch is ready to sell offline, and what is missing', async () => {
    const readiness = async () => (await health.offlineReadiness(tenantId, await registry.listAgents(tenantId))).get(agentId);

    // Not connected: nothing to say.
    expect(await readiness()).toBeNull();

    // An agent before 1.11 with nothing set up.
    let agent = await connect();
    expect((await readiness())!.problems).toEqual(['AGENT_TOO_OLD', 'NO_TILL', 'NO_STAFF', 'SNAPSHOT_STALE']);
    agent.ws.terminate();
    await agent.closed;
    await until(() => !moduleRef.get(AgentSessionsService).get(agentId));

    // A till bound, but no shift on it; offline orders still waiting.
    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    const till = await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'T1', name: 'Till 1' });
    agent = await connect(['print.html', 'pos.offline', 'pos.till']);
    const now = new Date().toISOString();
    const beat = (pending: number) =>
      agent.send('heartbeat', {
        sync: { data_version: 'v', data_pulled_at: now, pending_orders: pending, oldest_pending_at: null, last_upload_at: null, last_upload_error: null },
        till: { terminal_id: till.id, mode: 'ONLINE', open_orders: 0 },
      });
    let hb = beat(2);
    await agent.next((m) => m.type === 'heartbeat.ack' && m.ref === hb);
    expect((await readiness())!.problems).toEqual(['NO_SHIFT', 'NO_STAFF', 'UPLOADS_WAITING']);

    // An open shift, a cashier with a PIN, the backlog sent: ready.
    await save(CashierShift, { tenant_id: tenantId, branch_id: branchId, terminal_id: till.id, shift_number: 'S1', business_date: '2026-09-26', state: 'OPEN' });
    await save(AdminUser, { tenant_id: tenantId, branch_id: branchId, username: `ahl-cashier-${Date.now()}`, display_name: 'Cashier', role: 'CASHIER', password_hash: 'x', pin_hash: '$argon2id$x', is_active: true });
    hb = beat(0);
    await agent.next((m) => m.type === 'heartbeat.ack' && m.ref === hb);
    expect(await readiness()).toEqual({ ready: true, problems: [] });
  });

  it('raises one critical alert when the agent stays away, and closes it when it is back', async () => {
    await until(() => !moduleRef.get(AgentSessionsService).isConnected(agentId));
    const agent = await connect();
    await health.sweep(new Date(Date.now() + OFFLINE_ALERT_AFTER_MS * 2), tenantId);
    expect(await offlineAlerts()).toHaveLength(0);

    agent.ws.terminate();
    await agent.closed;
    // The disconnect is stamped, so the grace period starts now.
    await until(async () => {
      const row = await dataSource.getRepository(Agent).findOneByOrFail({ id: agentId });
      return Date.now() - new Date(row.last_seen_at!).getTime() < 2000;
    });
    await health.sweep(new Date(Date.now() + 30_000), tenantId);
    expect(await offlineAlerts()).toHaveLength(0);

    await health.sweep(new Date(Date.now() + OFFLINE_ALERT_AFTER_MS + 1000), tenantId);
    await health.sweep(new Date(Date.now() + OFFLINE_ALERT_AFTER_MS + 5000), tenantId);
    const raised = await offlineAlerts();
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ severity: 'CRITICAL', acknowledged: false, title: 'Branch agent offline: Health branch' });
    expect(raised[0].message).toContain('AHL-PC');

    await connect();
    await health.sweep(new Date(), tenantId);
    expect((await offlineAlerts()).every((a) => a.acknowledged)).toBe(true);
  });

  it('closes the alert of an agent head office revoked', async () => {
    // The last test's agent is closed on our side; wait until the server has let go of it too,
    // or the sweep still sees it connected and raises nothing.
    await until(() => !moduleRef.get(AgentSessionsService).isConnected(agentId));
    await health.sweep(new Date(Date.now() + OFFLINE_ALERT_AFTER_MS * 3), tenantId);
    expect((await offlineAlerts()).some((a) => !a.acknowledged)).toBe(true);

    await registry.revokeAgent(tenantId, agentId, 'retired', {});
    await health.sweep(new Date(Date.now() + OFFLINE_ALERT_AFTER_MS * 3), tenantId);
    expect((await offlineAlerts()).every((a) => a.acknowledged)).toBe(true);
  });
});
