import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { CatalogController } from '../src/modules/catalog/catalog.controller';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// "The grill is down": a whole category off at once. Head office stops an item at several
// branches at once.
describe('Bulk 86 (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let controller: CatalogController;
  let catalog: CatalogService;
  let tenantId: string;
  let branchA: string;
  let branchB: string;
  let grill: string;
  let burger: string;
  let kebab: string;
  let soda: string;
  let managerId: string;
  let hqId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    controller = moduleRef.get(CatalogController);
    catalog = moduleRef.get(CatalogService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (await save(Tenant, { code: `B86-${Date.now()}`, name: 'Bulk 86 fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchA = (await save(Branch, { tenant_id: tenantId, code: 'B86A', name: 'Alpha', is_active: true, time_zone: 'Asia/Tehran' })).id;
    branchB = (await save(Branch, { tenant_id: tenantId, code: 'B86B', name: 'Beta', is_active: true, time_zone: 'Asia/Tehran' })).id;
    grill = (await save(Category, { tenant_id: tenantId, code: 'B86-GRILL', name: 'Grill', is_active: true })).id;
    const drinks = (await save(Category, { tenant_id: tenantId, code: 'B86-DRINKS', name: 'Drinks', is_active: true })).id;
    const product = async (code: string, categoryId: string, price: string) =>
      (await save(Product, { tenant_id: tenantId, category_id: categoryId, code, name: code, base_price: price, tax_rate: '0.0000', is_active: true })).id;
    burger = await product('BURGER', grill, '200000.0000');
    kebab = await product('KEBAB', grill, '300000.0000');
    soda = await product('SODA', drinks, '30000.0000');
    const password = await argon2.hash('x');
    managerId = (await save(AdminUser, { tenant_id: tenantId, username: `b86-mgr-${Date.now()}`, display_name: 'Mina Manager', password_hash: password, role: 'MANAGER', branch_id: branchA, is_active: true })).id;
    hqId = (await save(AdminUser, { tenant_id: tenantId, username: `b86-hq-${Date.now()}`, display_name: 'Hadi HQ', password_hash: password, role: 'ADMIN', branch_id: null, is_active: true })).id;
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const session = (userId: string, role: string, userBranchId: string | null) =>
    ({ tenantId, userId, userRole: role, userBranchId, correlationId: '00000000-0000-0000-0000-000000000000' }) as any;
  const manager = () => session(managerId, 'MANAGER', branchA);
  const hq = () => session(hqId, 'ADMIN', null);
  const off = async (productId: string, branchId: string) => (await catalog.getSuspension(tenantId, productId, branchId)).isSuspended;

  it("stops a whole category, sub-categories included, at the branch's own branch only", async () => {
    // A branch manager naming another branch still acts at their own.
    const result = await controller.bulkStop({ categoryId: grill, branchIds: [branchB] }, manager());
    expect(result).toEqual({ products: 2, branches: 1, stopped: 2 });
    expect([await off(burger, branchA), await off(kebab, branchA), await off(soda, branchA)]).toEqual([true, true, false]);
    expect(await off(burger, branchB)).toBe(false);
  });

  it('lets head office stop an item at the branches it names, or chain-wide with none', async () => {
    expect(await controller.bulkStop({ productIds: [soda], branchIds: [branchA, branchB] }, hq())).toEqual({ products: 1, branches: 2, stopped: 2 });
    expect([await off(soda, branchA), await off(soda, branchB)]).toEqual([true, true]);
    await controller.bulkResume({ productIds: [soda], branchIds: [branchA, branchB] }, hq());
    expect([await off(soda, branchA), await off(soda, branchB)]).toEqual([false, false]);

    await expect(controller.bulkStop({ productIds: [soda], branchIds: ['00000000-0000-0000-0000-00000000dead'] }, hq())).rejects.toThrow('Branch not found');
  });

  it("puts a category back, but a branch can't lift head office's chain-wide stop", async () => {
    await controller.bulkStop({ productIds: [burger] }, hq());
    const back = await controller.bulkResume({ categoryId: grill }, manager());
    expect(back).toEqual({ resumed: 1, chain_wide: 1 });
    expect(await off(kebab, branchA)).toBe(false);
    expect(await off(burger, branchA)).toBe(true);
    await controller.bulkResume({ productIds: [burger] }, hq());
  });
});
