import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { OptionGroup } from '../src/entities/OptionGroup.entity';
import { ProductOptionGroup } from '../src/entities/ProductOptionGroup.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// Add-on groups as Snappfood's vendor panel has them (2026-10-11): a group is a name, choices
// with prices and an at-least / at-most rule, and each product switches choices on or off.
describe('Add-on group setup (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let catalog: CatalogService;
  let tenantId: string;
  let classic: string;
  let cola: string;

  const link = (productId: string, groupId: string) =>
    dataSource.getRepository(ProductOptionGroup).findOne({ where: { tenant_id: tenantId, product_id: productId, option_group_id: groupId } });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    catalog = moduleRef.get(CatalogService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (await save(Tenant, { code: `ADDON-${Date.now()}`, name: 'Add-on setup fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    const burgers = (await save(Category, { tenant_id: tenantId, code: 'BURGERS', name: 'Burgers', is_active: true })).id;
    const product = async (name: string) =>
      (await save(Product, { tenant_id: tenantId, category_id: burgers, name, base_price: '1000000.0000', tax_rate: '0.1000' })).id;
    classic = await product('Classic');
    cola = await product('Cola');
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('creates a group with its choices in one save, in the order typed', async () => {
    const group = await catalog.saveOptionGroup(
      tenantId,
      null,
      { name: 'Bread', min_selection: 1, max_selection: 1, items: [{ name: 'White', price_delta: '0' }, { name: 'Brown', price_delta: '50000' }] },
      'test',
    );
    expect(group).toMatchObject({ name: 'Bread', min_selection: 1, max_selection: 1, is_required: true });
    expect(group.code).toMatch(/^AG-/);
    expect(group.items.map((i: any) => [i.name, i.price_delta, i.sort_order])).toEqual([
      ['White', '0.0000', 0],
      ['Brown', '50000.0000', 1],
    ]);
  });

  it('needs at most to be 1 or more and not below at least', async () => {
    await expect(catalog.createOptionGroup(tenantId, { name: 'Toppings', min_selection: 0, max_selection: 0 }, 'test')).rejects.toThrow('at most is 1 or more');
    await expect(catalog.createOptionGroup(tenantId, { name: 'Bad', min_selection: 3, max_selection: 2 }, 'test')).rejects.toThrow('not below at least');
    const ok = await catalog.createOptionGroup(tenantId, { name: 'Sauces', min_selection: 0, max_selection: 2 }, 'test');
    expect(ok).toMatchObject({ min_selection: 0, max_selection: 2, is_required: false });
  });

  it('switches choices on a product: the first puts the group on, the last takes it off', async () => {
    const extras = await catalog.saveOptionGroup(
      tenantId,
      null,
      { name: 'Extras', min_selection: 0, max_selection: 3, items: [{ name: 'Bacon', price_delta: '80000' }, { name: 'Cheese', price_delta: '60000' }] },
      'test',
    );
    const [bacon, cheese] = extras.items.map((i: any) => i.id);

    await catalog.setOfferedChoices(tenantId, classic, extras.id, [bacon], 'test');
    expect((await link(classic, extras.id))?.excluded_item_ids).toEqual([cheese]);

    await catalog.setOfferedChoices(tenantId, classic, extras.id, [bacon, cheese], 'test');
    expect((await link(classic, extras.id))?.excluded_item_ids).toEqual([]);

    await catalog.setOfferedChoices(tenantId, classic, extras.id, [], 'test');
    expect(await link(classic, extras.id)).toBeNull();
  });

  it('refuses switching a required group below its minimum', async () => {
    const sides = await catalog.saveOptionGroup(
      tenantId,
      null,
      { name: 'Sides', min_selection: 2, max_selection: 2, items: [{ name: 'Fries' }, { name: 'Salad' }, { name: 'Rings' }] },
      'test',
    );
    await expect(catalog.setOfferedChoices(tenantId, cola, sides.id, [sides.items[0].id], 'test')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'OPTION_GROUP_UNFILLABLE' }),
    });
    await catalog.setOfferedChoices(tenantId, cola, sides.id, [sides.items[0].id, sides.items[1].id], 'test');
    expect((await link(cola, sides.id))?.excluded_item_ids).toEqual([sides.items[2].id]);
  });

  it('shows groups in the order they were made, and lists every group with its products', async () => {
    const a = await catalog.saveOptionGroup(tenantId, null, { name: 'A', items: [{ name: 'a' }] }, 'test');
    const b = await catalog.saveOptionGroup(tenantId, null, { name: 'B', items: [{ name: 'b' }] }, 'test');
    await catalog.attachOptionGroupToProduct(tenantId, cola, b.id, 'test');
    await catalog.attachOptionGroupToProduct(tenantId, cola, a.id, 'test');
    const names = (await catalog.getProductById(tenantId, cola)).optionGroups.map((g: any) => g.name);
    expect(names).toEqual(['Sides', 'A', 'B']);

    const groups = (await catalog.getOptionGroups(tenantId)) as Array<OptionGroup & { product_ids: string[] }>;
    expect(groups.map((g) => g.name)).toEqual(['Bread', 'Sauces', 'Extras', 'Sides', 'A', 'B']);
    expect(groups.find((g) => g.name === 'A')!.product_ids).toEqual([cola]);
    expect(groups.find((g) => g.name === 'Extras')!.product_ids).toEqual([]);
  });
});
