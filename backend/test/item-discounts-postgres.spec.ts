import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { OrderAdjustment } from '../src/entities/OrderAdjustment.entity';
import { ShiftService } from '../src/modules/cashier/shift.service';
import { OrderService } from '../src/modules/order/order.service';
import { ItemDiscountsService } from '../src/modules/discounts/item-discounts.service';
import { DiscountEvaluationService } from '../src/modules/discounts/discount-evaluation.service';
import { loadBusinessClock } from '../src/common/utils/business-clock';
import { deleteTenantData } from './utils/tenant-teardown';

// Automatic item discounts (V1, 2026-10-03), as HAMI branches use them: a dated percent off a
// product, taken off the line first; the one order discount then works on what is left.
describe('Automatic item discounts (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: OrderService;
  let itemDiscounts: ItemDiscountsService;
  let engine: DiscountEvaluationService;
  let tenantId: string;
  let branchId: string;
  let terminalId: string;
  let shiftId: string;
  let burger: string;
  let fries: string;
  let today: string;

  const shiftDay = (date: string, days: number) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    orders = moduleRef.get(OrderService);
    itemDiscounts = moduleRef.get(ItemDiscountsService);
    engine = moduleRef.get(DiscountEvaluationService);
    const shifts = moduleRef.get(ShiftService);

    const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
    tenantId = (await save(Tenant, { code: `ITEMDISC-${Date.now()}`, name: 'Item discounts', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'ID1', name: 'Nasr', is_active: true, time_zone: 'Asia/Tehran' })).id;
    terminalId = (await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'ID-1', name: 'Till 1', terminal_type: 'CASHIER', is_active: true })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'ID-MAINS', name: 'Mains', is_active: true })).id;
    burger = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'MUSHROOM', name: 'Cheese mushroom', base_price: '100000.0000', tax_rate: '0.0000', is_active: true })).id;
    fries = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'FRIES', name: 'Fries', base_price: '50000.0000', tax_rate: '0.0000', is_active: true })).id;
    shiftId = ((await shifts.openShift(tenantId, { terminalId } as any)) as any).id;
    today = (await loadBusinessClock(dataSource.manager, tenantId, branchId)).today();
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const sell = async (items: Array<{ product_id: string; quantity: number }>, dto: any = {}) => {
    const draft = await orders.createDraft(tenantId, {
      branch_id: branchId,
      terminal_id: terminalId,
      shift_id: shiftId,
      order_type: 'TAKEAWAY',
      channel: 'POS',
      items,
    } as any);
    await orders.submitOrder(tenantId, draft.id, dto);
    return dataSource.getRepository(OrderHeader).findOneByOrFail({ id: draft.id });
  };
  const lines = (orderId: string) => dataSource.getRepository(OrderItem).find({ where: { order_id: orderId }, order: { line_number: 'ASC' } });

  it('refuses a discount that overlaps another on the same item, or has bad dates', async () => {
    await itemDiscounts.create(tenantId, { product_id: burger, percent: 20, starts_on: today, ends_on: shiftDay(today, 10) });
    await expect(itemDiscounts.create(tenantId, { product_id: burger, percent: 15, starts_on: shiftDay(today, 5), ends_on: null })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ITEM_DISCOUNT_OVERLAP' }),
    });
    await expect(itemDiscounts.create(tenantId, { product_id: fries, percent: 0, starts_on: today })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ITEM_DISCOUNT_PERCENT' }),
    });
    await expect(itemDiscounts.create(tenantId, { product_id: fries, percent: 10, starts_on: today, ends_on: shiftDay(today, -1) })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ITEM_DISCOUNT_DATES' }),
    });
  });

  it("shows the discount on the till's live quote, on the discounted item only", async () => {
    const quote = await engine.evaluateQuote(tenantId, {
      orderDraft: { branchId, items: [{ productId: burger, unitPrice: '100000', quantity: '1' }, { productId: fries, unitPrice: '50000', quantity: '1' }] },
    } as any);
    expect(quote.items[0]).toMatchObject({ itemDiscountPercent: '20.00', itemDiscountTotal: '20000.0000' });
    expect(quote.items[1]).toMatchObject({ itemDiscountPercent: '0.00', itemDiscountTotal: '0.0000' });
    expect(quote.grandTotal).toBe('130000.0000');
  });

  it('takes the item discount off the line when the order is sent, and keeps it on the line', async () => {
    const order = await sell([{ product_id: burger, quantity: 2 }, { product_id: fries, quantity: 1 }]);
    expect(order.discount_total).toBe('40000.0000');
    expect(order.item_discount_total).toBe('40000.0000');
    expect(order.grand_total).toBe('210000.0000');
    const [b, f] = await lines(order.id);
    expect(b).toMatchObject({ item_discount_percent: '20.00', item_discount_total: '40000.0000' });
    expect(f).toMatchObject({ item_discount_percent: '0.00', item_discount_total: '0.0000' });
    const adjustments = await dataSource.getRepository(OrderAdjustment).find({ where: { order_id: order.id } });
    expect(adjustments).toEqual([expect.objectContaining({ source_type: 'ITEM', code: 'ITEM_DISCOUNT', amount: '40000.0000' })]);
  });

  it('applies the one order discount to what is left, as HAMI does', async () => {
    // Cheese mushroom 100,000 − 20% = 80,000; with fries 50,000 that leaves 130,000; 10% of it is 13,000.
    const order = await sell([{ product_id: burger, quantity: 1 }, { product_id: fries, quantity: 1 }], {
      manualDiscount: { calculation_type: 'PERCENTAGE', value: '10' },
    });
    expect(order.item_discount_total).toBe('20000.0000');
    expect(order.discount_total).toBe('33000.0000');
    expect(order.grand_total).toBe('117000.0000');
  });

  it('keeps the order discount and drops a voided line’s item discount when the totals are worked out again', async () => {
    const order = await sell([{ product_id: burger, quantity: 1 }, { product_id: fries, quantity: 1 }], {
      manualDiscount: { calculation_type: 'PERCENTAGE', value: '10' },
    });
    const [b] = await lines(order.id);
    await dataSource.getRepository(OrderItem).update({ id: b.id }, { state: 'VOIDED' } as any);
    const again = await dataSource.transaction((em) => orders.recalculateOrderTotals(tenantId, order, em));
    // The 13,000 order discount stays; the 20,000 item discount left with the burger.
    expect(again.item_discount_total).toBe('0.0000');
    expect(again.discount_total).toBe('13000.0000');
    expect(again.grand_total).toBe('37000.0000');
    // Working it out once more changes nothing.
    const twice = await dataSource.transaction((em) => orders.recalculateOrderTotals(tenantId, again, em));
    expect(twice.discount_total).toBe('13000.0000');
  });

  it('does nothing outside its dates', async () => {
    const [current] = await itemDiscounts.list(tenantId);
    await itemDiscounts.update(tenantId, current.id, { starts_on: shiftDay(today, 1), ends_on: shiftDay(today, 3) });
    const order = await sell([{ product_id: burger, quantity: 1 }]);
    expect(order.discount_total).toBe('0.0000');
    expect(order.grand_total).toBe('100000.0000');
  });
});
