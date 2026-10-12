import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { ItemDiscount } from '../src/entities/ItemDiscount.entity';
import { OrderService } from '../src/modules/order/order.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { PriceListService } from '../src/modules/catalog/price-lists.service';
import { KioskService } from '../src/modules/kiosk/kiosk.service';
import { ItemDiscountsService } from '../src/modules/discounts/item-discounts.service';
import { DiscountEvaluationService } from '../src/modules/discounts/discount-evaluation.service';
import { SnappfoodCatalogService } from '../src/modules/simulation/snappfood-catalog.service';
import { loadBusinessClock } from '../src/common/utils/business-clock';
import { deleteTenantData } from './utils/tenant-teardown';

// Item discounts on price groups (2026-10-12): for all groups or chosen ones, in store (till and
// kiosk), on Snappfood, or both. A branch with no group is covered by "all groups" only.
describe('Item discounts by price group and channel (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: OrderService;
  let catalog: CatalogService;
  let priceLists: PriceListService;
  let kiosk: KioskService;
  let discounts: ItemDiscountsService;
  let engine: DiscountEvaluationService;
  let sync: SnappfoodCatalogService;
  let tenantId: string;
  let uptown: string;
  let downtown: string;
  let loose: string;
  let groupA: string;
  let groupB: string;
  let burger: string;
  let fries: string;
  let today: string;

  const day = (days: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    orders = moduleRef.get(OrderService);
    catalog = moduleRef.get(CatalogService);
    priceLists = moduleRef.get(PriceListService);
    kiosk = moduleRef.get(KioskService);
    discounts = moduleRef.get(ItemDiscountsService);
    engine = moduleRef.get(DiscountEvaluationService);
    sync = moduleRef.get(SnappfoodCatalogService);

    const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
    tenantId = (await save(Tenant, { code: `IDGRP-${Date.now()}`, name: 'Item discount groups', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    const branch = async (code: string) => (await save(Branch, { tenant_id: tenantId, code, name: code, is_active: true, time_zone: 'Asia/Tehran' })).id;
    uptown = await branch('UP');
    downtown = await branch('DOWN');
    loose = await branch('LOOSE');
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'IG-MAINS', name: 'Mains', is_active: true })).id;
    burger = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'BURGER', name: 'Burger', base_price: '100000.0000', tax_rate: '0.0000', is_active: true })).id;
    fries = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'FRIES', name: 'Fries', base_price: '50000.0000', tax_rate: '0.0000', is_active: true })).id;
    groupA = (await priceLists.createPriceList(tenantId, { name: 'Group A' }, 'test')).id;
    groupB = (await priceLists.createPriceList(tenantId, { name: 'Group B' }, 'test')).id;
    await priceLists.assignBranch(tenantId, uptown, groupA, 'test');
    await priceLists.assignBranch(tenantId, downtown, groupB, 'test');
    // Snappfood: group A sells the burger at 120,000.
    await priceLists.setListPrice(tenantId, groupA, burger, null, '120000', 'test', 'SNAPPFOOD');
    today = (await loadBusinessClock(dataSource.manager, tenantId, uptown)).today();
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  afterEach(async () => {
    await dataSource.getRepository(ItemDiscount).delete({ tenant_id: tenantId });
  });

  const quoteLine = async (branchId: string, channel = 'POS') => {
    const quote = await engine.evaluateQuote(tenantId, {
      orderDraft: { branchId, channel, items: [{ productId: burger, unitPrice: '100000', quantity: '1' }] },
    } as any);
    return quote.items[0];
  };
  const sheetRow = async (branchId: string, productId = burger) =>
    (await catalog.getChannelPriceSheet(tenantId, 'SNAPPFOOD', branchId)).items.find((i) => i.product_id === productId)!;

  it('defaults to all groups, in store: every branch gets it, grouped or not', async () => {
    const made = await discounts.create(tenantId, { product_id: burger, percent: 20, starts_on: today });
    expect(made).toMatchObject({ all_groups: true, price_group_ids: [], applies_to: 'IN_STORE' });
    for (const branchId of [uptown, downtown, loose]) {
      expect(await quoteLine(branchId)).toMatchObject({ itemDiscountPercent: '20.00', itemDiscountTotal: '20000.0000' });
    }
  });

  it('gives existing rows all groups and in store by their column defaults', async () => {
    await dataSource.query(`INSERT INTO item_discount (tenant_id, product_id, percent, starts_on) VALUES ($1, $2, 10, $3)`, [tenantId, burger, today]);
    const [row] = await discounts.list(tenantId);
    expect(row).toMatchObject({ all_groups: true, price_group_ids: [], applies_to: 'IN_STORE' });
    expect(await quoteLine(loose)).toMatchObject({ itemDiscountPercent: '10.00' });
  });

  it("applies a chosen group's discount to that group's branches only, never to a branch with no group", async () => {
    await discounts.create(tenantId, { product_id: burger, percent: 30, starts_on: today, all_groups: false, price_group_ids: [groupA] });
    expect(await quoteLine(uptown)).toMatchObject({ itemDiscountPercent: '30.00' });
    expect(await quoteLine(downtown)).toMatchObject({ itemDiscountPercent: '0.00' });
    expect(await quoteLine(loose)).toMatchObject({ itemDiscountPercent: '0.00' });
  });

  it('refuses a group scope with no group, or a group that is not there', async () => {
    await expect(discounts.create(tenantId, { product_id: burger, percent: 10, starts_on: today, all_groups: false, price_group_ids: [] })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ITEM_DISCOUNT_GROUPS' }),
    });
    await expect(
      discounts.create(tenantId, { product_id: burger, percent: 10, starts_on: today, all_groups: false, price_group_ids: ['00000000-0000-4000-8000-000000000000'] }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ITEM_DISCOUNT_GROUPS' }) });
    await expect(discounts.create(tenantId, { product_id: burger, percent: 10, starts_on: today, applies_to: 'TAPSI' as any })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ITEM_DISCOUNT_CHANNEL' }),
    });
  });

  it('refuses an overlap only when dates, a group and a channel are all shared', async () => {
    const overlap = { response: expect.objectContaining({ code: 'ITEM_DISCOUNT_OVERLAP' }) };
    await discounts.create(tenantId, { product_id: burger, percent: 10, starts_on: today, ends_on: day(10), all_groups: false, price_group_ids: [groupA], applies_to: 'IN_STORE' });
    // Another group, same dates and channel: fine.
    await discounts.create(tenantId, { product_id: burger, percent: 15, starts_on: today, ends_on: day(10), all_groups: false, price_group_ids: [groupB], applies_to: 'IN_STORE' });
    // Same group and dates but the other channel: fine.
    await discounts.create(tenantId, { product_id: burger, percent: 12, starts_on: today, ends_on: day(10), all_groups: false, price_group_ids: [groupA], applies_to: 'SNAPPFOOD' });
    // The same group, channel and overlapping dates: refused.
    await expect(
      discounts.create(tenantId, { product_id: burger, percent: 5, starts_on: day(5), all_groups: false, price_group_ids: [groupA, groupB], applies_to: 'IN_STORE' }),
    ).rejects.toMatchObject(overlap);
    // All groups clashes with any group on that channel.
    await expect(discounts.create(tenantId, { product_id: burger, percent: 5, starts_on: day(5), applies_to: 'IN_STORE' })).rejects.toMatchObject(overlap);
    // Both clashes with each single channel.
    await expect(
      discounts.create(tenantId, { product_id: burger, percent: 5, starts_on: day(5), all_groups: false, price_group_ids: [groupA], applies_to: 'BOTH' }),
    ).rejects.toMatchObject(overlap);
    // Dates that do not overlap: fine.
    await discounts.create(tenantId, { product_id: burger, percent: 5, starts_on: day(11), all_groups: false, price_group_ids: [groupA], applies_to: 'IN_STORE' });
    // Another product is not touched.
    await discounts.create(tenantId, { product_id: fries, percent: 5, starts_on: today });
  });

  it('applies at the kiosk too, not only at the till', async () => {
    await discounts.create(tenantId, { product_id: burger, percent: 20, starts_on: today });
    expect(await quoteLine(uptown, 'KIOSK')).toMatchObject({ itemDiscountPercent: '20.00', itemDiscountTotal: '20000.0000' });
    const made: any = await kiosk.createKioskOrder(tenantId, {
      branch_id: uptown,
      order_type: 'TAKEAWAY',
      items: [{ product_id: burger, quantity: 2, unit_price: 1 }],
    });
    const full = await orders.getOrderById(tenantId, made.id || made.order?.id);
    expect(full.channel).toBe('KIOSK');
    expect(full.items[0].unit_price).toBe('100000.0000');
    expect(full.items[0].item_discount_percent).toBe('20.00');
    expect(full.discount_total).toBe('40000.0000');
    expect(full.grand_total).toBe('160000.0000');
  });

  it("keeps a Snappfood discount off the till, and an in-store one off Snappfood", async () => {
    await discounts.create(tenantId, { product_id: burger, percent: 25, starts_on: today, all_groups: false, price_group_ids: [groupA], applies_to: 'SNAPPFOOD' });
    expect(await quoteLine(uptown)).toMatchObject({ itemDiscountPercent: '0.00' });
    await discounts.create(tenantId, { product_id: fries, percent: 50, starts_on: today });
    expect(await sheetRow(uptown, fries)).toMatchObject({ price: '50000.0000', before_price: null, discount_percent: null });
  });

  it('prices a running Snappfood discount into the sheet and the menu sync, with the original struck through', async () => {
    await discounts.create(tenantId, { product_id: burger, percent: 25, starts_on: today, all_groups: false, price_group_ids: [groupA], applies_to: 'BOTH' });
    // Group A's Snappfood price 120,000 less 25% is 90,000; the 120,000 is the "before" price.
    expect(await sheetRow(uptown)).toMatchObject({ price: '90000.0000', before_price: '120000.0000', discount_percent: '25.00', group_price: '120000.0000' });
    // Group B and a branch with no group are not in the discount.
    expect(await sheetRow(downtown)).toMatchObject({ price: '100000.0000', before_price: null });
    expect(await sheetRow(loose)).toMatchObject({ price: '100000.0000', before_price: null });

    const sent = async (branchId: string) => {
      const plan = await sync.buildMenu(tenantId, branchId);
      return (plan.calls.find((c) => c.path === '/va/v1.1/product/')!.body as any).products.find((p: any) => p.title === 'Burger');
    };
    // Whole Toman.
    expect(await sent(uptown)).toMatchObject({ price: 9000, priceBeforeDiscount: 12000 });
    const plain = await sent(downtown);
    expect(plain.price).toBe(10000);
    expect(plain.priceBeforeDiscount).toBeUndefined();
  });

  it('does nothing outside its dates', async () => {
    await discounts.create(tenantId, { product_id: burger, percent: 25, starts_on: day(1), ends_on: day(3), applies_to: 'BOTH' });
    expect(await quoteLine(uptown)).toMatchObject({ itemDiscountPercent: '0.00' });
    expect(await sheetRow(uptown)).toMatchObject({ price: '120000.0000', before_price: null });
  });
});
