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

// Add-on groups set up from one sheet, as Toast does (audit 2026-09-29): required is a minimum
// above zero, a group is created with its items in one save, and a category passes its groups
// to every product in it, including ones added later.
describe('Add-on group setup (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let catalog: CatalogService;
  let tenantId: string;
  let burgers: string;
  let drinks: string;
  let classic: string;
  let cheese: string;
  let cola: string;

  const links = (groupId: string) =>
    dataSource.getRepository(ProductOptionGroup).find({ where: { tenant_id: tenantId, option_group_id: groupId } });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    catalog = moduleRef.get(CatalogService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (await save(Tenant, { code: `ADDON-${Date.now()}`, name: 'Add-on setup fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    burgers = (await save(Category, { tenant_id: tenantId, code: 'BURGERS', name: 'Burgers', is_active: true })).id;
    drinks = (await save(Category, { tenant_id: tenantId, code: 'DRINKS', name: 'Drinks', is_active: true })).id;
    const product = async (name: string, categoryId: string) =>
      (await save(Product, { tenant_id: tenantId, category_id: categoryId, name, base_price: '1000000.0000', tax_rate: '0.1000' })).id;
    classic = await product('Classic', burgers);
    cheese = await product('Cheese', burgers);
    cola = await product('Cola', drinks);
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('creates a group with its items, codes and defaults in one save', async () => {
    const group = await catalog.saveOptionGroup(
      tenantId,
      null,
      {
        name: 'Bread',
        min_selection: 1,
        max_selection: 1,
        prompt_at_pos: false,
        items: [
          { name: 'White', price_delta: '0', is_default: true },
          { name: 'Brown', price_delta: '50000' },
        ],
      },
      'test',
    );
    expect(group).toMatchObject({ name: 'Bread', min_selection: 1, max_selection: 1, is_required: true, prompt_at_pos: false });
    expect(group.code).toMatch(/^AG-/);
    expect(group.items.map((i: any) => [i.name, i.is_default, i.sort_order])).toEqual([
      ['White', true, 0],
      ['Brown', false, 1],
    ]);
  });

  it('keeps a group required when it is renamed', async () => {
    // A group marked required with a minimum of 0 used to turn optional on its first save.
    const legacy = await catalog.createOptionGroup(tenantId, { name: 'Sauce', min_selection: 0, max_selection: 2, is_required: true }, 'test');
    expect(legacy).toMatchObject({ min_selection: 1, is_required: true });

    const saved = await catalog.saveOptionGroup(tenantId, legacy.id, { name: 'Sauces', items: [{ name: 'Garlic' }] }, 'test');
    expect(saved).toMatchObject({ name: 'Sauces', min_selection: 1, is_required: true });
  });

  it('reads a maximum of 0 as no limit', async () => {
    const group = await catalog.createOptionGroup(tenantId, { name: 'Toppings', min_selection: 2, max_selection: 0 }, 'test');
    expect(group).toMatchObject({ min_selection: 2, max_selection: 0, is_required: true });
    await expect(catalog.createOptionGroup(tenantId, { name: 'Bad', min_selection: 3, max_selection: 2 }, 'test')).rejects.toThrow('Invalid modifier selections');
  });

  it('passes a category’s group to its products, to new ones, and takes it back with the category', async () => {
    const extras = await catalog.saveOptionGroup(tenantId, null, { name: 'Extras', min_selection: 0, max_selection: 3, items: [{ name: 'Bacon', price_delta: '80000' }] }, 'test');

    const placed = await catalog.setOptionGroupLinks(tenantId, extras.id, { category_ids: [burgers], product_ids: [cola] }, 'test');
    expect(placed.product_links).toHaveLength(3);
    expect((await links(extras.id)).find((l) => l.product_id === classic)?.from_category_id).toBe(burgers);
    expect((await links(extras.id)).find((l) => l.product_id === cola)?.from_category_id).toBeNull();

    // A burger added later gets it; a product moved out loses it.
    const double = await catalog.createProduct(tenantId, { name: 'Double', category_id: burgers, base_price: '1500000' }, 'test');
    expect((await links(extras.id)).some((l) => l.product_id === double.id)).toBe(true);
    await catalog.updateProduct(tenantId, cheese, { category_id: drinks } as Partial<Product>, 'test');
    expect((await links(extras.id)).some((l) => l.product_id === cheese)).toBe(false);

    // A burger taken off by hand stays off when the sheet is saved again.
    await catalog.detachOptionGroupFromProduct(tenantId, classic, extras.id, 'test');
    await catalog.setOptionGroupLinks(tenantId, extras.id, { category_ids: [burgers], product_ids: [cola] }, 'test');
    expect((await links(extras.id)).some((l) => l.product_id === classic)).toBe(false);

    // Off the category: the links it made go, the direct one stays.
    await catalog.setOptionGroupLinks(tenantId, extras.id, { category_ids: [], product_ids: [cola] }, 'test');
    expect((await links(extras.id)).map((l) => l.product_id)).toEqual([cola]);
  });

  it('orders a product’s groups and appends a new one after the rest', async () => {
    const a = await catalog.saveOptionGroup(tenantId, null, { name: 'A', items: [{ name: 'a' }] }, 'test');
    const b = await catalog.saveOptionGroup(tenantId, null, { name: 'B', items: [{ name: 'b' }] }, 'test');
    await catalog.attachOptionGroupToProduct(tenantId, cola, a.id, undefined, 'test');
    await catalog.attachOptionGroupToProduct(tenantId, cola, b.id, undefined, 'test');
    const names = async () => (await catalog.getProductById(tenantId, cola)).optionGroups.map((g: any) => g.name);
    expect((await names()).slice(-2)).toEqual(['A', 'B']);

    const ids = (await catalog.getProductById(tenantId, cola)).optionGroups.map((g: any) => g.id);
    await catalog.reorderProductOptionGroups(tenantId, cola, [...ids].reverse(), 'test');
    expect(await names()).toEqual(['B', 'A', 'Extras']);
  });

  it('lists where each group is used', async () => {
    const groups = (await catalog.getOptionGroups(tenantId)) as Array<OptionGroup & { product_links: any[]; category_ids: string[] }>;
    const extras = groups.find((g) => g.name === 'Extras')!;
    expect(extras.product_links).toEqual([{ product_id: cola, from_category_id: null }]);
    expect(extras.category_ids).toEqual([]);
  });
});
