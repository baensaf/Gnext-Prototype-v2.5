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
import { AuditEvent } from '../src/entities/AuditEvent.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// 86 from the register's tile, as decided on 2026-09-18: any register user can take an item
// off until the next shift with a reason; until further notice, and putting it back, need an
// approver or an approver's pin. Every stop is logged with who did it and whose pin allowed it.
describe('86 from the POS tile (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let controller: CatalogController;
  let catalog: CatalogService;
  let tenantId: string;
  let branchId: string;
  let otherBranchId: string;
  let cashierId: string;
  let managerId: string;
  let burger: string;

  const PIN = '1357';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    controller = moduleRef.get(CatalogController);
    catalog = moduleRef.get(CatalogService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;

    tenantId = (await save(Tenant, { code: `POS86-${Date.now()}`, name: 'POS 86 fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'P86', name: 'Main', is_active: true, time_zone: 'Asia/Tehran' })).id;
    otherBranchId = (await save(Branch, { tenant_id: tenantId, code: 'P86B', name: 'Other', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'P86-MAINS', name: 'Mains', is_active: true })).id;
    burger = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'BURGER', name: 'Burger', base_price: '100000.0000', tax_rate: '0.0000', is_active: true })).id;
    const password = await argon2.hash('x');
    cashierId = (await save(AdminUser, { tenant_id: tenantId, username: `cashier-${Date.now()}`, display_name: 'Cashier', password_hash: password, role: 'CASHIER', branch_id: branchId, is_active: true })).id;
    managerId = (await save(AdminUser, { tenant_id: tenantId, username: `manager-${Date.now()}`, display_name: 'Manager', password_hash: password, role: 'MANAGER', branch_id: branchId, is_active: true, pin_hash: await argon2.hash(PIN) })).id;
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const session = (userId: string, role: string, userBranchId: string | null = branchId) =>
    ({ tenantId, userId, userRole: role, userBranchId, correlationId: '00000000-0000-0000-0000-000000000000' }) as any;
  const cashier = () => session(cashierId, 'CASHIER');
  const manager = () => session(managerId, 'MANAGER');
  const stopped = async () => (await catalog.getSuspension(tenantId, burger, branchId)).isSuspended;

  it('lets a cashier stop an item until the next shift, with a reason, and logs who did it', async () => {
    await expect(controller.posStop({ productId: burger, until: 'NEXT_SHIFT', reason: '  ' }, cashier())).rejects.toThrow('Pick why');

    const stop = await controller.posStop({ productId: burger, until: 'NEXT_SHIFT', reason: 'Sold out' }, cashier());
    expect(stop.suspended_until).not.toBeNull();
    expect(await stopped()).toBe(true);

    const log = await dataSource.getRepository(AuditEvent).findOne({ where: { tenant_id: tenantId, action: 'PRODUCT_SUSPENDED' }, order: { occurred_at: 'DESC' } });
    expect(log).toMatchObject({ actor_id: cashierId, branch_id: branchId });
    expect(log!.details).toMatchObject({ reason: 'Sold out', source: 'POS', approverId: null });
  });

  it("needs an approver's pin for a cashier to stop an item until further notice", async () => {
    await expect(controller.posStop({ productId: burger, until: 'FURTHER_NOTICE', reason: 'Fryer down' }, cashier())).rejects.toThrow();
    await expect(controller.posStop({ productId: burger, until: 'FURTHER_NOTICE', reason: 'Fryer down', approverPin: '0000' }, cashier())).rejects.toThrow('Invalid manager PIN');

    const stop = await controller.posStop({ productId: burger, until: 'FURTHER_NOTICE', reason: 'Fryer down', approverPin: PIN }, cashier());
    expect(stop.suspended_until).toBeNull();
    const log = await dataSource.getRepository(AuditEvent).findOne({ where: { tenant_id: tenantId, action: 'PRODUCT_SUSPENDED' }, order: { occurred_at: 'DESC' } });
    expect(log!.details).toMatchObject({ approverId: managerId, untilNextShift: false });
  });

  it("needs an approver's pin for a cashier to put an item back; a manager needs none", async () => {
    await expect(controller.posResume({ productId: burger }, cashier())).rejects.toThrow();
    expect(await stopped()).toBe(true);

    await controller.posResume({ productId: burger, approverPin: PIN }, cashier());
    expect(await stopped()).toBe(false);

    await controller.posStop({ productId: burger, until: 'FURTHER_NOTICE', reason: 'Fryer down' }, manager());
    await controller.posResume({ productId: burger }, manager());
    expect(await stopped()).toBe(false);
  });

  it("keeps a branch register to its own branch, and head office to the branch it names", async () => {
    // A cashier naming another branch still acts on their own.
    await controller.posStop({ productId: burger, until: 'NEXT_SHIFT', reason: 'Sold out', branchId: otherBranchId }, cashier());
    expect((await catalog.getSuspension(tenantId, burger, otherBranchId)).isSuspended).toBe(false);
    expect(await stopped()).toBe(true);
    await controller.posResume({ productId: burger }, manager());

    await expect(controller.posStop({ productId: burger, until: 'NEXT_SHIFT', reason: 'Sold out' }, session(managerId, 'ADMIN', null))).rejects.toThrow(
      'Pick the branch',
    );
  });
});
