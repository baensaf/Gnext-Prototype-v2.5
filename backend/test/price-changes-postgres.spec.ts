import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { OrderService } from '../src/modules/order/order.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { PriceChangeService } from '../src/modules/catalog/price-changes.service';
import { PriceListService } from '../src/modules/catalog/price-lists.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { ProductVariant } from '../src/entities/ProductVariant.entity';
import { PriceEntry } from '../src/entities/PriceEntry.entity';
import { BusinessDateUtil } from '../src/common/utils/business-date.util';
import { deleteTenantData } from './utils/tenant-teardown';

// Dated price changes against the real database: "+10% from tomorrow", previewed, charged
// from its date, cancellable until then, and kept in the product's price history.
describe('Dated price changes (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: OrderService;
  let catalog: CatalogService;
  let changes: PriceChangeService;
  let priceLists: PriceListService;
  let tenantId: string;
  let branchId: string;
  let drinks: string;
  let mains: string;
  let tea: string;
  let coffee: string;
  let pizza: string;
  let large: string;

  const tomorrow = () => BusinessDateUtil.today(new Date(Date.now() + 24 * 3600 * 1000));

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    orders = moduleRef.get(OrderService);
    catalog = moduleRef.get(CatalogService);
    changes = moduleRef.get(PriceChangeService);
    priceLists = moduleRef.get(PriceListService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;

    tenantId = (
      await save(Tenant, { code: `PCHG-${Date.now()}`, name: 'Price change fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'PC', name: 'Main', is_active: true, time_zone: 'Asia/Tehran' })).id;
    drinks = (await save(Category, { tenant_id: tenantId, code: 'PC-DRINKS', name: 'Drinks', is_active: true })).id;
    mains = (await save(Category, { tenant_id: tenantId, code: 'PC-MAINS', name: 'Mains', is_active: true })).id;
    const product = async (code: string, categoryId: string, price: string) =>
      (await save(Product, { tenant_id: tenantId, category_id: categoryId, code, name: code, base_price: price, tax_rate: '0.0000', is_active: true })).id;
    tea = await product('TEA', drinks, '50000.0000');
    coffee = await product('COFFEE', drinks, '72500.0000');
    pizza = await product('PIZZA', mains, '300000.0000');
    large = (await save(ProductVariant, { tenant_id: tenantId, product_id: pizza, code: 'PZ-L', name: 'Large', base_price: '400000.0000', is_default: true, is_active: true })).id;
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const price = async (productId: string, variantId: string | null = null) => {
    const draft = await orders.createDraft(tenantId, {
      branch_id: branchId,
      order_type: 'TAKEAWAY',
      items: [{ product_id: productId, variant_id: variantId, quantity: '1' }],
    } as any);
    return (await orders.getOrderById(tenantId, draft.id)).items[0].unit_price;
  };
  const baseOf = async (productId: string) => (await dataSource.getRepository(Product).findOneByOrFail({ id: productId })).base_price;

  it('previews a change on one category, rounded up, without saving anything', async () => {
    const preview = await changes.preview(tenantId, { category_id: drinks, adjustment: 'PERCENT', value: '10', round_to: 1000 });
    expect(preview.items.map((i) => [i.name, i.current, i.new])).toEqual([
      ['COFFEE', '72500.0000', '80000.0000'],
      ['TEA', '50000.0000', '55000.0000'],
    ]);
    expect(await price(tea)).toBe('50000.0000');
  });

  it('raises prices from now, and copies them into the products', async () => {
    const job = await changes.commit(tenantId, { category_id: drinks, adjustment: 'PERCENT', value: '10', round_to: 1000 }, null, 'test');
    expect(job).toMatchObject({ status: 'APPLIED', items: 2, can_cancel: false });
    expect(await price(tea)).toBe('55000.0000');
    expect(await baseOf(coffee)).toBe('80000.0000');
    // Another category is untouched.
    expect(await price(pizza, large)).toBe('400000.0000');
  });

  it('schedules a change for tomorrow, and can call it off before then', async () => {
    const job = await changes.commit(tenantId, { category_id: mains, adjustment: 'AMOUNT', value: '20000', effective_date: tomorrow() }, null, 'test');
    expect(job).toMatchObject({ status: 'SCHEDULED', can_cancel: true });
    expect(await price(pizza, large)).toBe('400000.0000');

    const start = BusinessDateUtil.startOfDay(tomorrow());
    const then = await priceLists.resolveInStorePrice(
      tenantId,
      branchId,
      await dataSource.getRepository(Product).findOneByOrFail({ id: pizza }),
      await dataSource.getRepository(ProductVariant).findOneByOrFail({ id: large }),
      new Date(start.getTime() + 60_000),
    );
    expect(then).toBe('420000.0000');

    await changes.cancel(tenantId, job.id, null, 'test');
    expect(await dataSource.getRepository(PriceEntry).count({ where: { bulk_job_id: job.id } })).toBe(0);
    expect((await changes.list(tenantId)).find((j) => j.id === job.id)).toMatchObject({ status: 'CANCELLED', can_cancel: false });
  });

  it("applies a scheduled change once its day comes, and restores the price it ended if cancelled", async () => {
    // Tea's current price is a dated row from the change above; a change for tomorrow ends it then.
    const job = await changes.commit(tenantId, { category_id: drinks, adjustment: 'AMOUNT', value: '5000', effective_date: tomorrow() }, null, 'test');
    const current = await dataSource.getRepository(PriceEntry).findOneByOrFail({ product_id: tea, amount: '55000.0000' });
    expect(current.effective_to).not.toBeNull();

    // Walk the clock forward by moving the change's start into the past.
    const past = new Date(Date.now() - 60_000);
    await dataSource.getRepository(PriceEntry).update({ bulk_job_id: job.id }, { effective_from: past });
    await dataSource.getRepository(PriceEntry).update({ id: current.id }, { effective_to: past });
    await dataSource.query(`UPDATE price_bulk_job SET effective_from = $1 WHERE id = $2`, [past, job.id]);
    await changes.applyDueBaseChanges(tenantId);

    expect(await price(tea)).toBe('60000.0000');
    expect(await baseOf(tea)).toBe('60000.0000');
    expect((await changes.list(tenantId)).find((j) => j.id === job.id)).toMatchObject({ status: 'APPLIED', can_cancel: false });
    await expect(changes.cancel(tenantId, job.id, null, 'test')).rejects.toThrow('has started');
  });

  it('lets a price typed on the product page win over a dated one', async () => {
    await catalog.updateProduct(tenantId, tea, { base_price: '58000' } as any, 'test');
    await changes.applyDueBaseChanges(tenantId);
    expect(await price(tea)).toBe('58000.0000');
    expect(await baseOf(tea)).toBe('58000.0000');
  });

  it("keeps the product's price history", async () => {
    const history = await changes.getPriceHistory(tenantId, tea);
    expect(history[0]).toMatchObject({ kind: 'EDIT', from: '60000.0000', to: '58000.0000' });
    expect(history.filter((h) => h.kind === 'CHANGE').map((h) => h.to).sort()).toEqual(['55000.0000', '60000.0000']);
  });
});
