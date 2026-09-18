import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { OrderService } from '../src/modules/order/order.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { PriceListService } from '../src/modules/catalog/price-lists.service';
import { KioskService } from '../src/modules/kiosk/kiosk.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { ProductVariant } from '../src/entities/ProductVariant.entity';
import { PriceEntry } from '../src/entities/PriceEntry.entity';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// A branch on a price list charges the list's prices, at the register and the kiosk, and
// shows the same prices it charges. A branch with no list charges base.
describe('Branch price lists (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: OrderService;
  let catalog: CatalogService;
  let priceLists: PriceListService;
  let kiosk: KioskService;
  let pricing: PricingService;
  let tenantId: string;
  let uptown: string;
  let downtown: string;
  let tea: string;
  let pizza: string;
  let large: string;
  let small: string;
  let listId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    orders = moduleRef.get(OrderService);
    catalog = moduleRef.get(CatalogService);
    priceLists = moduleRef.get(PriceListService);
    kiosk = moduleRef.get(KioskService);
    pricing = moduleRef.get(PricingService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;

    tenantId = (
      await save(Tenant, { code: `PLIST-${Date.now()}`, name: 'Price list fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    uptown = (await save(Branch, { tenant_id: tenantId, code: 'UP', name: 'Uptown', is_active: true, time_zone: 'Asia/Tehran' })).id;
    downtown = (await save(Branch, { tenant_id: tenantId, code: 'DOWN', name: 'Downtown', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'PL-MAINS', name: 'Mains', is_active: true })).id;
    const product = async (code: string, price: string) =>
      (await save(Product, { tenant_id: tenantId, category_id: categoryId, code, name: code, base_price: price, tax_rate: '0.0000', is_active: true })).id;
    tea = await product('TEA', '50000.0000');
    pizza = await product('PIZZA', '300000.0000');
    large = (await save(ProductVariant, { tenant_id: tenantId, product_id: pizza, code: 'PZ-L', name: 'Large', base_price: '400000.0000', is_default: true, is_active: true })).id;
    small = (await save(ProductVariant, { tenant_id: tenantId, product_id: pizza, code: 'PZ-S', name: 'Small', base_price: '250000.0000', is_default: false, is_active: true })).id;

    listId = (await priceLists.createPriceList(tenantId, { name: 'Uptown prices' }, 'test')).id;
    await priceLists.setListPrice(tenantId, listId, tea, null, '65000', 'test');
    await priceLists.setListPrice(tenantId, listId, pizza, large, '450000', 'test');
    await priceLists.assignBranch(tenantId, uptown, listId, 'test');
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const linePrices = async (branchId: string, items: any[], extra: Record<string, unknown> = {}) => {
    const draft = await orders.createDraft(tenantId, { branch_id: branchId, order_type: 'TAKEAWAY', items, ...extra } as any);
    const full = await orders.getOrderById(tenantId, draft.id);
    return [...full.items].sort((a: any, b: any) => a.line_number - b.line_number).map((i: any) => i.unit_price);
  };

  it("charges the list's price at a branch on the list, and base elsewhere", async () => {
    const items = [
      { product_id: tea, quantity: '1' },
      { product_id: pizza, variant_id: large, quantity: '1' },
      { product_id: pizza, variant_id: small, quantity: '1' },
    ];
    // Small has no list price, so it sells at its own base price even on the list.
    expect(await linePrices(uptown, items)).toEqual(['65000.0000', '450000.0000', '250000.0000']);
    expect(await linePrices(downtown, items)).toEqual(['50000.0000', '400000.0000', '250000.0000']);
  });

  it('ignores a price sent by the client', async () => {
    expect(await linePrices(downtown, [{ product_id: tea, quantity: '1', unit_price: '1' }])).toEqual(['50000.0000']);
  });

  it('shows the same prices it charges', async () => {
    const sheet = await priceLists.getBranchPrices(tenantId, uptown);
    expect(sheet.price_list).toMatchObject({ id: listId });
    const price = (productId: string, variantId: string | null) =>
      sheet.items.find((i) => i.product_id === productId && i.variant_id === variantId)?.price;
    expect(price(tea, null)).toBe('65000.0000');
    expect(price(pizza, large)).toBe('450000.0000');
    expect(price(pizza, small)).toBe('250000.0000');

    const boot = await kiosk.getBootstrapContext(tenantId, uptown);
    const kioskTea = boot.products.find((p: any) => p.id === tea) as any;
    expect(kioskTea.price).toBe('65000.0000');
  });

  it('prices a kiosk order from the list', async () => {
    const order: any = await kiosk.createKioskOrder(tenantId, {
      branch_id: uptown,
      order_type: 'TAKEAWAY',
      items: [{ product_id: tea, quantity: 2, unit_price: 1 }],
    });
    const full = await orders.getOrderById(tenantId, order.id || order.order?.id);
    expect(full.items[0].unit_price).toBe('65000.0000');
  });

  it('marks up the branch price on the Snappfood sheet', async () => {
    await dataSource.getRepository(TenantSetting).save({
      tenant_id: tenantId,
      branch_id: null,
      key: 'CHANNEL_PRICING',
      value: { SNAPPFOOD: { markup_percent: 10, round_to: 1000 } },
    } as any);
    const sheet = await catalog.getChannelPriceSheet(tenantId, 'SNAPPFOOD', uptown);
    expect(sheet.items.find((i) => i.product_id === tea)).toMatchObject({ base_price: '65000.0000', price: '72000.0000' });
  });

  it('keeps the old price as history when a list price changes, and goes back to base when cleared', async () => {
    await priceLists.setListPrice(tenantId, listId, tea, null, '70000', 'test');
    expect(await linePrices(uptown, [{ product_id: tea, quantity: '1' }])).toEqual(['70000.0000']);

    await priceLists.setListPrice(tenantId, listId, tea, null, null, 'test');
    expect(await linePrices(uptown, [{ product_id: tea, quantity: '1' }])).toEqual(['50000.0000']);

    const rows = await dataSource.getRepository(PriceEntry).find({ where: { tenant_id: tenantId, price_group_id: listId, product_id: tea } });
    expect(rows.map((r) => r.amount).sort()).toEqual(['65000.0000', '70000.0000']);
    expect(rows.every((r) => r.effective_to)).toBe(true);

    await priceLists.setListPrice(tenantId, listId, tea, null, '65000', 'test');
  });

  it("closes only the list's own price in a bulk change", async () => {
    await pricing.bulkCommit(tenantId, { price_group_id: listId, product_ids: [tea], adjustment_type: 'SET', amount: '66000' }, 'test');
    expect(await linePrices(uptown, [{ product_id: tea, quantity: '1' }])).toEqual(['66000.0000']);
    // Another product's list price, on a size, is untouched.
    expect(await linePrices(uptown, [{ product_id: pizza, variant_id: large, quantity: '1' }])).toEqual(['450000.0000']);
  });

  it('sends a branch back to base when it leaves the list or the list is archived', async () => {
    await priceLists.assignBranch(tenantId, downtown, listId, 'test');
    expect(await linePrices(downtown, [{ product_id: pizza, variant_id: large, quantity: '1' }])).toEqual(['450000.0000']);
    await priceLists.assignBranch(tenantId, downtown, null, 'test');
    expect(await linePrices(downtown, [{ product_id: pizza, variant_id: large, quantity: '1' }])).toEqual(['400000.0000']);

    await priceLists.archivePriceList(tenantId, listId, 'test');
    expect(await linePrices(uptown, [{ product_id: pizza, variant_id: large, quantity: '1' }])).toEqual(['400000.0000']);
    expect((await priceLists.getPriceLists(tenantId)).map((l) => l.id)).not.toContain(listId);
  });
});
