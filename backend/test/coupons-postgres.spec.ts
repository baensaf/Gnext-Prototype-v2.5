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
});
