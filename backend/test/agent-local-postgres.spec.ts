import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import * as argon2 from 'argon2';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { Printer } from '../src/entities/Printer.entity';
import { PaymentDevice } from '../src/entities/PaymentDevice.entity';
import { AgentEnrolmentService } from '../src/modules/agent-gateway/agent-enrolment.service';
import { AgentRegistryService } from '../src/modules/agent-gateway/agent-registry.service';
import { deleteTenantData } from './utils/tenant-teardown';

// The agent's local settings page manages its branch's devices through the cloud: the device
// key names the branch, and a signed-in manager's session says who is changing what.
describe('agent local settings API (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let http: any;
  let tenantId: string;
  let branchId: string;
  let otherBranchId: string;
  let key: string;
  const userIds: string[] = [];
  const password = 'Local-UI-test-1';
  const stamp = Date.now();

  const agentCall = (method: 'post' | 'patch' | 'delete', path: string, session?: string) => {
    const r = request(http)[method](`/api/v1/agent/local${path}`).set('Authorization', `Bearer ${key}`);
    return session ? r.set('X-Gnext-User-Session', session) : r;
  };
  const login = (username: string) =>
    agentCall('post', '/login').send({ username, password });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    http = app.getHttpServer();
    dataSource = moduleRef.get(DataSource);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (
      await save(Tenant, { code: `AGLOCAL-${stamp}`, name: 'Agent local UI fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'ALU', name: 'Local UI branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    otherBranchId = (await save(Branch, { tenant_id: tenantId, code: 'ALU2', name: 'Other branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const hash = await argon2.hash(password);
    for (const [name, role, branch] of [
      ['manager', 'MANAGER', branchId],
      ['other-manager', 'MANAGER', otherBranchId],
      ['cashier', 'CASHIER', branchId],
      ['hq', 'ADMIN', null],
    ] as const) {
      const user = await save(AdminUser, {
        tenant_id: tenantId,
        username: `alu-${name}-${stamp}@fixture`,
        display_name: name,
        role,
        password_hash: hash,
        is_active: true,
        branch_id: branch,
      });
      userIds.push(user.id);
    }

    const registry = moduleRef.get(AgentRegistryService);
    const { code } = await registry.createEnrolmentCode(tenantId, branchId, {});
    key = (await moduleRef.get(AgentEnrolmentService).enrol({ code, agent_version: '1.0.0', protocol_version: 1 }, { clientKey: 'test', wsUrl: '' })).device_key;
  }, 60000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM session WHERE user_id = ANY($1)`, [userIds]).catch(() => undefined);
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('signs in only managers of this branch and head office', async () => {
    const ok = await login(`alu-manager-${stamp}@fixture`);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ session_token: expect.any(String), user: { role: 'MANAGER' } });

    expect((await login(`alu-hq-${stamp}@fixture`)).status).toBe(200);
    expect((await login(`alu-cashier-${stamp}@fixture`)).body.code).toBe('FORBIDDEN_ROLE');
    expect((await login(`alu-other-manager-${stamp}@fixture`)).body.code).toBe('FORBIDDEN_ROLE');
    expect((await agentCall('post', '/login').send({ username: `alu-manager-${stamp}@fixture`, password: 'wrong' })).status).toBe(401);
    expect((await request(http).post('/api/v1/agent/local/login').send({ username: 'x', password: 'y' })).status).toBe(401);
  });

  it("adds, edits and removes printers in the agent's own branch", async () => {
    const session = (await login(`alu-manager-${stamp}@fixture`)).body.session_token;
    const body = { code: 'kit1', name: 'Grill', printer_type: 'KITCHEN_IMPACT', paper_width_mm: 80, connection: { kind: 'tcp', host: '192.168.1.50', port: 9100 }, branch_id: otherBranchId };

    expect((await agentCall('post', '/printers').send(body)).status).toBe(401);

    const created = await agentCall('post', '/printers', session).send(body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: 'KIT1', branch_id: branchId, agent_connection: { kind: 'tcp', host: '192.168.1.50', port: 9100 } });

    const edited = await agentCall('patch', `/printers/${created.body.id}`, session).send({ name: 'Grill 2', connection: { kind: 'tcp', host: '192.168.1.51', port: 9100 } });
    expect(edited.body).toMatchObject({ name: 'Grill 2', agent_connection: { host: '192.168.1.51' } });

    expect((await agentCall('patch', `/printers/${created.body.id}`, session).send({ paper_width_mm: 70 })).status).toBe(400);
    expect((await agentCall('delete', `/printers/${created.body.id}`, session)).status).toBe(200);
    expect(await dataSource.getRepository(Printer).findOneBy({ id: created.body.id })).toBeNull();

    const audited = await dataSource.query(`SELECT action, actor_id FROM audit_event WHERE tenant_id = $1 AND entity_id = $2 ORDER BY created_at`, [tenantId, created.body.id]);
    expect(audited.map((r: any) => r.action)).toEqual(['PRINTER_CREATED', 'PRINTER_UPDATED', 'PRINTER_DELETED']);
    expect(audited[0].actor_id).toBe(userIds[0]);
  });

  it("cannot reach another branch's printer", async () => {
    const session = (await login(`alu-hq-${stamp}@fixture`)).body.session_token;
    const other = await dataSource.getRepository(Printer).save({ tenant_id: tenantId, branch_id: otherBranchId, code: 'OTH', name: 'Other', printer_type: 'THERMAL_RECEIPT', is_active: true } as any);
    expect((await agentCall('delete', `/printers/${other.id}`, session)).status).toBe(404);
  });

  it('adds, edits and retires terminals', async () => {
    const session = (await login(`alu-manager-${stamp}@fixture`)).body.session_token;
    const created = await agentCall('post', '/terminals', session).send({ code: 'pos1', name: 'Till 1', driver: 'fake', connection: { kind: 'tcp', host: '192.168.1.60', port: 8888 } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: 'POS1', kind: 'POS', branch_id: branchId, agent_driver: 'fake' });

    expect((await agentCall('post', '/terminals', session).send({ code: 'pos2', name: 'Till 2', driver: 'visa', connection: { kind: 'tcp', host: '1.2.3.4', port: 1 } })).status).toBe(400);
    expect((await agentCall('patch', `/terminals/${created.body.id}`, session).send({ name: 'Till one' })).body.name).toBe('Till one');

    expect((await agentCall('delete', `/terminals/${created.body.id}`, session)).status).toBe(200);
    const retired = await dataSource.getRepository(PaymentDevice).findOneByOrFail({ id: created.body.id });
    expect(retired).toMatchObject({ is_active: false, agent_connection: null, agent_driver: null });
  });

  it('forgets the session on logout', async () => {
    const session = (await login(`alu-manager-${stamp}@fixture`)).body.session_token;
    expect((await agentCall('post', '/logout', session)).status).toBe(200);
    expect((await agentCall('post', '/printers', session).send({ code: 'X', name: 'X', connection: null })).status).toBe(401);
    expect(await dataSource.getRepository(AdminUser).countBy({ id: In(userIds) })).toBe(4);
  });
});
