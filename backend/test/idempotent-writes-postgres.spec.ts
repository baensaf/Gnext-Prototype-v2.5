import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { IdempotencyService } from '../src/common/services/idempotency.service';
import { ShiftService } from '../src/modules/cashier/shift.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { Printer } from '../src/entities/Printer.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { Payment } from '../src/entities/Payment.entity';
import { PrintJob } from '../src/entities/PrintJob.entity';
import { IdempotencyRecord } from '../src/entities/IdempotencyRecord.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// A branch agent repeats a write whose answer was lost (agent-protocol §19.11). The routes the
// register's Place and cash payment use must then do their work once and answer the repeat with
// the first answer; a client that sends no key (the kiosk, Snappfood intake) is left as it was.
describe('idempotent writes (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let http: any;
  let tenantId: string;
  let branchId: string;
  let burger: string;
  let cash: string;
  let token: string;
  let csrf: string;
  let userId: string;
  const stamp = Date.now();
  const password = 'Idem-test-1';
  let seq = 0;
  /** A key no other test (or run) has used. */
  const newKey = () => `idem-${stamp}-${++seq}`;

  const call = (method: 'post' | 'patch', path: string, body: object, key?: string) => {
    const r = request(http)[method](path).set('Authorization', `Bearer ${token}`).set('X-CSRF-Token', csrf);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  const draftBody = (quantity = '1') => ({
    branch_id: branchId,
    order_type: 'TAKEAWAY',
    channel: 'POS',
    items: [{ product_id: burger, quantity }],
  });
  const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
  const orderRows = () => dataSource.getRepository(OrderHeader).count({ where: { tenant_id: tenantId } });
  const paymentRows = (orderId: string) => dataSource.getRepository(Payment).count({ where: { tenant_id: tenantId, order_id: orderId } });
  const ticketsFor = (orderId: string) =>
    dataSource.getRepository(PrintJob).count({ where: { tenant_id: tenantId, entity_id: orderId, document_type: 'KITCHEN_TICKET' } });
  const recordsFor = (key: string) => dataSource.getRepository(IdempotencyRecord).find({ where: { tenant_id: tenantId, key } });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    http = app.getHttpServer();
    dataSource = moduleRef.get(DataSource);

    tenantId = (await save(Tenant, { code: `IDEM-${stamp}`, name: 'Idempotent writes', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'IDM', name: 'Idempotent branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const terminalId = (await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'IDM-1', name: 'Till 1', terminal_type: 'CASHIER', is_active: true })).id;
    await save(Printer, { tenant_id: tenantId, branch_id: branchId, code: 'K-00', name: 'Kitchen', printer_type: 'KITCHEN_IMPACT', is_active: true });
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'IDM-MAINS', name: 'Mains', is_active: true })).id;
    burger = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'BURGER', name: 'Burger', base_price: '100000.0000', tax_rate: '0.0000', is_active: true })).id;
    cash = (await save(PaymentMethod, { tenant_id: tenantId, code: 'CASH', name: 'Cash', kind: 'CASH', currency_code: 'IRR', is_active: true })).id;
    const user = await save(AdminUser, {
      tenant_id: tenantId,
      username: `idem-cashier-${stamp}@fixture`,
      display_name: 'Cashier',
      role: 'CASHIER',
      password_hash: await argon2.hash(password),
      is_active: true,
      branch_id: branchId,
    });
    userId = user.id;
    await moduleRef.get(ShiftService).openShift(tenantId, { terminalId } as any);

    const login = await request(http).post('/api/v1/auth/login').send({ username: `idem-cashier-${stamp}@fixture`, password });
    expect(login.status).toBe(200);
    token = login.body.sessionToken;
    csrf = login.body.csrfToken;
  }, 60000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM session WHERE user_id = $1`, [userId]).catch(() => undefined);
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('places an order once however often the same Place is sent: one order, one kitchen ticket, one call number', async () => {
    const createKey = newKey();
    const submitKey = newKey();

    const created = await call('post', '/api/v1/orders', draftBody(), createKey);
    expect(created.status).toBe(201);
    const again = await call('post', '/api/v1/orders', draftBody(), createKey);
    expect(again.status).toBe(created.status);
    expect(again.body).toEqual(created.body);
    expect(again.headers['x-cache-replay']).toBe('true');
    expect(created.headers['x-cache-replay']).toBeUndefined();
    expect(await orderRows()).toBe(1);

    const orderId = created.body.id;
    const first = await call('post', `/api/v1/orders/${orderId}/submit`, {}, submitKey);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ id: orderId, state: 'CONFIRMED', call_number: expect.any(Number) });
    expect(await ticketsFor(orderId)).toBe(1);

    const second = await call('post', `/api/v1/orders/${orderId}/submit`, {}, submitKey);
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(second.headers['x-cache-replay']).toBe('true');
    const third = await call('post', `/api/v1/orders/${orderId}/submit`, {}, submitKey);
    expect(third.body).toEqual(first.body);

    expect(await ticketsFor(orderId)).toBe(1);
    expect(await orderRows()).toBe(1);
    const row = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: orderId });
    expect(row.call_number).toBe(first.body.call_number);

    // The repeats did not use a call number up: the next order is the next one.
    const next = await call('post', '/api/v1/orders', draftBody());
    const nextSubmitted = await call('post', `/api/v1/orders/${next.body.id}/submit`, {});
    expect(nextSubmitted.body.call_number).toBe(first.body.call_number + 1);

    // With no key the call is what it always was: nothing is replayed (the service alone does not
    // keep a repeat from printing the kitchen ticket again, which is what the key is for).
    const unkeyed = await call('post', `/api/v1/orders/${orderId}/submit`, {});
    expect(unkeyed.headers['x-cache-replay']).toBeUndefined();
    expect(unkeyed.body).toMatchObject({ id: orderId, call_number: first.body.call_number });
  });

  it('answers the same key with another body 409, and does nothing', async () => {
    const key = newKey();
    const before = await orderRows();
    const first = await call('post', '/api/v1/orders', draftBody('1'), key);
    expect(first.status).toBe(201);

    const other = await call('post', '/api/v1/orders', draftBody('2'), key);
    expect(other.status).toBe(409);
    expect(other.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await orderRows()).toBe(before + 1);

    // The same goes for a submit.
    const submitKey = newKey();
    expect((await call('post', `/api/v1/orders/${first.body.id}/submit`, {}, submitKey)).status).toBe(201);
    const differs = await call('post', `/api/v1/orders/${first.body.id}/submit`, { quoteVersion: 'another' }, submitKey);
    expect(differs.status).toBe(409);
    expect(differs.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await ticketsFor(first.body.id)).toBe(1);

    // One key may serve both calls of a Place: the scope tells them apart.
    const shared = newKey();
    const draft = await call('post', '/api/v1/orders', draftBody(), shared);
    const placed = await call('post', `/api/v1/orders/${draft.body.id}/submit`, {}, shared);
    expect(draft.status).toBe(201);
    expect(placed.status).toBe(201);
    expect(placed.body.state).toBe('CONFIRMED');
  });

  it('updates a draft once for the same key', async () => {
    const draft = await call('post', '/api/v1/orders', draftBody('1'));
    const key = newKey();
    const patch = { ...draftBody('3') };
    const first = await call('patch', `/api/v1/orders/${draft.body.id}`, patch, key);
    expect(first.status).toBe(200);
    const again = await call('patch', `/api/v1/orders/${draft.body.id}`, patch, key);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(again.headers['x-cache-replay']).toBe('true');
    expect((await call('patch', `/api/v1/orders/${draft.body.id}`, draftBody('4'), key)).status).toBe(409);
  });

  it('answers a request still running with the same key 409 IDEMPOTENCY_IN_PROGRESS, and does not run it again', async () => {
    const key = newKey();
    const body = draftBody();
    const hash = moduleRef.get(IdempotencyService).computeHash('ORDER_CREATE', '/api/v1/orders', body);
    await dataSource.getRepository(IdempotencyRecord).save({
      tenant_id: tenantId,
      scope: 'ORDER_CREATE',
      key,
      request_hash: hash,
      status: 'PENDING',
      expires_at: new Date(Date.now() + 3600_000),
    } as any);
    const before = await orderRows();

    const res = await call('post', '/api/v1/orders', body, key);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(await orderRows()).toBe(before);
  });

  it('frees the key of a request that failed, so the repeat runs', async () => {
    const key = newKey();
    const missing = '00000000-0000-4000-8000-000000000001';
    const failed = await call('post', `/api/v1/orders/${missing}/submit`, {}, key);
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(await recordsFor(key)).toHaveLength(0);

    // The same key and the same body, now that the order exists.
    const sameKey = newKey();
    const bad = await call('post', '/api/v1/orders', { ...draftBody(), items: [{ product_id: missing, quantity: '1' }] }, sameKey);
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(await recordsFor(sameKey)).toHaveLength(0);
    const ok = await call('post', '/api/v1/orders', draftBody(), sameKey);
    expect(ok.status).toBe(201);
  });

  it('lets only one of two requests that arrive together with one key do the work', async () => {
    const key = newKey();
    const before = await orderRows();
    const [a, b] = await Promise.all([call('post', '/api/v1/orders', draftBody(), key), call('post', '/api/v1/orders', draftBody(), key)]);
    const statuses = [a.status, b.status].sort();
    // The other is told it is in progress, or (if the first had finished) gets the first answer.
    expect(statuses[0] === 201 && (statuses[1] === 201 || statuses[1] === 409)).toBe(true);
    if (statuses[1] === 409) expect([a, b].find((r) => r.status === 409)!.body.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(await orderRows()).toBe(before + 1);
  });

  it('refuses a key longer than the column holds, as a 400', async () => {
    const tooLong = await call('post', '/api/v1/orders', draftBody(), 'k'.repeat(161));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.code).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('takes a cash payment once: one intent, one payment, the same answer again', async () => {
    const draft = await call('post', '/api/v1/orders', draftBody());
    const orderId = draft.body.id;
    const placed = await call('post', `/api/v1/orders/${orderId}/submit`, {});
    expect(Number(placed.body.grand_total)).toBe(100000);

    const key = newKey();
    const intentBody = { orderId, methodId: cash, amount: '40000' };
    const intent = await call('post', '/api/v1/payments', intentBody, key);
    expect(intent.status).toBe(201);
    const again = await call('post', '/api/v1/payments', intentBody, key);
    expect(again.status).toBe(intent.status);
    expect(again.body).toEqual(intent.body);
    expect(again.headers['x-cache-replay']).toBe('true');
    expect(await paymentRows(orderId)).toBe(1);

    // The repeat is also safe once the money is taken: it gets the intent, and taking it again
    // answers the payment as it is.
    const processed = await call('post', `/api/v1/payments/${intent.body.id}/process`, {});
    expect(processed.status).toBe(201);
    expect(processed.body).toMatchObject({ id: intent.body.id, status: 'SUCCEEDED' });
    const late = await call('post', '/api/v1/payments', intentBody, key);
    expect(late.body.id).toBe(intent.body.id);
    expect((await call('post', `/api/v1/payments/${late.body.id}/process`, {})).body.status).toBe('SUCCEEDED');
    expect(await paymentRows(orderId)).toBe(1);
    const paid = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: orderId });
    expect(Number(paid.paid_total)).toBe(40000);

    // Another amount under the same key is another request.
    const conflict = await call('post', '/api/v1/payments', { ...intentBody, amount: '50000' }, key);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await paymentRows(orderId)).toBe(1);

    // The next payment, with its own key, is a new one.
    const second = await call('post', '/api/v1/payments', { ...intentBody, amount: '60000' }, newKey());
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(intent.body.id);
    expect(await paymentRows(orderId)).toBe(2);
  });

  it('leaves a client with no key as it was', async () => {
    // Orders: every call is its own.
    const a = await call('post', '/api/v1/orders', draftBody());
    const b = await call('post', '/api/v1/orders', draftBody());
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).not.toBe(b.body.id);
    expect(a.headers['x-cache-replay']).toBeUndefined();

    // Payments: a second intent while the first is waiting is refused, as it always was.
    const placed = await call('post', `/api/v1/orders/${a.body.id}/submit`, {});
    expect(placed.status).toBe(201);
    const body = { orderId: a.body.id, methodId: cash, amount: '10000' };
    expect((await call('post', '/api/v1/payments', body)).status).toBe(201);
    const repeat = await call('post', '/api/v1/payments', body);
    expect(repeat.status).toBe(409);
    expect(await paymentRows(a.body.id)).toBe(1);

    // An empty key is no key.
    const blank = await request(http).post('/api/v1/orders').set('Authorization', `Bearer ${token}`).set('X-CSRF-Token', csrf).set('Idempotency-Key', '  ').send(draftBody());
    expect(blank.status).toBe(201);
  });

  it('keeps one tenant keys apart from another', async () => {
    const key = newKey();
    const first = await call('post', '/api/v1/orders', draftBody(), key);
    expect(first.status).toBe(201);
    const [record] = await recordsFor(key);
    expect(record).toMatchObject({ tenant_id: tenantId, scope: 'ORDER_CREATE', status: 'SUCCEEDED', response_status: 201 });

    // Another tenant's record with the same key and scope is not this one's.
    const other = (await save(Tenant, { code: `IDEM2-${stamp}`, name: 'Other', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    try {
      await dataSource.getRepository(IdempotencyRecord).save({
        tenant_id: other,
        scope: 'ORDER_CREATE',
        key,
        request_hash: 'f'.repeat(64),
        status: 'SUCCEEDED',
        response_status: 201,
        response_body: { id: 'not-ours' },
        expires_at: new Date(Date.now() + 3600_000),
      } as any);
      const replay = await call('post', '/api/v1/orders', draftBody(), key);
      expect(replay.body.id).toBe(first.body.id);
    } finally {
      await deleteTenantData(dataSource, other);
    }
  });
});
