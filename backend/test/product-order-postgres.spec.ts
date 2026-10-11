import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// Products in a category are put in order by hand, as Snappfood's "ترتیب محصولات" (2026-10-12).
describe('Product order in a category (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let catalog: CatalogService;
  let tenantId: string;
  let burgers: string;
  let drinks: string;
  const ids: Record<string, string> = {};

  const names = async (categoryId: string) =>
    ((await catalog.getProducts(tenantId, categoryId)) as Product[]).map((p) => p.name);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    catalog = moduleRef.get(CatalogService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (await save(Tenant, { code: `ORDER-${Date.now()}`, name: 'Product order fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    burgers = (await save(Category, { tenant_id: tenantId, code: 'BURGERS', name: 'Burgers', is_active: true })).id;
    drinks = (await save(Category, { tenant_id: tenantId, code: 'DRINKS', name: 'Drinks', is_active: true })).id;
    for (const name of ['Alpha', 'Bravo', 'Charlie']) {
      ids[name] = (await save(Product, { tenant_id: tenantId, category_id: burgers, name, base_price: '1000000.0000', tax_rate: '0.0900' })).id;
    }
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('lists by name until a category is put in order, then in that order', async () => {
    expect(await names(burgers)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    await catalog.reorderProducts(tenantId, burgers, [ids.Charlie, ids.Alpha], 'test');
    // Bravo was left out, so it comes after the placed ones.
    expect(await names(burgers)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  it('puts a new product after the placed ones', async () => {
    await catalog.createProduct(tenantId, { name: 'Aardvark', category_id: burgers, base_price: '1000000' }, 'test');
    expect(await names(burgers)).toEqual(['Charlie', 'Alpha', 'Aardvark', 'Bravo']);
  });

  it('refuses ordering products of another category, and a moved product loses its place', async () => {
    await expect(catalog.reorderProducts(tenantId, drinks, [ids.Alpha], 'test')).rejects.toThrow('one category at a time');
    await catalog.updateProduct(tenantId, ids.Charlie, { category_id: drinks } as Partial<Product>, 'test');
    const moved = await dataSource.getRepository(Product).findOneByOrFail({ id: ids.Charlie });
    expect(moved.sort_order).toBeNull();
    expect(await names(burgers)).toEqual(['Alpha', 'Aardvark', 'Bravo']);
  });
});
