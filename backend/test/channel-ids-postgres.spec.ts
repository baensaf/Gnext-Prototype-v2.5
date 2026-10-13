import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Category } from '../src/entities/Category.entity';
import { ChannelItemMap } from '../src/entities/ChannelItemMap.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// Every menu record gets its permanent Snappfood id the moment it is made, from one sequence per
// tenant starting at 1001, so the V2 menu sync never has to fill them in.
describe('Snappfood ids from creation (PostgreSQL)', () => {
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
    const tenants = dataSource.getRepository(Tenant);
    const tenant: any = await tenants.save(
      tenants.create({ code: `CHID-${Date.now()}`, name: 'Channel ids', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' } as any),
    );
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const idsOf = async () =>
    (await dataSource.getRepository(ChannelItemMap).find({ where: { tenant_id: tenantId, channel: 'SNAPPFOOD' }, order: { external_id: 'ASC' } })).map(
      (r) => [r.entity_type, r.entity_id, r.external_id] as const,
    );

  it('numbers a category, a product, its size and an add-on group and add-on as they are made', async () => {
    const categories = dataSource.getRepository(Category);
    const drinks = await categories.save(categories.create({ tenant_id: tenantId, code: 'DRINKS', name: 'Drinks', is_active: true }));
    const cola = await catalog.createProduct(tenantId, { name: 'Cola', category_id: drinks.id, base_price: '300000' } as any, 'test');
    const large = await catalog.createProductVariant(tenantId, cola.id, { code: 'COLA-L', name: 'Large', base_price: '400000' }, 'test');
    const group = await catalog.saveOptionGroup(tenantId, null, { name: 'Ice', min_selection: 0, max_selection: 1, items: [{ name: 'No ice', price_delta: '0' }] }, 'test');

    const ids = await idsOf();
    expect(ids.map(([type, , n]) => [type, n])).toEqual([
      ['CATEGORY', 1001],
      ['PRODUCT', 1002],
      ['VARIANT', 1003],
      ['OPTION_GROUP', 1004],
      ['OPTION_ITEM', 1005],
    ]);
    expect(ids.map(([, id]) => id).slice(0, 4)).toEqual([drinks.id, cola.id, large.id, group.id]);
  });

  it('keeps the number when the record is renamed', async () => {
    const [[, productId, before]] = (await idsOf()).filter(([type]) => type === 'PRODUCT');
    await catalog.updateProduct(tenantId, productId, { name: 'Coca-Cola' } as any, 'test');
    const [[, , after]] = (await idsOf()).filter(([type]) => type === 'PRODUCT');
    expect(after).toBe(before);
  });
});
