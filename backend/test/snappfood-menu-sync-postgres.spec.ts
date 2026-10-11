import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { SnappfoodCatalogService } from '../src/modules/simulation/snappfood-catalog.service';
import { SimulationService } from '../src/modules/simulation/simulation.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { ProductVariant } from '../src/entities/ProductVariant.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { OrderItemOption } from '../src/entities/OrderItemOption.entity';
import { IntegrationLog } from '../src/entities/IntegrationLog.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// The simulated Snappfood menu sync (2026-10-12): our ids, matching a vendor's menu, sending
// ours with the annex's calls, and Snappfood orders read back onto our products and add-ons.
describe('Snappfood menu sync, simulated (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let sync: SnappfoodCatalogService;
  let simulation: SimulationService;
  let catalog: CatalogService;
  let tenantId: string;
  let branchId: string;
  let burger: string;
  let fries: string;
  let large: string;
  let cheese: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    sync = moduleRef.get(SnappfoodCatalogService);
    simulation = moduleRef.get(SimulationService);
    catalog = moduleRef.get(CatalogService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (await save(Tenant, { code: `SFSYNC-${Date.now()}`, name: 'Menu sync fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'SF1', name: 'Branch one', is_active: true, time_zone: 'Asia/Tehran', currency_code: 'IRR' } as any)).id;
    const burgers = (await save(Category, { tenant_id: tenantId, code: 'BURGERS', name: 'برگر', is_active: true, sort_order: 1 })).id;
    burger = (await save(Product, { tenant_id: tenantId, category_id: burgers, name: 'چیز برگر', base_price: '5000000.0000', tax_rate: '0.0900', is_active: true })).id;
    fries = (await save(Product, { tenant_id: tenantId, category_id: burgers, name: 'سیب زمینی', base_price: '2500000.0000', tax_rate: '0.0900', is_active: true })).id;
    await save(ProductVariant, { tenant_id: tenantId, product_id: fries, code: 'F-S', name: 'کوچک', base_price: '2000000.0000', is_default: true, is_active: true, sort_order: 0 });
    large = (await save(ProductVariant, { tenant_id: tenantId, product_id: fries, code: 'F-L', name: 'بزرگ', base_price: '3000000.0000', is_default: false, is_active: true, sort_order: 1 })).id;
    const extras = await catalog.saveOptionGroup(tenantId, null, { name: 'افزودنی', min_selection: 0, max_selection: 2, items: [{ name: 'پنیر', price_delta: '600000' }] }, 'test');
    cheese = extras.items[0].id;
    await catalog.setOfferedChoices(tenantId, burger, extras.id, [cheese], 'test');
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('gives every product, type and add-on its own integer, never reused', async () => {
    const ids = await sync.ids(tenantId);
    const numbers = [...ids.values()].map((r) => r.external_id);
    expect(new Set(numbers).size).toBe(numbers.length);
    // Fries come in types, so each type is a Snappfood product; the burger is one.
    expect(ids.has(`PRODUCT:${burger}`)).toBe(true);
    expect(ids.has(`PRODUCT:${fries}`)).toBe(false);
    expect(ids.has(`VARIANT:${large}`)).toBe(true);
    expect(ids.has(`OPTION_ITEM:${cheese}`)).toBe(true);
    const again = await sync.ids(tenantId);
    expect(again.get(`PRODUCT:${burger}`)!.external_id).toBe(ids.get(`PRODUCT:${burger}`)!.external_id);
  });

  it('suggests matches by name despite how the vendor typed them, and saves them with Snappfood', async () => {
    const preview = await sync.matchPreview(tenantId, branchId);
    expect(preview.snappfood_products.filter((p) => p.status === 'SUGGESTED').length).toBeGreaterThan(0);
    // Two of Snappfood's own products match nothing of ours.
    expect(preview.snappfood_products.filter((p) => p.status === 'UNMATCHED')).toHaveLength(2);

    const matches = preview.snappfood_products
      .filter((p) => p.match)
      .map((p) => ({ product_code: p.product_code, entity_type: p.match!.entity_type, entity_id: p.match!.entity_id }));
    const saved = await sync.saveMatches(tenantId, branchId, matches);
    expect(saved.snappfood_products.filter((p) => p.status === 'MATCHED')).toHaveLength(matches.length);
    const logged = await dataSource.getRepository(IntegrationLog).findOne({ where: { tenant_id: tenantId, event_type: 'CATALOG_SYNC_PRODUCT_IDS' } });
    expect(logged!.request_payload.path).toBe('/va/v1/product/sync/productId');
  });

  it('builds the annex calls: menus, products per type, toppings and which product offers them', async () => {
    const plan = await sync.buildMenu(tenantId, branchId);
    const paths = plan.calls.map((c) => `${c.method} ${c.path}`);
    expect(paths).toEqual(expect.arrayContaining(['POST /va/v1/menu/', 'POST /va/v1.1/product/', 'POST /va/v1/topping/', 'POST /va/v1/topping/add-to-product', 'PUT /va/v1/product/']));
    const products = (plan.calls.find((c) => c.path === '/va/v1.1/product/')!.body as any).products;
    const ids = await sync.ids(tenantId);
    const big = products.find((p: any) => p.productId === ids.get(`VARIANT:${large}`)!.external_id);
    expect(big).toMatchObject({ productTitle: 'سیب زمینی', title: 'بزرگ', price: 300000, vat: 9 });
    const offers = (plan.calls.find((c) => c.path === '/va/v1/topping/add-to-product')!.body as any).toppings;
    expect(offers).toEqual([{ productId: ids.get(`PRODUCT:${burger}`)!.external_id, toppingId: ids.get(`OPTION_ITEM:${cheese}`)!.external_id }]);
  });

  it('flags what Snappfood would refuse', async () => {
    await dataSource.getRepository(Product).update({ id: burger }, { name: 'ب'.repeat(70) });
    const plan = await sync.buildMenu(tenantId, branchId);
    expect(plan.warnings.some((w) => w.problem.includes('title over 64'))).toBe(true);
    await dataSource.getRepository(Product).update({ id: burger }, { name: 'چیز برگر' });
  });

  it('sends a stop as Snappfood unavailable, until the next shift', async () => {
    await catalog.suspendProduct(tenantId, burger, branchId, 'test', { until: 'NEXT_SHIFT' });
    const plan = await sync.pushMenu(tenantId, branchId);
    const ids = await sync.ids(tenantId);
    const toggle = (plan.calls.find((c) => c.path === '/va/v1/product/')!.body as any).products.find((p: any) => p.id === ids.get(`PRODUCT:${burger}`)!.external_id);
    expect(toggle).toMatchObject({ active: true, disable: true });
    expect(toggle.disableUntil).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(toggle.disableUntil).not.toBe('2099-12-31 23:59:59');
    await catalog.resumeProduct(tenantId, burger, branchId, 'test');
  });

  it('reads a Snappfood order back onto our product, type and add-ons', async () => {
    const ids = await sync.ids(tenantId);
    const result = await simulation.generateSnappfoodOrder(tenantId, {
      branch_id: branchId,
      code: `SYNC-${Date.now()}`,
      products: [
        { id: ids.get(`PRODUCT:${burger}`)!.external_id, title: 'چیز برگر', quantity: 2, price: 500000, vat: 0.09, toppings: [{ id: ids.get(`OPTION_ITEM:${cheese}`)!.external_id, title: 'پنیر', price: 60000 }] },
        { id: ids.get(`VARIANT:${large}`)!.external_id, title: 'سیب زمینی بزرگ', quantity: 1, price: 300000, vat: 0.09, toppings: [] },
        { id: 999999, title: 'چیزی که نفرستادیم', quantity: 1, price: 10000, vat: 0, toppings: [] },
      ],
      price: 1500000,
    });
    const lines = await dataSource.getRepository(OrderItem).find({ where: { tenant_id: tenantId, order_id: result.order!.id }, order: { line_number: 'ASC' } });
    expect(lines[0]).toMatchObject({ product_id: burger, unit_price: '5000000.0000', modifier_total: '1200000.0000', line_total: '11200000.0000' });
    const options = await dataSource.getRepository(OrderItemOption).find({ where: { tenant_id: tenantId, order_item_id: lines[0].id } });
    expect(options).toEqual([expect.objectContaining({ option_item_id: cheese, option_group_name: 'افزودنی', option_item_name: 'پنیر', price_delta: '600000.0000' })]);
    expect(lines[1]).toMatchObject({ product_id: fries, variant_id: large, variant_name: 'بزرگ' });
    expect(lines[2].special_instructions).toContain('999999');
  });
});
