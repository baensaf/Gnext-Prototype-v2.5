import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { OrderService } from '../src/modules/order/order.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { ProductVariant } from '../src/entities/ProductVariant.entity';
import { OptionGroup } from '../src/entities/OptionGroup.entity';
import { OptionItem } from '../src/entities/OptionItem.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { deleteTenantData } from './utils/tenant-teardown';
import { clearOfDayTurnover } from './utils/day-turnover';

// What Snappfood's vendor panel lets a restaurant say about its menu, against the real
// database: today's stock, a stop on one variant, an add-on left off one product, and a
// day with two shifts.
describe('Snappfood-style menu controls (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: OrderService;
  let catalog: CatalogService;
  let tenants: TenantService;
  let tenantId: string;
  let branchId: string;
  let lasagne: string;
  let sandwich: string;
  let hot: string;
  let cold: string;
  let groupId: string;
  let chili: string;
  let ketchup: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    orders = moduleRef.get(OrderService);
    catalog = moduleRef.get(CatalogService);
    tenants = moduleRef.get(TenantService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;

    tenantId = (
      await save(Tenant, { code: `SFPAR-${Date.now()}`, name: 'Snappfood parity fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'SFP', name: 'Parity branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'SFP-MAINS', name: 'Mains', is_active: true })).id;
    const product = async (code: string) =>
      (await save(Product, { tenant_id: tenantId, category_id: categoryId, code, name: code, base_price: '100000.0000', tax_rate: '0.0900' })).id;
    lasagne = await product('LASAGNE');
    sandwich = await product('SANDWICH');
    hot = (await save(ProductVariant, { tenant_id: tenantId, product_id: sandwich, code: 'SW-HOT', name: 'Hot', base_price: '120000.0000', is_default: true, is_active: true })).id;
    cold = (await save(ProductVariant, { tenant_id: tenantId, product_id: sandwich, code: 'SW-COLD', name: 'Cold', base_price: '110000.0000', is_default: false, is_active: true })).id;
    groupId = (await save(OptionGroup, { tenant_id: tenantId, code: 'SFP-SAUCE', name: 'Sauces', min_selection: 0, max_selection: 3 })).id;
    chili = (await save(OptionItem, { tenant_id: tenantId, option_group_id: groupId, code: 'SFP-CHILI', name: 'Chili shot', price_delta: '20000.0000' })).id;
    ketchup = (await save(OptionItem, { tenant_id: tenantId, option_group_id: groupId, code: 'SFP-KETCHUP', name: 'Ketchup', price_delta: '5000.0000' })).id;
    await catalog.attachOptionGroupToProduct(tenantId, sandwich, groupId, 0, 'test');
  });

  // Today's count and the sales against it must fall on one business day.
  beforeEach(() => clearOfDayTurnover(dataSource, tenantId, branchId), 15_000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const order = (items: any[]) => orders.createDraft(tenantId, { branch_id: branchId, order_type: 'TAKEAWAY', items } as any);

  it("stops selling at today's count and gives units back when an order is cancelled", async () => {
    await catalog.setDailyStock(tenantId, branchId, [{ productId: lasagne, quantity: 3 }], 'test');

    const first = await order([{ product_id: lasagne, quantity: 2 }]);
    expect((await catalog.getDailyStock(tenantId, branchId))[0]).toMatchObject({ quantity: 3, sold: 2, remaining: 1 });

    await expect(order([{ product_id: lasagne, quantity: 2 }])).rejects.toThrow('Only 1');

    await dataSource.getRepository(OrderHeader).update({ id: first.id }, { state: 'CANCELLED', status: 'CANCELLED' } as any);
    await expect(order([{ product_id: lasagne, quantity: 2 }])).resolves.toBeDefined();

    // An empty count clears the line: no limit again.
    await catalog.setDailyStock(tenantId, branchId, [{ productId: lasagne, quantity: null }], 'test');
    expect(await catalog.getDailyStock(tenantId, branchId)).toHaveLength(0);
  });

  it('takes one variant off sale, and a whole-product stop and resume leave it alone', async () => {
    await catalog.suspendProduct(tenantId, sandwich, branchId, 0, 'No cold cuts', 'test', { variantId: cold });

    await expect(order([{ product_id: sandwich, variant_id: cold, quantity: 1 }])).rejects.toThrow('suspended');
    await expect(order([{ product_id: sandwich, variant_id: hot, quantity: 1 }])).resolves.toBeDefined();

    await catalog.suspendProduct(tenantId, sandwich, branchId, 2, 'Rush', 'test');
    await catalog.resumeProduct(tenantId, sandwich, branchId, 'test');
    await expect(order([{ product_id: sandwich, variant_id: cold, quantity: 1 }])).rejects.toThrow('suspended');

    await catalog.resumeProduct(tenantId, sandwich, branchId, 'test', { variantId: cold });
    await expect(order([{ product_id: sandwich, variant_id: cold, quantity: 1 }])).resolves.toBeDefined();
  });

  it('refuses an add-on the product leaves out, or one taken off sale', async () => {
    const withSauce = (itemId: string) => [{ product_id: sandwich, variant_id: hot, quantity: 1, options: [{ option_item_id: itemId }] }];

    await catalog.setExcludedOptionItems(tenantId, sandwich, groupId, [chili], 'test');
    await expect(order(withSauce(chili))).rejects.toThrow('not offered');
    await expect(order(withSauce(ketchup))).resolves.toBeDefined();

    await catalog.suspendProduct(tenantId, undefined, branchId, 0, 'Out', 'test', { optionItemId: ketchup });
    await expect(order(withSauce(ketchup))).rejects.toThrow('not available');
    await catalog.resumeProduct(tenantId, undefined, branchId, 'test', { optionItemId: ketchup });
    await expect(order(withSauce(ketchup))).resolves.toBeDefined();
  });

  it('keeps two shifts on one day and comes back at the next one', async () => {
    const days = [0, 1, 2, 3, 4, 5, 6];
    await tenants.updateBranchHours(
      tenantId,
      branchId,
      days.flatMap((d) => [
        { day_of_week: d, open_time: '12:00:00', close_time: '16:00:00' },
        { day_of_week: d, open_time: '19:00:00', close_time: '23:00:00' },
      ]),
      'test',
    );
    const hours = await tenants.getBranchHours(tenantId, branchId);
    expect(hours).toHaveLength(14);

    await expect(
      tenants.updateBranchHours(tenantId, branchId, [
        { day_of_week: 1, open_time: '12:00:00', close_time: '16:00:00' },
        { day_of_week: 1, open_time: '15:00:00', close_time: '23:00:00' },
      ], 'test'),
    ).rejects.toThrow('overlap');

    // 10:00Z is 13:30 in Tehran, inside lunch: the next shift is dinner at 19:00, 15:30Z.
    const next = await catalog.nextShiftStart(tenantId, branchId, new Date('2026-09-16T10:00:00Z'));
    expect(next.toISOString()).toBe('2026-09-16T15:30:00.000Z');

    const stop = await catalog.suspendProduct(tenantId, lasagne, branchId, undefined, 'Ran out', 'test', { untilNextShift: true });
    expect(new Date(stop.suspended_until!).getTime()).toBeGreaterThan(Date.now());
  });
});
