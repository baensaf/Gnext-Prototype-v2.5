import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { OrderService } from '../src/modules/order/order.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// Archiving a branch against the real database (Branch Management spec, B4 and B5): what
// stops it, what happens to its staff, and what it leaves behind.
describe('Archiving a branch (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let tenants: TenantService;
  let orders: OrderService;
  let tenantId: string;
  let branchId: string;
  let cashierId: string;

  const save = <T>(entity: any, data: Partial<T>) =>
    dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;

  const blockers = async () => {
    try {
      await tenants.archiveBranch(tenantId, branchId, 'test');
      return null;
    } catch (err: any) {
      return err.getResponse?.() as { code: string; context: { items: Array<{ kind: string; label: string }> } };
    }
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    tenants = moduleRef.get(TenantService);
    orders = moduleRef.get(OrderService);

    tenantId = (
      await save(Tenant, { code: `ARCH-${Date.now()}`, name: 'Archive fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    branchId = (
      await save(Branch, { tenant_id: tenantId, code: 'ARC', name: 'Closing branch', is_active: true, time_zone: 'Asia/Tehran', latitude: 35.7, longitude: 51.4 })
    ).id;
    cashierId = (
      await save(AdminUser, { tenant_id: tenantId, username: `cashier-${Date.now()}`, display_name: 'Cashier', password_hash: 'x', role: 'CASHIER', branch_id: branchId, is_active: true })
    ).id;
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('is refused while an order is held or a prepaid delivery is still on the road, and lists them', async () => {
    const held = await save(OrderHeader, { tenant_id: tenantId, branch_id: branchId, order_number: 'ARC-HELD', channel: 'POS', order_type: 'TAKEAWAY', state: 'DRAFT', status: 'DRAFT', currency_code: 'IRR' });
    const paid = await save(OrderHeader, {
      tenant_id: tenantId, branch_id: branchId, order_number: 'ARC-DELIVERY', channel: 'POS', order_type: 'DELIVERY',
      state: 'COMPLETED', status: 'COMPLETED', currency_code: 'IRR', grand_total: '500000.0000', paid_total: '500000.0000', outstanding_total: '0.0000',
    });
    await dataSource.query(`INSERT INTO delivery (tenant_id, order_id, state) VALUES ($1, $2, 'ASSIGNED')`, [tenantId, paid.id]);

    const refusal = await blockers();
    expect(refusal?.code).toBe('BRANCH_HAS_UNFINISHED_WORK');
    expect(refusal?.context.items).toEqual(
      expect.arrayContaining([
        { kind: 'HELD_ORDER', label: 'ARC-HELD' },
        { kind: 'DELIVERY', label: 'ARC-DELIVERY' },
      ]),
    );

    // Discard the held order and finish the delivery: nothing is left.
    await dataSource.query(`UPDATE order_header SET status = 'CANCELLED', state = 'CANCELLED' WHERE id = $1`, [held.id]);
    await dataSource.query(`UPDATE delivery SET state = 'DELIVERED' WHERE order_id = $1`, [paid.id]);
  });

  it('is refused while a cancelled order still owes the customer money', async () => {
    const refund = await save(OrderHeader, {
      tenant_id: tenantId, branch_id: branchId, order_number: 'ARC-REFUND', channel: 'POS', order_type: 'TAKEAWAY',
      state: 'CANCELLED', status: 'CANCELLED', currency_code: 'IRR', paid_total: '200000.0000', refunded_total: '0.0000',
    });
    expect((await blockers())?.context.items).toEqual([{ kind: 'REFUND_DUE', label: 'ARC-REFUND' }]);
    await dataSource.query(`UPDATE order_header SET refunded_total = paid_total WHERE id = $1`, [refund.id]);
  });

  it('archives, takes the branch away from its staff, and refuses new orders there', async () => {
    const result = await tenants.archiveBranch(tenantId, branchId, 'test');
    expect(result).toMatchObject({ success: true, staffWithoutBranch: 1 });

    const cashier = await dataSource.getRepository(AdminUser).findOneByOrFail({ id: cashierId });
    expect(cashier.is_active).toBe(true);
    expect(cashier.branch_id).toBe(branchId);
    expect(cashier.branch_removed_at).toBeInstanceOf(Date);

    await expect(orders.createDraft(tenantId, { branch_id: branchId, order_type: 'TAKEAWAY' } as any)).rejects.toThrow();
  });

  it('keeps the archived title reserved, and restoring does not give the staff their branch back', async () => {
    await expect(
      tenants.createBranch(
        tenantId,
        {
          name: 'closing branch',
          latitude: 35.7,
          longitude: 51.4,
          hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day_of_week: day, open_time: '11:00', close_time: '04:00' })),
        },
        'test',
      ),
    ).rejects.toThrow('reserved');

    await tenants.restoreBranch(tenantId, branchId, 'test');
    const cashier = await dataSource.getRepository(AdminUser).findOneByOrFail({ id: cashierId });
    expect(cashier.branch_removed_at).toBeInstanceOf(Date);
  });
});
