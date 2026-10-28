import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as crypto from 'crypto';
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
import { IntegrationLog } from '../src/entities/IntegrationLog.entity';
import { SnappfoodConnection } from '../src/entities/SnappfoodConnection.entity';
import { SnappfoodSetupService } from '../src/modules/snappfood/snappfood-setup.service';
import { OrderService } from '../src/modules/order/order.service';
import { ChannelRefusal } from '../src/modules/order/channels';
import { verifySnappfoodHmac } from '../src/modules/simulation/snappfood-webhook.controller';
import { deleteTenantData } from './utils/tenant-teardown';

// Snappfood's real webhook (annex 4.3.0, section 5): one address per chain, the branch from the
// order's vendorCode, the order form-encoded, 200 back. A branch switched to staging answers
// its orders on Snappfood's servers; fetch stands in for them here.
describe('Snappfood webhook and live order calls (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let setup: SnappfoodSetupService;
  let tenantId: string;
  let vanak: string;
  let tajrish: string;
  let path: string;
  let pizzaId: number;

  const post = (url: string, form: string, headers: Record<string, string> = {}) => {
    const req = request(app.getHttpServer()).post(url).type('form').set('User-Agent', 'SnappFood');
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    return req.send(form);
  };

  /** The annex's own form-encoded sample, with the code and vendor swapped in. */
  const order = (code: string, vendorCode: string, statusCode = 56, extra = '') =>
    [
      `code=${code}`,
      'userCode=0gw43n',
      `fullName=${encodeURIComponent('حمید بیانک')}`,
      `firstName=${encodeURIComponent('حمید')}`,
      `lastName=${encodeURIComponent('بیانک')}`,
      'userAddressCode=5q5y1x',
      'phone=%2B989991111111',
      'price=1910',
      `comment=${encodeURIComponent('تست اردر')}`,
      `statusCode=${statusCode}`,
      `deliverAddress=${encodeURIComponent('تهران، زعفرانیه')}`,
      'orderDate=1714389167&latitude=35.804123071093&longitude=51.419917821847',
      'deliveryPrice=500&packingPrice=200&deliveryTime=48&preparationTime=15&taxCoeff=10&tax=110&vat=0.1',
      'expeditionType=DELIVERY&discountType=&discountValue=0',
      'orderPaymentTypeCode=CASH&vendorMaxPreparationTime=15',
      `vendorCode=${vendorCode}`,
      `products%5B0%5D%5Bid%5D=${pizzaId}&products%5B0%5D%5Bquantity%5D=1&products%5B0%5D%5Bprice%5D=500&products%5B0%5D%5BoriginPrice%5D=500`,
      `products%5B0%5D%5Btitle%5D=${encodeURIComponent('پیتزای تستی ۱')}&products%5B0%5D%5Bvat%5D=0.1&products%5B0%5D%5Bbarcode%5D=`,
      'products%5B1%5D%5Bid%5D=102&products%5B1%5D%5Bquantity%5D=1&products%5B1%5D%5Bprice%5D=600&products%5B1%5D%5BoriginPrice%5D=600',
      `products%5B1%5D%5Btitle%5D=${encodeURIComponent('پیتزای تستی ۲')}&products%5B1%5D%5Bvat%5D=0.1&products%5B1%5D%5Bbarcode%5D=`,
      'couponDiscountSfShareAmount=0&couponDiscountVendorShareAmount=0&bikerName=&canBeDeliveredByOnDemandExpressTrip=0',
      extra,
    ]
      .filter(Boolean)
      .join('&');

  const findOrder = (code: string) => dataSource.getRepository(OrderHeader).findOne({ where: { tenant_id: tenantId, order_number: `SNP-${code}` } });

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
    tenantId = (await save(Tenant, { code: `SFHOOK-${Date.now()}`, name: 'Snappfood webhook fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    vanak = (await save(Branch, { tenant_id: tenantId, code: 'VANAK', name: 'Vanak', is_active: true, time_zone: 'Asia/Tehran' })).id;
    tajrish = (await save(Branch, { tenant_id: tenantId, code: 'TAJRISH', name: 'Tajrish', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'SFH-PIZZA', name: 'Pizza', is_active: true })).id;
    const pizza = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'P1', name: 'Pizza one', base_price: '5000.0000', tax_rate: '0.0000', is_active: true })).id;
    // Our id for the pizza on Snappfood, given out when the product was saved.
    const mapped = await dataSource.getRepository(ChannelItemMap).findOneBy({ tenant_id: tenantId, channel: 'SNAPPFOOD', entity_id: pizza });
    pizzaId = mapped?.external_id ?? 101;

    await setup.saveBranch(tenantId, vanak, { mode: 'SIMULATED', vendorCode: '0q54rd' });
    await setup.saveBranch(tenantId, tajrish, { mode: 'SIMULATED', vendorCode: '0tj9xx' });
    path = (await setup.getSetup(tenantId)).webhook.path;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await deleteTenantData(dataSource, tenantId);
    await dataSource.query(`DELETE FROM snappfood_connection WHERE tenant_id = $1`, [tenantId]);
    await dataSource.query(`DELETE FROM snappfood_webhook WHERE tenant_id = $1`, [tenantId]);
    await app.close();
  });

  it('gives the chain one address under /api/v1, which nginx forwards', () => {
    expect(path).toMatch(/^\/api\/v1\/webhooks\/snappfood\/[0-9a-f]{48}$/);
  });

  it('takes a form-encoded order without a session, answers 200, and files it under the vendor’s branch', async () => {
    const res = await post(path, order('sfh00001', '0tj9xx'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, duplicate: false });

    const saved = await findOrder('sfh00001');
    expect(saved).toMatchObject({ branch_id: tajrish, state: 'PENDING_ACCEPTANCE', channel: 'AGGREGATOR', aggregator_expedition: 'DELIVERY' });
    // 1,910 Toman as Snappfood billed it, kept in Rial.
    expect(Number(saved!.grand_total)).toBe(19100);
    const lines = await dataSource.getRepository(OrderItem).find({ where: { tenant_id: tenantId, order_id: saved!.id }, order: { line_number: 'ASC' } });
    expect(lines.map((l) => [l.product_name, Number(l.unit_price)])).toEqual([
      ['پیتزای تستی ۱', 5000],
      ['پیتزای تستی ۲', 6000],
    ]);
    // A simulated branch acks in the simulator.
    const ack = await dataSource.getRepository(IntegrationLog).findOne({ where: { tenant_id: tenantId, event_type: 'ORDER_ACK' } });
    expect(ack?.request_payload).toMatchObject({ orderCode: 'sfh00001' });
  });

  it('answers the same order and status again with 200, as a duplicate', async () => {
    const res = await post(path, order('sfh00001', '0tj9xx'));
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
  });

  it('does not read an empty bikerStatusV2 as the rider moving', async () => {
    const res = await post(path, order('sfh00001', '0tj9xx', 42, 'bikerStatusV2='));
    expect(res.status).toBe(200);
    expect((await findOrder('sfh00001'))!.state).toBe('PENDING_ACCEPTANCE');
  });

  it('refuses an unknown address, and a vendor code no branch has', async () => {
    expect((await post('/api/v1/webhooks/snappfood/not-a-token', order('sfh00002', '0q54rd'))).status).toBe(404);

    const res = await post(path, order('sfh00003', 'nobody'));
    expect(res.status).toBe(404);
    expect(await findOrder('sfh00003')).toBeNull();
    const log = await dataSource.getRepository(IntegrationLog).findOne({ where: { tenant_id: tenantId, status: 'REJECTED' } });
    expect(log?.error_message).toContain('nobody');
  });

  it('checks Snappfood’s HMAC header once a secret is saved', async () => {
    await setup.setHmacSecret(tenantId, 'shh');
    try {
      expect((await post(path, order('sfh00004', '0q54rd'))).status).toBe(401);

      const ts = String(Math.floor(Date.now() / 1000));
      const sig = crypto.createHmac('sha256', 'shh').update('POST' + ts).digest('base64');
      const res = await post(path, order('sfh00004', '0q54rd'), { Authorization: `HMAC snappfood:${ts}:${sig}` });
      expect(res.status).toBe(200);
      expect((await findOrder('sfh00004'))!.branch_id).toBe(vanak);
    } finally {
      await setup.setHmacSecret(tenantId, null);
    }
  });

  it('rejects a stale or forged HMAC', () => {
    const at = (ts: number, secret = 'k') =>
      `HMAC snappfood:${ts}:${crypto.createHmac('sha256', secret).update('POST' + ts).digest('base64')}`;
    const now = Date.now();
    expect(verifySnappfoodHmac(at(Math.floor(now / 1000)), 'k', now)).toBe(true);
    expect(verifySnappfoodHmac(at(Math.floor(now / 1000) - 3600), 'k', now)).toBe(false);
    expect(verifySnappfoodHmac(at(Math.floor(now / 1000), 'other'), 'k', now)).toBe(false);
    expect(verifySnappfoodHmac(undefined, 'k', now)).toBe(false);
  });

  it('won’t switch a branch to staging without a whole account, and keeps secrets out of the page', async () => {
    await expect(setup.saveBranch(tenantId, vanak, { mode: 'STAGING', vendorCode: '0q54rd' })).rejects.toMatchObject({
      response: { code: 'SNAPPFOOD_ACCOUNT_INCOMPLETE' },
    });
    await setup.saveBranch(tenantId, vanak, {
      mode: 'STAGING',
      vendorCode: '0q54rd',
      clientId: 'client',
      clientSecret: 'secret',
      username: 'vanak',
      password: 'pw',
    });
    const page = await setup.getSetup(tenantId);
    const row = page.branches.find((b) => b.branch_id === vanak)!;
    expect(row).toMatchObject({ mode: 'STAGING', live: true, has_client_secret: true, has_password: true });
    expect(JSON.stringify(page)).not.toContain('"secret"');
    expect(JSON.stringify(page)).not.toContain('"pw"');
  });

  describe('a branch on Snappfood staging', () => {
    let calls: Array<{ url: string; init: any }>;
    let answer: (url: string) => { status: number; body?: any };

    beforeEach(() => {
      calls = [];
      answer = (url) => (url.includes('/token') ? { status: 200, body: { access_token: 'tok-1', expires_in: 3600 } } : { status: 204 });
      jest.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
        const url = String(input);
        calls.push({ url, init });
        const { status, body } = answer(url);
        return new Response(body === undefined ? null : JSON.stringify(body), { status });
      });
    });

    afterEach(() => jest.restoreAllMocks());

    it('signs in with the password grant and acks the order on Snappfood', async () => {
      const res = await post(path, order('sfh00010', '0q54rd'));
      expect(res.status).toBe(200);

      expect(calls[0].url).toBe('https://staging-auth.snappfood.dev/token');
      const form = new URLSearchParams(calls[0].init.body);
      expect(Object.fromEntries(form)).toEqual({
        grant_type: 'password',
        scope: 'automation',
        client_id: 'client',
        client_secret: 'secret',
        username: 'vanak',
        password: 'pw',
      });
      expect(calls[1].url).toBe('https://staging-api.snappfood.ir/va/v1/order/sfh00010/ack');
      expect(calls[1].init.headers.Authorization).toBe('Bearer tok-1');
      const conn = await dataSource.getRepository(SnappfoodConnection).findOneBy({ branch_id: vanak });
      expect(conn?.access_token).toBe('tok-1');
    });

    it('accepts with deliveryTime for its own courier, reusing the token', async () => {
      const orders = moduleRef.get(OrderService);
      const saved = (await findOrder('sfh00010'))!;
      await orders.channelOf(saved)!.accepted(tenantId, saved, 40);

      expect(calls.map((c) => c.url)).toEqual(['https://staging-api.snappfood.ir/va/v1/order/sfh00010/accept']);
      expect(JSON.parse(calls[0].init.body)).toEqual({ deliveryTime: 40 });
    });

    it('passes Snappfood’s refusal to staff with its code', async () => {
      answer = () => ({ status: 400, body: [{ status: '2110', title: 'time', detail: 'Delivery or preparation time exceeds our limits' }] });
      const orders = moduleRef.get(OrderService);
      const saved = (await findOrder('sfh00010'))!;
      const err = await orders.channelOf(saved)!.accepted(tenantId, saved, 40).catch((e) => e);
      expect(err).toBeInstanceOf(ChannelRefusal);
      expect(err).toMatchObject({ code: '2110', message: 'Delivery or preparation time exceeds our limits' });
      const log = await dataSource.getRepository(IntegrationLog).findOne({
        where: { tenant_id: tenantId, event_type: 'LIVE_ORDER_ACCEPT', status: 'FAILED' },
      });
      expect(log?.error_message).toContain('exceeds');
    });

    it('signs in again when Snappfood says the token went stale', async () => {
      let first = true;
      answer = (url) => {
        if (url.includes('/token')) return { status: 200, body: { access_token: 'tok-2', expires_in: 3600 } };
        if (first) {
          first = false;
          return { status: 401 };
        }
        return { status: 204 };
      };
      const orders = moduleRef.get(OrderService);
      const saved = (await findOrder('sfh00010'))!;
      await orders.channelOf(saved)!.opened(tenantId, saved);
      expect(calls.map((c) => c.url)).toEqual([
        'https://staging-api.snappfood.ir/va/v1/order/sfh00010/pick',
        'https://staging-auth.snappfood.dev/token',
        'https://staging-api.snappfood.ir/va/v1/order/sfh00010/pick',
      ]);
      expect(calls[2].init.headers.Authorization).toBe('Bearer tok-2');
    });
  });
});
