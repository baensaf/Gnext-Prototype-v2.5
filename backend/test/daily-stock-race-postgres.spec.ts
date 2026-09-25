import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { KioskService } from '../src/modules/kiosk/kiosk.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { DailyStock } from '../src/entities/DailyStock.entity';
import { deleteTenantData } from './utils/tenant-teardown';
import { clearOfDayTurnover } from './utils/day-turnover';

// Audit C11: two tills selling the last unit of today's stock at the same moment both read
// "1 left" and both sold it. The count is now locked until the selling order commits.
describe('Daily stock under concurrent sales (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let catalog: CatalogService;
  let kiosk: KioskService;
  let tenantId: string;
  let branchId: string;
  let categoryId: string;
  let lasagne: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    catalog = moduleRef.get(CatalogService);
    kiosk = moduleRef.get(KioskService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;

    tenantId = (await save(Tenant, { code: `STOCK-${Date.now()}`, name: 'Stock race fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'SR1', name: 'Main', is_active: true, time_zone: 'Asia/Tehran' })).id;
    categoryId = (await save(Category, { tenant_id: tenantId, code: 'SR-MAINS', name: 'Mains', is_active: true })).id;
    lasagne = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'LASAGNE', name: 'Lasagne', base_price: '200000.0000', tax_rate: '0.0000', is_active: true })).id;
  });

  // Today's count and the sales against it must fall on one business day.
  beforeEach(() => clearOfDayTurnover(dataSource, tenantId, branchId), 15_000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const kioskOrder = () =>
    kiosk.createKioskOrder(tenantId, { branch_id: branchId, order_type: 'TAKEAWAY', items: [{ product_id: lasagne, quantity: 1 }] });

  it('sells the last unit once when two kiosks order it at the same moment', async () => {
    await catalog.setDailyStock(tenantId, branchId, [{ productId: lasagne, quantity: 1 }], 'corr');

    const results = await Promise.allSettled([kioskOrder(), kioskOrder(), kioskOrder()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const refused of results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]) {
      expect(refused.reason.response).toMatchObject({ code: 'PRODUCT_OUT_OF_STOCK' });
    }
    expect((await catalog.getDailyStock(tenantId, branchId))[0]).toMatchObject({ sold: 1, remaining: 0 });
  });

  it('makes a kiosk wait for a register holding the last unit, then refuses it', async () => {
    // One more made: one left. A register takes it and is slow to commit.
    await catalog.setDailyStock(tenantId, branchId, [{ productId: lasagne, quantity: 2 }], 'corr');
    const sold = await dataSource.getRepository(OrderItem).findOneOrFail({ where: { tenant_id: tenantId, product_id: lasagne } });
    const product = await dataSource.getRepository(Product).findOneByOrFail({ id: lasagne });

    let checked!: () => void;
    const registerChecked = new Promise<void>((resolve) => (checked = resolve));
    const register = dataSource.transaction(async (em) => {
      await catalog.assertLineSellable(em, tenantId, { id: sold.order_id, branch_id: branchId }, product, null, '1.0000', []);
      checked();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const { id: _id, ...line } = sold;
      await em.getRepository(OrderItem).save(em.getRepository(OrderItem).create({ ...line, line_number: 2 }));
    });

    await registerChecked;
    const started = Date.now();
    await expect(kioskOrder()).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PRODUCT_OUT_OF_STOCK' }) });
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    await register;
    expect((await catalog.getDailyStock(tenantId, branchId))[0]).toMatchObject({ sold: 2, remaining: 0 });
  });

  // An open order (a draft, a kiosk order awaiting its card) has no business date until it is
  // submitted or paid. Placed at 01:30 it counts against the day that began at 04:00 the
  // morning before, not against the calendar date: the night's sales used to go uncounted and
  // the last unit sold three times over (found at 03:59 in Tehran).
  it("counts an open order placed after midnight against the night's business day", async () => {
    const moussaka = (await dataSource.getRepository(Product).save(
      dataSource.getRepository(Product).create({ tenant_id: tenantId, category_id: categoryId, code: 'MOUSSAKA', name: 'Moussaka', base_price: '200000.0000', tax_rate: '0.0000', is_active: true }),
    )).id;
    const placeAt = async (placedAt: string) => {
      const order = await kiosk.createKioskOrder(tenantId, { branch_id: branchId, order_type: 'TAKEAWAY', items: [{ product_id: moussaka, quantity: 1 }] });
      await dataSource.getRepository(OrderHeader).update({ id: order.id }, { placed_at: new Date(placedAt), business_date: null } as any);
    };
    await placeAt('2026-03-10T22:00:00Z'); // 01:30 on the 11th in Tehran: the 10th's business day
    await placeAt('2026-03-11T00:29:00Z'); // 03:59: still the 10th
    await placeAt('2026-03-11T00:30:00Z'); // 04:00: the 11th
    for (const business_date of ['2026-03-10', '2026-03-11']) {
      await dataSource.getRepository(DailyStock).save({ tenant_id: tenantId, branch_id: branchId, business_date, product_id: moussaka, variant_id: null, quantity: 5 });
    }

    expect((await catalog.getDailyStock(tenantId, branchId, '2026-03-10'))[0]).toMatchObject({ sold: 2, remaining: 3 });
    expect((await catalog.getDailyStock(tenantId, branchId, '2026-03-11'))[0]).toMatchObject({ sold: 1, remaining: 4 });
  });
});
