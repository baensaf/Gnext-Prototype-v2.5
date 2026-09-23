import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Agent } from '../src/entities/Agent.entity';
import { OperationalAlert } from '../src/entities/OperationalAlert.entity';
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
  const connect = async () => {
    const agent = new TestAgent(wsUrl, deviceKey);
    open.push(agent);
    await agent.opened;
    const id = agent.send('hello', {
      agent_version: '1.0.2',
      protocol_versions: [1],
      capabilities: ['print.html', 'payment.charge'],
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

  it('raises one critical alert when the agent stays away, and closes it when it is back', async () => {
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
