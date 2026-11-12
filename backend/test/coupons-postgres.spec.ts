import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { Coupon } from '../src/entities/Coupon.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderAdjustment } from '../src/entities/OrderAdjustment.entity';
import { Customer } from '../src/entities/Customer.entity';
import { CouponUse } from '../src/entities/CouponUse.entity';
import { addDays } from '../src/common/utils/business-day';
import { ShiftService } from '../src/modules/cashier/shift.service';
import { OrderService } from '../src/modules/order/order.service';
import { CouponsService } from '../src/modules/discounts/coupons.service';
import { loadBusinessClock } from '../src/common/utils/business-clock';
import { deleteTenantData } from './utils/tenant-teardown';

// One-time coupons (V2, 2026-10-13): head office makes a batch of codes, each works once at
// the till for a percent off or one free item, and is the order's one order discount.
describe('One-time coupons (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: OrderService;
  let coupons: CouponsService;
  let tenantId: string;
  let branchId: string;
  let terminalId: string;
  let shiftId: string;
  let burger: string;
  let drink: string;
  let today: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    orders = moduleRef.get(OrderService);
    coupons = moduleRef.get(CouponsService);
    const shifts = moduleRef.get(ShiftService);

    const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
    tenantId = (await save(Tenant, { code: `COUPON-${Date.now()}`, name: 'Coupons', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'CP1', name: 'Nasr', is_active: true, time_zone: 'Asia/Tehran' })).id;
    terminalId = (await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'CP-1', name: 'Till 1', terminal_type: 'CASHIER', is_active: true })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'CP-MAINS', name: 'Mains', is_active: true })).id;
    burger = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'BURGER', name: 'Burger', base_price: '100000.0000', tax_rate: '0.0000', is_active: true })).id;
    drink = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'COLA', name: 'Cola', base_price: '30000.0000', tax_rate: '0.0000', is_active: true })).id;
    shiftId = ((await shifts.openShift(tenantId, { terminalId } as any)) as any).id;
    today = (await loadBusinessClock(dataSource.manager, tenantId, branchId)).today();
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const draft = (items: Array<{ product_id: string; quantity: number }>) =>
    orders.createDraft(tenantId, { branch_id: branchId, terminal_id: terminalId, shift_id: shiftId, order_type: 'TAKEAWAY', channel: 'POS', items } as any);

  const codesOf = async (batchId: string) =>
    (await dataSource.getRepository(Coupon).find({ where: { tenant_id: tenantId, batch_id: batchId } })).map((c) => c.code);

  it('makes a batch of distinct one-time codes', async () => {
    const batch = await coupons.createBatch(tenantId, { name: 'Club SMS', reward_type: 'PERCENT', percent: '20', count: 50 });
    const codes = await codesOf(batch.id);
    expect(codes).toHaveLength(50);
    expect(new Set(codes).size).toBe(50);
    expect(codes.every((c) => /^[A-HJKMNP-Z2-9]{8}$/.test(c))).toBe(true);
  });

  it('takes a percent off the order, once, and gives the code back when the order is cancelled', async () => {
    const batch = await coupons.createBatch(tenantId, { name: '20% off', reward_type: 'PERCENT', percent: '20', max_discount: '30000', count: 1 });
    const [code] = await codesOf(batch.id);

    const first = await draft([{ product_id: burger, quantity: 2 }]);
    await orders.submitOrder(tenantId, first.id, { couponCode: code.toLowerCase() } as any);
    const sent = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: first.id });
    // 20% of 200,000 is 40,000, capped at 30,000.
    expect(sent.discount_total).toBe('30000.0000');
    const adjustment = await dataSource.getRepository(OrderAdjustment).findOneByOrFail({ order_id: first.id, source_type: 'COUPON' });
    expect(adjustment.code).toBe('COUPON');

    const second = await draft([{ product_id: burger, quantity: 1 }]);
    await expect(orders.submitOrder(tenantId, second.id, { couponCode: code } as any)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'COUPON_REFUSED', reason: 'USED' }),
    });

    await coupons.releaseForOrder(tenantId, first.id);
    const again = await coupons.check(tenantId, code, { branchId, subtotal: '100000', productIds: [burger] });
    expect(again.ok).toBe(true);
  });

  it('gives one of the free product, and only when it is on the order', async () => {
    const batch = await coupons.createBatch(tenantId, { name: 'Free cola', reward_type: 'FREE_ITEM', reward_product_id: drink, count: 2 });
    const [code] = await codesOf(batch.id);

    const missing = await coupons.check(tenantId, code, { branchId, subtotal: '100000', productIds: [burger] });
    expect(missing).toMatchObject({ ok: false, reason: 'ITEM_MISSING' });

    const order = await draft([{ product_id: burger, quantity: 1 }, { product_id: drink, quantity: 2 }]);
    await orders.submitOrder(tenantId, order.id, { couponCode: code } as any);
    const sent = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: order.id });
    expect(sent.discount_total).toBe('30000.0000');
  });

  it("is the order's one discount: the cashier's discount steps aside", async () => {
    const batch = await coupons.createBatch(tenantId, { name: '10% off', reward_type: 'PERCENT', percent: '10', count: 1 });
    const [code] = await codesOf(batch.id);
    const order = await draft([{ product_id: burger, quantity: 1 }]);
    await orders.submitOrder(tenantId, order.id, {
      couponCode: code,
      manualDiscount: { calculation_type: 'PERCENTAGE', value: '5' },
    } as any);
    const sent = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: order.id });
    expect(sent.discount_total).toBe('10000.0000');
  });

  it('refuses a code outside its days, below its minimum, or in a batch switched off', async () => {
    const later = await coupons.createBatch(tenantId, { name: 'Next month', reward_type: 'PERCENT', percent: '10', valid_from: '2999-01-01', count: 1 });
    const minimum = await coupons.createBatch(tenantId, { name: 'Big orders', reward_type: 'PERCENT', percent: '10', min_subtotal: '500000', count: 1 });
    const off = await coupons.createBatch(tenantId, { name: 'Stopped', reward_type: 'PERCENT', percent: '10', valid_to: today, count: 1 });
    await coupons.setActive(tenantId, off.id, false);
    const order = { branchId, subtotal: '100000', productIds: [burger] };

    expect(await coupons.check(tenantId, (await codesOf(later.id))[0], order)).toMatchObject({ ok: false, reason: 'NOT_YET' });
    expect(await coupons.check(tenantId, (await codesOf(minimum.id))[0], order)).toMatchObject({ ok: false, reason: 'BELOW_MINIMUM' });
    expect(await coupons.check(tenantId, (await codesOf(off.id))[0], order)).toMatchObject({ ok: false, reason: 'OFF' });
    expect(await coupons.check(tenantId, 'NOPE2345', order)).toMatchObject({ ok: false, reason: 'UNKNOWN' });
  });

  // Shared codes (2026-11-12): one code head office chooses, typed by many customers, like
  // HamiClub's 10/15/20% codes, within limits per customer, per customer a day, and in all.
  describe('shared codes', () => {
    const customer = async (mobile: string) =>
      (await dataSource.getRepository(Customer).save(
        dataSource.getRepository(Customer).create({ tenant_id: tenantId, code: mobile, first_name: 'Club', last_name: mobile.slice(-4), mobile, is_active: true }),
      )).id as string;
    const draftFor = (customerId: string | null) =>
      orders.createDraft(tenantId, {
        branch_id: branchId, terminal_id: terminalId, shift_id: shiftId, order_type: 'TAKEAWAY', channel: 'POS',
        ...(customerId ? { customer_id: customerId } : {}),
        items: [{ product_id: burger, quantity: 1 }],
      } as any);
    const refusedWith = (reason: string) => ({ response: expect.objectContaining({ code: 'COUPON_REFUSED', reason }) });

    it('refuses a code that is taken or not Latin letters and digits', async () => {
      await coupons.createBatch(tenantId, { name: 'Club 20%', kind: 'SHARED', code: 'club-20', reward_type: 'PERCENT', percent: '20' });
      await expect(coupons.createBatch(tenantId, { name: 'Again', kind: 'SHARED', code: 'CLUB20', reward_type: 'PERCENT', percent: '20' }))
        .rejects.toMatchObject({ response: expect.objectContaining({ code: 'COUPON_CODE_TAKEN' }) });
      await expect(coupons.createBatch(tenantId, { name: 'Bad', kind: 'SHARED', code: 'تخفیف', reward_type: 'PERCENT', percent: '20' }))
        .rejects.toMatchObject({ response: expect.objectContaining({ code: 'COUPON_CODE_INVALID' }) });
    });

    it('works for many customers, once a day each, and up to its total', async () => {
      const batch = await coupons.createBatch(tenantId, {
        name: 'Club 15%', kind: 'SHARED', code: 'IB15', reward_type: 'PERCENT', percent: '15',
        uses_per_customer_per_day: 1, max_uses: 3,
      });
      expect(batch).toMatchObject({ kind: 'SHARED', code_count: 1, uses_per_customer_per_day: 1, max_uses: 3 });
      const [a, b, c, d] = [await customer('+989121000001'), await customer('+989121000002'), await customer('+989121000003'), await customer('+989121000004')];

      // Counted per customer, so the order needs one.
      const anonymous = await draftFor(null);
      await expect(orders.submitOrder(tenantId, anonymous.id, { couponCode: 'ib15' } as any)).rejects.toMatchObject(refusedWith('NEEDS_CUSTOMER'));

      const first = await draftFor(a);
      await orders.submitOrder(tenantId, first.id, { couponCode: 'ib15' } as any);
      expect((await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: first.id })).discount_total).toBe('15000.0000');

      const againToday = await draftFor(a);
      await expect(orders.submitOrder(tenantId, againToday.id, { couponCode: 'IB15' } as any)).rejects.toMatchObject(refusedWith('CUSTOMER_TODAY'));

      await orders.submitOrder(tenantId, (await draftFor(b)).id, { couponCode: 'IB15' } as any);
      await orders.submitOrder(tenantId, (await draftFor(c)).id, { couponCode: 'IB15' } as any);
      await expect(orders.submitOrder(tenantId, (await draftFor(d)).id, { couponCode: 'IB15' } as any)).rejects.toMatchObject(refusedWith('USED_UP'));

      const listed = (await coupons.listBatches(tenantId)).find((x: any) => x.id === batch.id);
      expect(listed).toMatchObject({ used_count: 3, shared_code: 'IB15' });
      const { codes } = await coupons.listCodes(tenantId, batch.id);
      expect(codes).toHaveLength(3);
      expect(codes[0].used_customer_mobile).toBe('+989121000003');

      // A cancelled order gives its use back.
      await coupons.releaseForOrder(tenantId, first.id);
      expect(await coupons.check(tenantId, 'IB15', { branchId, subtotal: '100000', productIds: [burger], customerId: d })).toMatchObject({ ok: true });
    });

    it('stops a customer at their own limit across days', async () => {
      const batch = await coupons.createBatch(tenantId, { name: 'Club 10%', kind: 'SHARED', code: 'IB10', reward_type: 'PERCENT', percent: '10', uses_per_customer: 2 });
      const a = await customer('+989121000005');
      const [coupon] = await dataSource.query(`SELECT id FROM coupon WHERE batch_id = $1`, [batch.id]);
      // Two earlier days' orders.
      for (const days of [2, 1]) {
        await dataSource.getRepository(CouponUse).save({
          tenant_id: tenantId, coupon_id: coupon.id, batch_id: batch.id, order_id: (await draftFor(a)).id,
          customer_id: a, branch_id: branchId, business_date: addDays(today, -days),
        });
      }
      expect(await coupons.check(tenantId, 'IB10', { branchId, subtotal: '100000', productIds: [burger], customerId: a }))
        .toMatchObject({ ok: false, reason: 'CUSTOMER_LIMIT' });
    });
  });
});
