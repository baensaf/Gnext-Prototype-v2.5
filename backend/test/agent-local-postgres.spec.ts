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
import { AgentSessionsService } from '../src/modules/agent-gateway/agent-sessions.service';
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
  const tillUserIds: string[] = [];
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

  // §16.3: the till on the branch PC signs its cashier in to the cloud with the PIN they typed.
  describe('till sign-in by PIN', () => {
    const staff: Record<string, string> = {};
    const pinLogin = (user: string, pin: string) => agentCall('post', '/pin-login').send({ user_id: staff[user], pin });
    let capabilities: string[] = ['pos.offline', 'pos.till'];

    beforeAll(async () => {
      const agentId = (await dataSource.query(`SELECT id FROM agent WHERE tenant_id = $1`, [tenantId]))[0].id;
      jest
        .spyOn(moduleRef.get(AgentSessionsService), 'get')
        .mockImplementation((id: string) => (id === agentId ? ({ capabilities } as any) : undefined));
      const pin = await argon2.hash('4321');
      for (const [name, data] of [
        ['sara', { role: 'CASHIER', branch_id: branchId, pin_hash: pin }],
        ['nopin', { role: 'CASHIER', branch_id: branchId, pin_hash: null }],
        ['elsewhere', { role: 'CASHIER', branch_id: otherBranchId, pin_hash: pin }],
        ['hq-pin', { role: 'ADMIN', branch_id: null, pin_hash: pin }],
        ['gone', { role: 'CASHIER', branch_id: branchId, pin_hash: pin, is_active: false }],
        ['kitchen', { role: 'KITCHEN', branch_id: branchId, pin_hash: pin }],
      ] as const) {
        const repo = dataSource.getRepository(AdminUser);
        const user: AdminUser = await repo.save(
          repo.create({
            tenant_id: tenantId,
            username: `alu-pin-${name}-${stamp}@fixture`,
            display_name: name,
            password_hash: 'x',
            is_active: true,
            ...data,
          } as Partial<AdminUser>),
        );
        staff[name] = user.id;
        tillUserIds.push(user.id);
      }
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      await dataSource.query(`DELETE FROM session WHERE user_id = ANY($1)`, [tillUserIds]).catch(() => undefined);
    });

    beforeEach(() => dataSource.query(`DELETE FROM pin_attempt_log WHERE tenant_id = $1`, [tenantId]));

    it("opens an ordinary cloud session for the branch's cashier, and audits it", async () => {
      const res = await pinLogin('sara', '4321');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        session_token: expect.any(String),
        csrf_token: expect.any(String),
        user: { id: staff.sara, role: 'CASHIER', branchId, isHeadOffice: false },
        tenant: { id: tenantId, baseCurrency: 'IRR' },
      });
      // The session works on the cloud's own routes, as a web POS sign-in does.
      const me = await request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.session_token}`);
      expect(me.status).toBe(200);
      expect(me.body.user.id).toBe(staff.sara);

      const [audit] = await dataSource.query(
        `SELECT details FROM audit_event WHERE tenant_id = $1 AND actor_id = $2 AND action = 'AUTH_LOGIN_SUCCESS' ORDER BY created_at DESC LIMIT 1`,
        [tenantId, staff.sara],
      );
      expect(audit.details).toMatchObject({ method: 'TILL_PIN' });
      expect(JSON.stringify(audit.details)).not.toContain('4321');
    });

    it('signs in only who the staff list carries, and never by a default PIN', async () => {
      for (const who of ['nopin', 'elsewhere', 'hq-pin', 'gone', 'kitchen']) {
        const res = await pinLogin(who, who === 'nopin' ? '1234' : '4321');
        expect([who, res.status, res.body.code]).toEqual([who, 403, 'FORBIDDEN_ROLE']);
      }
      expect((await agentCall('post', '/pin-login').send({ user_id: staff.sara, pin: '12' })).status).toBe(400);
      expect((await request(http).post('/api/v1/agent/local/pin-login').send({ user_id: staff.sara, pin: '4321' })).status).toBe(401);
    });

    it('needs an agent connected with pos.till', async () => {
      capabilities = ['pos.offline'];
      try {
        expect((await pinLogin('sara', '4321')).body.code).toBe('CAPABILITY_REQUIRED');
      } finally {
        capabilities = ['pos.offline', 'pos.till'];
      }
    });

    it('locks a user after five wrong PINs, whatever the next PIN is', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await pinLogin('sara', '0000');
        expect([res.status, res.body.code]).toEqual([401, 'PIN_WRONG']);
      }
      const locked = await pinLogin('sara', '4321');
      expect([locked.status, locked.body.code]).toEqual([423, 'PIN_LOCKED']);
      const [failed] = await dataSource.query(
        `SELECT count(*)::int AS n FROM audit_event WHERE tenant_id = $1 AND actor_id = $2 AND action = 'AUTH_LOGIN_FAILED'`,
        [tenantId, staff.sara],
      );
      expect(failed.n).toBe(5);
    });

    it('locks the whole branch after twenty wrong till PINs across its users', async () => {
      // Four wrong PINs for each of five users of the branch: none is locked on their own.
      const branchUsers = [staff.sara, staff.nopin, staff.gone, staff.kitchen, userIds[0]];
      await dataSource.query(
        `INSERT INTO pin_attempt_log (tenant_id, user_id, action, is_success)
           SELECT $1, u, 'TILL_SIGN_IN', false FROM unnest($2::uuid[]) AS u, generate_series(1, 4)`,
        [tenantId, branchUsers],
      );
      const res = await pinLogin('sara', '4321');
      expect([res.status, res.body.code]).toEqual([423, 'TILL_SIGN_IN_LOCKED']);
    });
  });
});
