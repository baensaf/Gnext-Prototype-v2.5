import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// Categories: rename, reorder, and no archiving a category that still holds products unless
// they move in the same step (audit C12). Categories don't nest.
describe('Category editing (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let catalog: CatalogService;
  let tenantId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    catalog = moduleRef.get(CatalogService);
    const tenant = dataSource.getRepository(Tenant);
    tenantId = (await tenant.save(tenant.create({ code: `CATS-${Date.now()}`, name: 'Categories fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' }))).id;
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const create = (code: string, name: string) => catalog.createCategory(tenantId, { code, name }, 'corr');
  const list = async () => (await catalog.getCategories(tenantId)) as Array<Category & { product_count: number }>;
  const product = (code: string, category_id: string) =>
    dataSource.getRepository(Product).save(
      dataSource.getRepository(Product).create({ tenant_id: tenantId, category_id, code, name: code, base_price: '1000.0000', tax_rate: '0.0000', is_active: true }),
    );

  it('lists categories in menu order, each with its product count', async () => {
    const drinks = await create('DRINKS', 'Drinks');
    const food = await create('FOOD', 'Food');
    const hot = await create('HOT', 'Hot drinks');
    await product('TEA', hot.id);
    await product('COFFEE', hot.id);

    // New categories go at the end of the menu.
    expect([drinks.sort_order, food.sort_order, hot.sort_order]).toEqual([1, 2, 3]);
    const rows = await list();
    expect(rows.map((c) => c.code)).toEqual(['DRINKS', 'FOOD', 'HOT']);
    expect(rows.find((c) => c.code === 'HOT')!.product_count).toBe(2);
    expect(rows.find((c) => c.code === 'FOOD')!.product_count).toBe(0);
  });

  it('reorders categories', async () => {
    const rows = await list();
    const id = (code: string) => rows.find((c) => c.code === code)!.id;

    await catalog.reorderCategories(tenantId, [id('HOT'), id('FOOD'), id('DRINKS')], 'corr');
    expect((await list()).map((c) => c.code)).toEqual(['HOT', 'FOOD', 'DRINKS']);
  });

  it('renames a category and keeps its code', async () => {
    const rows = await list();
    const id = (code: string) => rows.find((c) => c.code === code)!.id;

    const renamed = await catalog.updateCategory(tenantId, id('FOOD'), { name: '  Mains ', code: 'IGNORED' } as any, 'corr');
    expect(renamed).toMatchObject({ name: 'Mains', code: 'FOOD' });
    await expect(catalog.updateCategory(tenantId, id('FOOD'), { name: ' ' }, 'corr')).rejects.toThrow('needs a name');
  });

  it('refuses to archive a category that still holds products, and moves them when told where', async () => {
    const rows = await list();
    const id = (code: string) => rows.find((c) => c.code === code)!.id;

    await expect(catalog.archiveCategory(tenantId, id('HOT'), 'corr')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CATEGORY_NOT_EMPTY', count: 2 }),
    });

    const result = await catalog.archiveCategory(tenantId, id('HOT'), 'corr', id('DRINKS'));
    expect(result).toEqual({ success: true, movedProducts: 2 });
    const after = await list();
    expect(after.map((c) => c.code)).toEqual(['FOOD', 'DRINKS']);
    expect(after.find((c) => c.code === 'DRINKS')!.product_count).toBe(2);

    // Empty now: Food archives without moving anything, and its code can't be reused.
    expect(await catalog.archiveCategory(tenantId, id('FOOD'), 'corr')).toEqual({ success: true, movedProducts: 0 });
    await expect(create('FOOD', 'Food again')).rejects.toThrow('already exists');
  });
});
