import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { OrderService } from '../src/modules/order/order.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { KioskService } from '../src/modules/kiosk/kiosk.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// "Off on Snappfood only": the kitchen is slammed, so the item comes off the aggregator while
// the counter keeps selling it. The Snappfood sheet, which staff copy into the vendor panel,
// says it is off; the register and the kiosk do not see the stop.
describe('Stops on one channel (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: OrderService;
  let catalog: CatalogService;
  let kiosk: KioskService;
  let tenantId: string;
  let branchId: string;
  let burger: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    orders = moduleRef.get(OrderService);
    catalog = moduleRef.get(CatalogService);
    kiosk = moduleRef.get(KioskService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (await save(Tenant, { code: `CHSTOP-${Date.now()}`, name: 'Channel stop fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'CS', name: 'Main', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'CS-MAINS', name: 'Mains', is_active: true })).id;
    burger = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'BURGER', name: 'Burger', base_price: '100000.0000', tax_rate: '0.0000', is_active: true })).id;
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const sellInStore = () =>
    orders.createDraft(tenantId, { branch_id: branchId, order_type: 'TAKEAWAY', items: [{ product_id: burger, quantity: '1' }] } as any);
  const onSnappfood = async (branch: string | null = branchId) =>
    (await catalog.getChannelPriceSheet(tenantId, 'SNAPPFOOD', branch)).items.find((i) => i.product_id === burger)!.off;

  it('stops an item on Snappfood while the register and the kiosk keep selling it', async () => {
    await catalog.suspendProduct(tenantId, burger, branchId, 0, 'Kitchen slammed', 'test', { channel: 'SNAPPFOOD' });

    await expect(sellInStore()).resolves.toBeDefined();
    const boot = await kiosk.getBootstrapContext(tenantId, branchId);
    expect((boot.products.find((p: any) => p.id === burger) as any).is_available).toBe(true);

    expect(await onSnappfood()).toMatchObject({ reason: 'Kitchen slammed', everywhere: false, chain_wide: false });
    // Head office's sheet, with no branch, shows only chain-wide stops.
    expect(await onSnappfood(null)).toBeNull();
  });

  it('keeps a stop everywhere beside a Snappfood one, and lifts each on its own', async () => {
    await catalog.suspendProduct(tenantId, burger, branchId, 0, 'Out of buns', 'test');
    await expect(sellInStore()).rejects.toThrow('suspended');

    await catalog.resumeProduct(tenantId, burger, branchId, 'test');
    await expect(sellInStore()).resolves.toBeDefined();
    expect(await onSnappfood()).toMatchObject({ everywhere: false });

    await catalog.resumeProduct(tenantId, burger, branchId, 'test', { channel: 'SNAPPFOOD' });
    expect(await onSnappfood()).toBeNull();
  });

  it("shows head office's Snappfood stop at every branch, and a branch cannot lift it", async () => {
    await catalog.suspendProduct(tenantId, burger, undefined, 0, 'Recipe change', 'test', { channel: 'SNAPPFOOD' });
    expect(await onSnappfood(null)).toMatchObject({ chain_wide: true, everywhere: false });
    expect(await onSnappfood()).toMatchObject({ chain_wide: true });
    await expect(sellInStore()).resolves.toBeDefined();

    await expect(catalog.resumeProduct(tenantId, burger, branchId, 'test', { channel: 'SNAPPFOOD' })).rejects.toThrow('Head office');
    await catalog.resumeProduct(tenantId, burger, undefined, 'test', { channel: 'SNAPPFOOD' });
    expect(await onSnappfood()).toBeNull();
  });

  it('refuses a channel it does not know', async () => {
    await expect(catalog.suspendProduct(tenantId, burger, branchId, 0, 'x', 'test', { channel: 'TAPSI' })).rejects.toThrow('SNAPPFOOD');
  });
});
