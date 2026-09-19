import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// Categories: rename, reorder, one level of nesting, and no archiving a category that still
// holds products unless they move in the same step (audit C12).
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

  const create = (code: string, name: string, parent_id?: string) => catalog.createCategory(tenantId, { code, name, parent_id }, 'corr');
  const list = async () => (await catalog.getCategories(tenantId)) as Array<Category & { product_count: number }>;
  const product = (code: string, category_id: string) =>
    dataSource.getRepository(Product).save(
      dataSource.getRepository(Product).create({ tenant_id: tenantId, category_id, code, name: code, base_price: '1000.0000', tax_rate: '0.0000', is_active: true }),
    );

  it('lists categories in tree order, each with its product count', async () => {
    const drinks = await create('DRINKS', 'Drinks');
    const food = await create('FOOD', 'Food');
    const hot = await create('HOT', 'Hot drinks', drinks.id);
    const cold = await create('COLD', 'Cold drinks', drinks.id);
    await product('TEA', hot.id);
    await product('COFFEE', hot.id);

    // New categories go at the end of their siblings.
    expect([drinks.sort_order, food.sort_order, hot.sort_order, cold.sort_order]).toEqual([1, 2, 1, 2]);
    const rows = await list();
    expect(rows.map((c) => c.code)).toEqual(['DRINKS', 'HOT', 'COLD', 'FOOD']);
    expect(rows.find((c) => c.code === 'HOT')!.product_count).toBe(2);
    expect(rows.find((c) => c.code === 'FOOD')!.product_count).toBe(0);
  });

  it('reorders siblings, and refuses to order categories from different parents together', async () => {
    const rows = await list();
    const id = (code: string) => rows.find((c) => c.code === code)!.id;

    await catalog.reorderCategories(tenantId, [id('FOOD'), id('DRINKS')], 'corr');
    await catalog.reorderCategories(tenantId, [id('COLD'), id('HOT')], 'corr');
    expect((await list()).map((c) => c.code)).toEqual(['FOOD', 'DRINKS', 'COLD', 'HOT']);

    await expect(catalog.reorderCategories(tenantId, [id('FOOD'), id('HOT')], 'corr')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CATEGORY_NOT_SIBLINGS' }),
    });
  });

  it('renames and moves a category, one level deep only', async () => {
    const rows = await list();
    const id = (code: string) => rows.find((c) => c.code === code)!.id;

    const renamed = await catalog.updateCategory(tenantId, id('FOOD'), { name: '  Mains ', code: 'IGNORED' } as any, 'corr');
    expect(renamed).toMatchObject({ name: 'Mains', code: 'FOOD' });
    await expect(catalog.updateCategory(tenantId, id('FOOD'), { name: ' ' }, 'corr')).rejects.toThrow('needs a name');

    const code = (err: string) => ({ response: expect.objectContaining({ code: err }) });
    // Under a sub-category: too deep. A category with children under another: refused. Under itself: refused.
    await expect(catalog.updateCategory(tenantId, id('FOOD'), { parent_id: id('HOT') }, 'corr')).rejects.toMatchObject(code('CATEGORY_TOO_DEEP'));
    await expect(catalog.updateCategory(tenantId, id('DRINKS'), { parent_id: id('FOOD') }, 'corr')).rejects.toMatchObject(code('CATEGORY_HAS_SUBCATEGORIES'));
    await expect(catalog.updateCategory(tenantId, id('FOOD'), { parent_id: id('FOOD') }, 'corr')).rejects.toMatchObject(code('CATEGORY_PARENT_INVALID'));

    // Cold drinks moves to the top level, at the end.
    const moved = await catalog.updateCategory(tenantId, id('COLD'), { parent_id: null } as any, 'corr');
    expect(moved.parent_id).toBeNull();
    expect((await list()).map((c) => c.code)).toEqual(['FOOD', 'DRINKS', 'HOT', 'COLD']);
  });

  it('refuses to archive a category that still holds products or sub-categories, and moves products when told where', async () => {
    const rows = await list();
    const id = (code: string) => rows.find((c) => c.code === code)!.id;

    await expect(catalog.archiveCategory(tenantId, id('DRINKS'), 'corr')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CATEGORY_HAS_SUBCATEGORIES', count: 1 }),
    });
    await expect(catalog.archiveCategory(tenantId, id('HOT'), 'corr')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CATEGORY_NOT_EMPTY', count: 2 }),
    });

    const result = await catalog.archiveCategory(tenantId, id('HOT'), 'corr', id('COLD'));
    expect(result).toEqual({ success: true, movedProducts: 2 });
    const after = await list();
    expect(after.map((c) => c.code)).toEqual(['FOOD', 'DRINKS', 'COLD']);
    expect(after.find((c) => c.code === 'COLD')!.product_count).toBe(2);

    // Empty now: Drinks archives without moving anything, and its code can't be reused.
    expect(await catalog.archiveCategory(tenantId, id('DRINKS'), 'corr')).toEqual({ success: true, movedProducts: 0 });
    await expect(create('DRINKS', 'Drinks again')).rejects.toThrow('already exists');
  });
});
