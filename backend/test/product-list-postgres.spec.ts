import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { ProductVariant } from '../src/entities/ProductVariant.entity';
import { FileAsset } from '../src/entities/FileAsset.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// The products list shows a thumbnail and a size count per product, from one request.
describe('Product list (PostgreSQL)', () => {
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
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it("carries each product's main photo address and its sizes", async () => {
    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (await save(Tenant, { code: `PLIST-${Date.now()}`, name: 'Product list fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'PL-MAINS', name: 'Mains', is_active: true })).id;
    const photo = await save(FileAsset, { tenant_id: tenantId, file_path: '/uploads/burger.jpg', mime_type: 'image/jpeg', size_bytes: 1000 });
    const burger = await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'BURGER', name: 'Burger', base_price: '100000.0000', tax_rate: '0.0900', is_active: true, image_asset_id: photo.id });
    await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'SODA', name: 'Soda', base_price: '20000.0000', tax_rate: '0.0900', is_active: true });
    await save(ProductVariant, { tenant_id: tenantId, product_id: burger.id, code: 'BURGER-S', name: 'Single', base_price: '100000.0000', is_active: true });
    await save(ProductVariant, { tenant_id: tenantId, product_id: burger.id, code: 'BURGER-D', name: 'Double', base_price: '150000.0000', is_active: true });

    const list = (await catalog.getProducts(tenantId)) as Array<Product & { image_url: string | null; variants: ProductVariant[] }>;
    expect(list.map((p) => [p.code, p.image_url, p.variants.length])).toEqual([
      ['BURGER', '/api/v1/media/uploads/burger.jpg', 2],
      ['SODA', null, 0],
    ]);
  });
});
