import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { PriceListService } from '../src/modules/catalog/price-lists.service';
import { SnappfoodCatalogService } from '../src/modules/simulation/snappfood-catalog.service';
import { SnappfoodPriceOnGroups1700000000123 } from '../src/migrations/1700000000123-SnappfoodPriceOnGroups';
import { FakeDiscountOut1700000000122 } from '../src/migrations/1700000000122-FakeDiscountOut';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { ProductVariant } from '../src/entities/ProductVariant.entity';
import { PriceEntry } from '../src/entities/PriceEntry.entity';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// Snappfood prices belong to the price group (2026-10-12): a branch gets its group's Snappfood
// price; empty, its group's in-store price plus the markup; no group, base plus the markup.
describe('Snappfood prices on price groups (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let catalog: CatalogService;
  let priceLists: PriceListService;
  let sync: SnappfoodCatalogService;
  let tenantId: string;
  let uptown: string;
  let downtown: string;
  let loose: string;
  let tea: string;
  let burger: string;
  let pizza: string;
  let large: string;
  let groupA: string;
  let groupB: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    catalog = moduleRef.get(CatalogService);
    priceLists = moduleRef.get(PriceListService);
    sync = moduleRef.get(SnappfoodCatalogService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (await save(Tenant, { code: `SFGRP-${Date.now()}`, name: 'Snappfood group fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    const branch = async (code: string) => (await save(Branch, { tenant_id: tenantId, code, name: code, is_active: true, time_zone: 'Asia/Tehran' })).id;
    uptown = await branch('UP');
    downtown = await branch('DOWN');
    loose = await branch('LOOSE');
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'SG-MAINS', name: 'Mains', is_active: true })).id;
    const product = async (code: string, price: string) =>
      (await save(Product, { tenant_id: tenantId, category_id: categoryId, code, name: code, base_price: price, tax_rate: '0.0000', is_active: true })).id;
    tea = await product('TEA', '50000.0000');
    burger = await product('BURGER', '200000.0000');
    pizza = await product('PIZZA', '300000.0000');
    large = (await save(ProductVariant, { tenant_id: tenantId, product_id: pizza, code: 'PZ-L', name: 'Large', base_price: '400000.0000', is_default: true, is_active: true })).id;

    groupA = (await priceLists.createPriceList(tenantId, { name: 'Group A' }, 'test')).id;
    groupB = (await priceLists.createPriceList(tenantId, { name: 'Group B' }, 'test')).id;
    await priceLists.assignBranch(tenantId, uptown, groupA, 'test');
    await priceLists.assignBranch(tenantId, downtown, groupB, 'test');
    await dataSource.getRepository(TenantSetting).save({
      tenant_id: tenantId,
      branch_id: null,
      key: 'CHANNEL_PRICING',
      value: { SNAPPFOOD: { markup_percent: 10, round_to: 1000 } },
    } as any);
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const priceOf = async (branchId: string | null, productId: string, variantId: string | null = null) =>
    (await catalog.getChannelPriceSheet(tenantId, 'SNAPPFOOD', branchId)).items.find((i) => i.product_id === productId && i.variant_id === variantId)!;

  it("gives a branch its group's Snappfood price, and each group its own", async () => {
    await priceLists.setListPrice(tenantId, groupA, tea, null, '80000', 'test', 'SNAPPFOOD');
    await priceLists.setListPrice(tenantId, groupB, tea, null, '90000', 'test', 'SNAPPFOOD');
    expect(await priceOf(uptown, tea)).toMatchObject({ price: '80000.0000', group_price: '80000.0000' });
    expect(await priceOf(downtown, tea)).toMatchObject({ price: '90000.0000', group_price: '90000.0000' });
  });

  it("follows the group's in-store price plus the markup while Snappfood is empty", async () => {
    await priceLists.setListPrice(tenantId, groupA, burger, null, '250000', 'test');
    // 250,000 + 10% = 275,000.
    expect(await priceOf(uptown, burger)).toMatchObject({ base_price: '250000.0000', price: '275000.0000', group_price: null });
    // Group B prices the burger nowhere: base 200,000 + 10% = 220,000.
    expect(await priceOf(downtown, burger)).toMatchObject({ base_price: '200000.0000', price: '220000.0000', group_price: null });
  });

  it('uses base plus the markup for a branch with no group, and for no branch', async () => {
    expect(await priceOf(loose, tea)).toMatchObject({ price: '55000.0000', group_price: null });
    expect(await priceOf(null, tea)).toMatchObject({ price: '55000.0000', group_price: null });
  });

  it('keeps the in-store price untouched by a Snappfood price', async () => {
    const sheet = await priceLists.getPriceListSheet(tenantId, groupA);
    const row = sheet.items.find((i) => i.product_id === tea)!;
    expect(row).toMatchObject({ list_price: null, price: '50000.0000', snappfood_price: '80000.0000', snappfood_fallback: '55000.0000' });
    const burgerRow = sheet.items.find((i) => i.product_id === burger)!;
    expect(burgerRow).toMatchObject({ list_price: '250000.0000', snappfood_price: null, snappfood_fallback: '275000.0000' });
    const prices = await priceLists.getBranchPrices(tenantId, uptown);
    expect(prices.items.find((i) => i.product_id === tea)!.price).toBe('50000.0000');
  });

  it('prices each size on its own and refuses a bad channel', async () => {
    await expect(priceLists.setListPrice(tenantId, groupA, pizza, null, '1', 'test', 'SNAPPFOOD')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VARIANT_REQUIRED' }),
    });
    await expect(priceLists.setListPrice(tenantId, groupA, tea, null, '1', 'test', 'TAPSI')).rejects.toThrow('SNAPPFOOD');
    await priceLists.setListPrice(tenantId, groupA, pizza, large, '520000', 'test', 'SNAPPFOOD');
    expect(await priceOf(uptown, pizza, large)).toMatchObject({ price: '520000.0000' });
  });

  it('clears a Snappfood price back to the fallback and keeps the old one as history', async () => {
    await priceLists.setListPrice(tenantId, groupB, tea, null, null, 'test', 'SNAPPFOOD');
    expect(await priceOf(downtown, tea)).toMatchObject({ price: '55000.0000', group_price: null });
    const rows = await dataSource.getRepository(PriceEntry).find({ where: { tenant_id: tenantId, price_group_id: groupB, product_id: tea, channel: 'SNAPPFOOD' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].effective_to).not.toBeNull();
  });

  it('sends each branch its own group prices in the menu sync', async () => {
    const teaPrice = async (branchId: string) => {
      const plan = await sync.buildMenu(tenantId, branchId);
      const products = (plan.calls.find((c) => c.path === '/va/v1.1/product/')!.body as any).products;
      return products.find((p: any) => p.title === 'TEA').price;
    };
    // Whole Toman: 80,000 Rial is 8,000 Toman.
    expect(await teaPrice(uptown)).toBe(8000);
    expect(await teaPrice(downtown)).toBe(5500);
    expect(await teaPrice(loose)).toBe(5500);
  });

  it('copies a chain-wide fixed price into every group that has none, then removes it', async () => {
    const repo = dataSource.getRepository(PriceEntry);
    const chainWide = (productId: string, amount: string) =>
      repo.save(repo.create({ tenant_id: tenantId, product_id: productId, channel: 'SNAPPFOOD', price_type: 'CHANNEL', currency_code: 'IRR', amount } as any));
    await chainWide(tea, '99000.0000');
    await chainWide(burger, '230000.0000');
    // Group A already has a Snappfood price for the tea, so the copy leaves it; group B cleared its own, so it gets one.
    const runner = dataSource.createQueryRunner();
    try {
      await new SnappfoodPriceOnGroups1700000000123().up(runner);
    } finally {
      await runner.release();
    }
    expect(await priceOf(uptown, tea)).toMatchObject({ group_price: '80000.0000' });
    expect(await priceOf(downtown, tea)).toMatchObject({ group_price: '99000.0000' });
    expect(await priceOf(uptown, burger)).toMatchObject({ group_price: '230000.0000' });
    expect(await priceOf(downtown, burger)).toMatchObject({ group_price: '230000.0000' });
    // The chain-wide rows are gone, and a branch with no group is back on the markup.
    expect(await repo.count({ where: { tenant_id: tenantId, channel: 'SNAPPFOOD', price_group_id: IsNull(), branch_id: IsNull() } })).toBe(0);
    expect(await priceOf(loose, burger)).toMatchObject({ price: '220000.0000', group_price: null });
  });

  it('strips the shown discount keys from a stored CHANNEL_PRICING and keeps the markup', async () => {
    await dataSource.getRepository(TenantSetting).update(
      { tenant_id: tenantId, key: 'CHANNEL_PRICING' },
      { value: { SNAPPFOOD: { markup_percent: 10, round_to: 1000, display_discount_percent: 20, item_display_discounts: { 'a:': 30 } } } } as any,
    );
    const runner = dataSource.createQueryRunner();
    try {
      await new FakeDiscountOut1700000000122().up(runner);
    } finally {
      await runner.release();
    }
    const stored = await dataSource.getRepository(TenantSetting).findOneByOrFail({ tenant_id: tenantId, key: 'CHANNEL_PRICING' });
    expect(stored.value).toEqual({ SNAPPFOOD: { markup_percent: 10, round_to: 1000 } });
  });
});
