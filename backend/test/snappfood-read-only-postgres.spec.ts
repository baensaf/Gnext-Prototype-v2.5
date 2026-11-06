import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { ChannelItemMap } from '../src/entities/ChannelItemMap.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { OrderStateEvent } from '../src/entities/OrderStateEvent.entity';
import { IntegrationLog } from '../src/entities/IntegrationLog.entity';
import { SnappfoodConnection } from '../src/entities/SnappfoodConnection.entity';
import { SnappfoodSetupService } from '../src/modules/snappfood/snappfood-setup.service';
import { SnappfoodReaderService } from '../src/modules/simulation/snappfood-reader.service';
import { tehranTime } from '../src/modules/snappfood/snappfood-live.service';
import { deleteTenantData } from './utils/tenant-teardown';

// The parallel run beside HAMI: HAMI holds the webhook and answers the orders, and Gnext only
// reads them from Snappfood's list of recent orders. Nothing goes back to Snappfood, and an
// order is recorded once HAMI has accepted it.
describe('Snappfood read-only branch (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let setup: SnappfoodSetupService;
  let tenantId: string;
  let niyayesh: string;
  let falakeGaz: string;
  let path: string;
  let pizzaId: number;

  const post = (form: string) => request(app.getHttpServer()).post(path).type('form').send(form);

  /** A form-encoded Snappfood order, as the webhook would bring it. */
  const order = (code: string, statusCode: number, quantity = 1) =>
    [
      `code=${code}`,
      `statusCode=${statusCode}`,
      'price=1100&deliveryPrice=0&packingPrice=0&tax=0&vat=0',
      'expeditionType=ZF_EXPRESS&orderPaymentTypeCode=ONLINE',
      'vendorCode=0ny1ro',
      `products%5B0%5D%5Bid%5D=${pizzaId}&products%5B0%5D%5Bquantity%5D=${quantity}&products%5B0%5D%5Bprice%5D=${1100 / quantity}`,
      `products%5B0%5D%5Btitle%5D=${encodeURIComponent('پیتزا')}&products%5B0%5D%5Bvat%5D=0`,
    ].join('&');

  const findOrder = (code: string) => dataSource.getRepository(OrderHeader).findOne({ where: { tenant_id: tenantId, order_number: `SNP-${code}` } });
  const activeLines = async (orderId: string) =>
    (await dataSource.getRepository(OrderItem).find({ where: { tenant_id: tenantId, order_id: orderId, state: 'ACTIVE' } })).map((l) => Number(l.quantity));

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    dataSource = moduleRef.get(DataSource);
    setup = moduleRef.get(SnappfoodSetupService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (await save(Tenant, { code: `SFREAD-${Date.now()}`, name: 'Snappfood read-only fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    niyayesh = (await save(Branch, { tenant_id: tenantId, code: 'NIY', name: 'Niyayesh', is_active: true, time_zone: 'Asia/Tehran' })).id;
    falakeGaz = (await save(Branch, { tenant_id: tenantId, code: 'FLG', name: 'Falake Gaz', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'SFR-PIZZA', name: 'Pizza', is_active: true })).id;
    const pizza = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'P1', name: 'Pizza', base_price: '11000.0000', tax_rate: '0.0000', is_active: true })).id;
    pizzaId = (await dataSource.getRepository(ChannelItemMap).findOneBy({ tenant_id: tenantId, channel: 'SNAPPFOOD', entity_id: pizza }))?.external_id ?? 101;

    await setup.saveBranch(tenantId, niyayesh, { mode: 'SIMULATED', vendorCode: '0ny1ro', readOnly: true });
    path = (await setup.getSetup(tenantId)).webhook.path;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await deleteTenantData(dataSource, tenantId);
    await dataSource.query(`DELETE FROM snappfood_connection WHERE tenant_id = $1`, [tenantId]);
    await dataSource.query(`DELETE FROM snappfood_webhook WHERE tenant_id = $1`, [tenantId]);
    await app.close();
  });

  it('shows the branch as read-only on the settings page', async () => {
    const row = (await setup.getSetup(tenantId)).branches.find((b) => b.branch_id === niyayesh)!;
    expect(row).toMatchObject({ read_only: true, last_read_at: null, last_read_error: null });
  });

  it('keeps nothing of an order the other system has not accepted yet, and acks nothing', async () => {
    expect((await post(order('sfr001', 56))).status).toBe(200);
    expect(await findOrder('sfr001')).toBeNull();
    const acks = await dataSource.getRepository(IntegrationLog).count({ where: { tenant_id: tenantId, event_type: 'ORDER_ACK' } });
    expect(acks).toBe(0);
  });

  it('records an accepted order as completed, with its lines and money, without asking anyone', async () => {
    expect((await post(order('sfr001', 42))).status).toBe(200);
    const saved = (await findOrder('sfr001'))!;
    expect(saved).toMatchObject({ branch_id: niyayesh, channel: 'AGGREGATOR', state: 'COMPLETED', aggregator_status_code: 42 });
    expect(saved.completed_at).toBeTruthy();
    expect(Number(saved.grand_total)).toBe(11000);
    expect(saved.notes).toContain('Accepted in another system');
    expect(await activeLines(saved.id)).toEqual([1]);

    const events = await dataSource.getRepository(OrderStateEvent).find({ where: { tenant_id: tenantId, order_id: saved.id } });
    expect(events.map((e) => [e.from_state, e.to_state, e.action])).toEqual([[null, 'COMPLETED', 'READ_FROM_SNAPPFOOD']]);
    // No call number: the other system gave it one.
    expect(saved.call_number ?? null).toBeNull();
  });

  it('answers the same status again as a duplicate and changes nothing', async () => {
    const res = await post(order('sfr001', 42));
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
  });

  it('takes the new lines when support sends the order back changed and it is accepted again', async () => {
    await post(order('sfr001', 51));
    await post(order('sfr001', 56, 2));
    expect((await findOrder('sfr001'))!.state).toBe('COMPLETED');
    await post(order('sfr001', 42, 2));
    const saved = (await findOrder('sfr001'))!;
    expect(saved).toMatchObject({ state: 'COMPLETED', aggregator_status_code: 42 });
    expect(await activeLines(saved.id)).toEqual([2]);
  });

  it('cancels the order when Snappfood cancels it', async () => {
    await post(order('sfr001', 51));
    await post(order('sfr001', 54));
    expect((await findOrder('sfr001'))!).toMatchObject({ state: 'CANCELLED', aggregator_status_code: 54 });
  });

  it('formats from and to on Tehran’s clock', () => {
    expect(tehranTime(new Date('2026-11-07T10:35:09Z'))).toBe('2026-11-07 14:05:09');
  });

  describe('reading a branch on Snappfood staging', () => {
    let calls: Array<{ url: string; init: any }>;
    let answer: (url: string) => { status: number; body?: any };

    beforeAll(async () => {
      await setup.saveBranch(tenantId, falakeGaz, {
        mode: 'STAGING',
        vendorCode: '0fg2zz',
        clientId: 'client',
        clientSecret: 'secret',
        username: 'falake',
        password: 'pw',
        readOnly: true,
      });
    });

    beforeEach(() => {
      calls = [];
      jest.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
        const url = String(input);
        calls.push({ url, init });
        const { status, body } = answer(url);
        return new Response(body === undefined ? null : JSON.stringify(body), { status });
      });
    });

    afterEach(() => jest.restoreAllMocks());

    const conn = () => dataSource.getRepository(SnappfoodConnection).findOneByOrFail({ branch_id: falakeGaz });

    it('asks for the last three hours, records accepted orders only and sends Snappfood nothing else', async () => {
      const products = [{ id: pizzaId, quantity: 1, price: 1100, title: 'پیتزا', vat: 0 }];
      answer = (url) =>
        url.includes('/token')
          ? { status: 200, body: { access_token: 'tok-r', expires_in: 3600 } }
          : {
              status: 200,
              body: {
                data: [
                  { code: 'sfr101', statusCode: 42, price: 1100, products },
                  { code: 'sfr102', statusCode: 61, price: 1100, products },
                ],
              },
            };
      const now = new Date('2026-11-07T10:30:00Z');
      await moduleRef.get(SnappfoodReaderService).readBranch(await conn(), now);

      expect(calls.map((c) => c.url)).toEqual(['https://staging-auth.snappfood.dev/token', 'https://staging-api.snappfood.ir/va/v1/order/latest']);
      expect(JSON.parse(calls[1].init.body)).toEqual({ vendorCode: '0fg2zz', from: '2026-11-07 11:00:00', to: '2026-11-07 14:00:00' });

      expect(await findOrder('sfr101')).toMatchObject({ branch_id: falakeGaz, state: 'COMPLETED' });
      expect(await findOrder('sfr102')).toBeNull();
      expect((await conn()).last_read_at?.toISOString()).toBe(now.toISOString());
      // A read that works is not logged; there is one every 30 seconds.
      const logged = await dataSource.getRepository(IntegrationLog).count({ where: { tenant_id: tenantId, event_type: 'LIVE_ORDER_LATEST' } });
      expect(logged).toBe(0);
    });

    it('keeps the reason a read failed for the settings page, and clears it on the next good read', async () => {
      answer = (url) => (url.includes('/token') ? { status: 200, body: { access_token: 'tok-r', expires_in: 3600 } } : { status: 503, body: [{ status: 503, title: 'down' }] });
      await moduleRef.get(SnappfoodReaderService).readBranch(await conn());
      expect((await conn()).last_read_error).toBe('down');

      answer = () => ({ status: 200, body: [] });
      await moduleRef.get(SnappfoodReaderService).readAll();
      expect((await conn()).last_read_error).toBeNull();
    });
  });
});
