import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Agent } from '../src/entities/Agent.entity';
import { AgentRegistryService } from '../src/modules/agent-gateway/agent-registry.service';
import { AgentSessionsService } from '../src/modules/agent-gateway/agent-sessions.service';
import { deleteTenantData } from './utils/tenant-teardown';
import { fakeHandle } from './utils/agent-fakes';

// Enrolment over real HTTP and a real database: head office makes a code, the agent trades
// it for a key, the key opens agent routes, and a replacement PC cuts the old one off.
describe('agent enrolment and device-key auth (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let registry: AgentRegistryService;
  let sessions: AgentSessionsService;
  let tenantId: string;
  let branchId: string;

  const enrol = (code: string, extra: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/api/v1/agent/enrol')
      .set('Host', 'app.example.ir')
      .set('X-Forwarded-For', `203.0.113.${Math.floor(Math.random() * 200)}`)
      .send({ code, agent_version: '1.0.0', protocol_version: 1, machine: { hostname: 'BRANCH-PC' }, ...extra });
  const me = (key?: string) => {
    const req = request(app.getHttpServer()).get('/api/v1/agent/me');
    return key ? req.set('Authorization', `Bearer ${key}`) : req;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // The same strict pipe main.ts installs: an agent's unknown fields must still get through.
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    dataSource = moduleRef.get(DataSource);
    registry = moduleRef.get(AgentRegistryService);
    sessions = moduleRef.get(AgentSessionsService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (
      await save(Tenant, { code: `AGENT-${Date.now()}`, name: 'Agent fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'AGT', name: 'Agent branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  let firstKey: string;
  let firstAgentId: string;

  it('enrols with a code typed any old way, and ignores fields it does not know', async () => {
    const { code } = await registry.createEnrolmentCode(tenantId, branchId, {});

    const res = await enrol(` ${code.toLowerCase()} `, { capabilities: ['print.html'] }).expect(200);

    expect(res.body).toMatchObject({
      tenant_id: tenantId,
      branch_id: branchId,
      branch_name: 'Agent branch',
      ws_url: 'wss://app.example.ir/api/v1/agent/ws',
    });
    firstKey = res.body.device_key;
    firstAgentId = res.body.agent_id;
    const row = await dataSource.getRepository(Agent).findOneByOrFail({ id: firstAgentId });
    expect(row).toMatchObject({ status: 'ACTIVE', hostname: 'BRANCH-PC', agent_version: '1.0.0' });
    expect(row.key_hash).not.toContain(firstKey);

    // The same code a second time.
    const again = await enrol(code).expect(400);
    expect(again.body.code).toBe('ENROLMENT_CODE_USED');
  });

  it('opens agent routes with the key, and nothing else does', async () => {
    const ok = await me(firstKey).expect(200);
    expect(ok.body).toMatchObject({ agent_id: firstAgentId, branch_id: branchId, status: 'ACTIVE' });

    expect((await me().expect(401)).body.code).toBe('AGENT_KEY_INVALID');
    expect((await me('gak_' + 'x'.repeat(43)).expect(401)).body.code).toBe('AGENT_KEY_INVALID');
    // A user session token is not an agent key.
    expect((await me('some-session-token').expect(401)).body.code).toBe('AGENT_KEY_INVALID');
  });

  it('keeps head office routes shut to an agent key', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/agents').set('Authorization', `Bearer ${firstKey}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('replaces the old agent when the branch enrols a new PC', async () => {
    const close = jest.fn();
    sessions.register(fakeHandle(firstAgentId, close));
    const { code } = await registry.createEnrolmentCode(tenantId, branchId, {});

    const res = await enrol(code).expect(200);

    expect(close).toHaveBeenCalledWith(4003, 'AGENT_REVOKED');
    expect((await me(firstKey).expect(403)).body.code).toBe('AGENT_REVOKED');
    await me(res.body.device_key).expect(200);

    const active = await dataSource.getRepository(Agent).find({ where: { tenant_id: tenantId, status: 'ACTIVE' } });
    expect(active.map((a) => a.id)).toEqual([res.body.agent_id]);

    // Head office revokes the new one too: its key stops at once.
    await registry.revokeAgent(tenantId, res.body.agent_id, 'test', {});
    expect((await me(res.body.device_key).expect(403)).body.code).toBe('AGENT_REVOKED');
  });

  it('refuses a cancelled code as expired', async () => {
    const created = await registry.createEnrolmentCode(tenantId, branchId, {});
    await registry.cancelEnrolmentCode(tenantId, created.id, {});
    expect((await enrol(created.code).expect(400)).body.code).toBe('ENROLMENT_CODE_EXPIRED');
  });

  it('allows only one active agent per branch, whatever the code path', async () => {
    const repo = dataSource.getRepository(Agent);
    const row = (hash: string) =>
      repo.create({ tenant_id: tenantId, branch_id: branchId, status: 'ACTIVE', key_hash: hash, enrolled_at: new Date() });
    await repo.save(row('a'.repeat(64)));
    await expect(repo.save(row('b'.repeat(64)))).rejects.toThrow();
  });
});
