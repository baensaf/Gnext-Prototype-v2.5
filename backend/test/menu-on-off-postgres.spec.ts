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
import { deleteTenantData } from './utils/tenant-teardown';

// Off menu is separate from a stop (86): it hides an item, or a whole category, until someone
// turns it back on. A category switched off hides its items; they keep their own switch.
describe('Menu on/off switch (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let catalog: CatalogService;
  let kiosk: KioskService;
  let tenantId: string;
  let branchId: string;
  let categoryId: string;
  let burger: string;
  let fries: string;

  const CORRELATION = '00000000-0000-0000-0000-000000000000';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    catalog = moduleRef.get(CatalogService);
    kiosk = moduleRef.get(KioskService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;

    tenantId = (await save(Tenant, { code: `ONOFF-${Date.now()}`, name: 'Menu on/off fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'OO1', name: 'Main', is_active: true, time_zone: 'Asia/Tehran' })).id;
    categoryId = (await save(Category, { tenant_id: tenantId, code: 'OO-MAINS', name: 'Mains', is_active: true })).id;
    burger = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'BURGER', name: 'Burger', base_price: '100000.0000', tax_rate: '0.0000', is_active: true })).id;
    fries = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'FRIES', name: 'Fries', base_price: '50000.0000', tax_rate: '0.0000', is_active: true })).id;
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const kioskProductIds = async () => {
    const menu: any = await kiosk.getBootstrapContext(tenantId, branchId);
    return (menu.products as Array<{ id: string }>).map((p) => p.id).sort();
  };

  it('turns an item off and back on without archiving it', async () => {
    await catalog.updateProduct(tenantId, burger, { is_active: false }, CORRELATION);
    expect(await kioskProductIds()).toEqual([fries]);
    // Still listed for the back office, unlike an archived item.
    expect(await dataSource.getRepository(Product).findOne({ where: { id: burger } })).toMatchObject({ is_active: false });

    await catalog.updateProduct(tenantId, burger, { is_active: true }, CORRELATION);
    expect(await kioskProductIds()).toEqual([burger, fries].sort());
  });

  it('hides every item of a category switched off, and brings them back as they were', async () => {
    await catalog.updateProduct(tenantId, fries, { is_active: false }, CORRELATION);
    await catalog.updateCategory(tenantId, categoryId, { is_active: false }, CORRELATION);
    expect(await catalog.isCategoryOff(tenantId, categoryId)).toBe(true);
    expect(await kioskProductIds()).toEqual([]);

    await catalog.updateCategory(tenantId, categoryId, { is_active: true }, CORRELATION);
    expect(await catalog.isCategoryOff(tenantId, categoryId)).toBe(false);
    // Fries were off on their own, so they stay off.
    expect(await kioskProductIds()).toEqual([burger]);
  });
});
