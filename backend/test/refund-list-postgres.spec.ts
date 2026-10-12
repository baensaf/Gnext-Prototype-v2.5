import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { AuditEvent } from '../src/entities/AuditEvent.entity';
import { Refund } from '../src/entities/Refund.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { RefundService } from '../src/modules/refund/refund.service';
import { deleteTenantData } from './utils/tenant-teardown';

// The Orders page's Refunded tab lists refunds, bounded by the time the money went back, with
// the order's call number and who released each one.
describe('refund list (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let refunds: RefundService;
  let tenantId: string;
  let branchA: string;
  let branchB: string;
  let managerId: string;
  let orderA: string;
  let orderB: string;
  let refundA: string;
  let refundB: string;

  const at = (d: number, hour = 12) => new Date(Date.UTC(2026, 8, d, hour, 0, 0));

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    refunds = moduleRef.get(RefundService);

    const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
    tenantId = (await save(Tenant, { code: `RFL-${Date.now()}`, name: 'Refund list', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchA = (await save(Branch, { tenant_id: tenantId, code: 'RFA', name: 'A', is_active: true, time_zone: 'Asia/Tehran' })).id;
    branchB = (await save(Branch, { tenant_id: tenantId, code: 'RFB', name: 'B', is_active: true, time_zone: 'Asia/Tehran' })).id;
    managerId = (await save(AdminUser, { tenant_id: tenantId, username: 'rfl-manager', display_name: 'Sara Manager', password_hash: 'x', role: 'MANAGER', branch_id: branchA })).id;
    const cashierId = (await save(AdminUser, { tenant_id: tenantId, username: 'rfl-cashier', display_name: 'Ali Cashier', password_hash: 'x', role: 'CASHIER', branch_id: branchB })).id;

    const order = async (branch_id: string, order_number: string, call_number: number) =>
      (await save(OrderHeader, { tenant_id: tenantId, branch_id, order_number, call_number, channel: 'POS', order_type: 'TAKEAWAY', state: 'COMPLETED', status: 'COMPLETED' })).id;
    orderA = await order(branchA, 'RFL-1', 41);
    orderB = await order(branchB, 'RFL-2', 42);

    const refund = async (order_id: string, refund_number: string, reason_text: string, when: Date, actor: string, approvedBy?: string) => {
      const saved = await save(Refund, {
        tenant_id: tenantId, order_id, refund_number, status: 'SUCCEEDED', method_id: randomUUID(), method_kind: 'CASH', amount: '50000.0000', reason_text,
      });
      // initiated_at is a create-date column; set it after the insert.
      await dataSource.query(`UPDATE refund SET initiated_at = $1 WHERE id = $2`, [when, saved.id]);
      await save(AuditEvent, {
        tenant_id: tenantId, event_type: 'REFUND_SUCCEEDED', actor_type: 'ADMIN', actor_id: actor, action: 'REFUND_SUCCEEDED', entity_type: 'Refund', entity_id: saved.id,
        details: approvedBy ? { approvedBy } : null,
      });
      return saved.id as string;
    };
    // A refund made on the 20th against an order placed long before, released by a manager's PIN
    // at a cashier's till; and an older one the manager made on their own authority.
    refundA = await refund(orderA, 'REF-A', 'Cold fries', at(20), cashierId, managerId);
    refundB = await refund(orderB, 'REF-B', 'Wrong order', at(5), managerId);
  }, 120000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('bounds the list by the time of the refund', async () => {
    const day20 = await refunds.getRefunds(tenantId, { from: at(20, 0).toISOString(), to: at(21, 0).toISOString() });
    expect(day20.data.map((r) => r.id)).toEqual([refundA]);
    expect(day20.total).toBe(1);

    const all = await refunds.getRefunds(tenantId, {});
    expect(all.data.map((r) => r.id)).toEqual([refundA, refundB]);
  });

  it('names the order by call number and who released the money', async () => {
    const { data } = await refunds.getRefunds(tenantId, {});
    expect(data.find((r) => r.id === refundA)).toEqual(
      expect.objectContaining({ order_number: 'RFL-1', order_call_number: 41, approved_by_name: 'Sara Manager' }),
    );
    // No separate approver in the audit entry: the account that made the refund released it.
    expect(data.find((r) => r.id === refundB)?.approved_by_name).toBe('Sara Manager');
  });

  it('searches the order number, the refund number and the reason', async () => {
    expect((await refunds.getRefunds(tenantId, { q: 'cold' })).data.map((r) => r.id)).toEqual([refundA]);
    expect((await refunds.getRefunds(tenantId, { q: 'RFL-2' })).data.map((r) => r.id)).toEqual([refundB]);
    expect((await refunds.getRefunds(tenantId, { q: 'REF-B' })).data.map((r) => r.id)).toEqual([refundB]);
  });

  it('keeps to the branch asked about', async () => {
    const res = await refunds.getRefunds(tenantId, {}, branchB);
    expect(res.data.map((r) => r.id)).toEqual([refundB]);
    expect(res.total).toBe(1);
  });
});
