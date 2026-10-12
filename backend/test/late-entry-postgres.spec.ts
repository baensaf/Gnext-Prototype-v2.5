import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderService } from '../src/modules/order/order.service';
import { ApprovalService } from '../src/modules/approval/approval.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { deleteTenantData } from './utils/tenant-teardown';

// A forgotten order is rung up now, never backdated: a reason and a manager's PIN, no kitchen
// chit, and the card (already charged) recorded from its slip.
describe('late entry (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: OrderService;
  let approvals: ApprovalService;
  let payments: PaymentService;
  let tenantId: string;
  let branchId: string;
  let adminId: string;
  let cashierId: string;
  let productId: string;
  let cardMethodId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    await dataSource.runMigrations();
    orders = moduleRef.get(OrderService);
    approvals = moduleRef.get(ApprovalService);
    payments = moduleRef.get(PaymentService);

    const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
    const tag = Date.now();
    tenantId = (await save(Tenant, { code: `LATE-${tag}`, name: 'Late entry', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'LE1', name: 'A', is_active: true, time_zone: 'Asia/Tehran' })).id;
    adminId = (
      await save(AdminUser, {
        tenant_id: tenantId, username: `le_admin_${tag}`, password_hash: await argon2.hash('x'), pin_hash: await argon2.hash('2468'),
        display_name: 'Manager', role: 'ADMIN', is_active: true,
      })
    ).id;
    cashierId = (
      await save(AdminUser, {
        tenant_id: tenantId, username: `le_cashier_${tag}`, password_hash: await argon2.hash('x'),
        display_name: 'Cashier', role: 'CASHIER', is_active: true,
      })
    ).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'LE-MAINS', name: 'Mains', is_active: true })).id;
    productId = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'LE-P', name: 'Burger', base_price: '100000.0000', tax_rate: '0.0000', is_active: true })).id;
    cardMethodId = (await save(PaymentMethod, { tenant_id: tenantId, code: 'CARD', name: 'Card', kind: 'CARD_POS', is_active: true })).id;
  }, 120000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const draft = async () =>
    (await orders.createDraft(tenantId, { branch_id: branchId, order_type: 'TAKEAWAY', items: [{ product_id: productId, quantity: '1' }] }, cashierId, 'corr'))!;

  /** The request the till raises before the order exists, approved with the manager's PIN. */
  const approved = async (pin = '2468') => {
    const request = await approvals.createRequest(tenantId, cashierId, { action: 'LATE_ENTRY', entity_type: 'ORDER', reason: 'Forgotten' }, 'corr');
    await approvals.approveRequest(tenantId, request.id, cashierId, pin, 'Manager PIN Authorization', 'corr');
    return request.id;
  };

  const printJobs = async (orderId: string) =>
    (await dataSource.query(`SELECT * FROM print_job WHERE tenant_id = $1 AND entity_id = $2`, [tenantId, orderId])) as any[];

  it('refuses without a manager approval, or without a reason, and the draft stays a draft', async () => {
    const d = await draft();
    await expect(orders.submitOrder(tenantId, d.id, { lateEntry: { reason: 'Forgot to ring it' } }, cashierId)).rejects.toMatchObject({
      response: { code: 'APPROVAL_REQUIRED' },
    });
    await expect(
      orders.submitOrder(tenantId, d.id, { lateEntry: { reason: '   ', approvalRequestId: await approved() } }, cashierId),
    ).rejects.toMatchObject({ response: { code: 'LATE_ENTRY_REASON_REQUIRED' } });

    // A request nobody approved (a wrong PIN never reaches approval) is no approval.
    const pending = await approvals.createRequest(tenantId, cashierId, { action: 'LATE_ENTRY', entity_type: 'ORDER' }, 'corr');
    await expect(
      orders.submitOrder(tenantId, d.id, { lateEntry: { reason: 'Forgot', approvalRequestId: pending.id } }, cashierId),
    ).rejects.toThrow('is not approved');
    await expect(approved('0000')).rejects.toThrow();

    expect((await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: d.id })).state).toBe('DRAFT');
  });

  it('keeps the reason, the guess at when it was served and the approver; stamps it now; prints nothing', async () => {
    const d = await draft();
    const servedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const before = Date.now();
    const sent = (await orders.submitOrder(
      tenantId,
      d.id,
      { lateEntry: { reason: 'Rushed lunch, forgot to ring it', servedAt, approvalRequestId: await approved() } },
      cashierId,
      'corr',
      'CASHIER',
    ))!;

    expect(sent).toMatchObject({
      state: 'CONFIRMED',
      is_late_entry: true,
      late_entry_reason: 'Rushed lunch, forgot to ring it',
      late_entry_approved_by: adminId,
    });
    expect(new Date(sent.late_served_at!).toISOString()).toBe(servedAt);
    // Entered now, like any order: its time is this moment, its day today's, and it has a number.
    expect(new Date(sent.submitted_at).getTime()).toBeGreaterThanOrEqual(before);
    expect(sent.business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent.call_number).toBeGreaterThan(0);

    // No kitchen chit and no receipt of its own accord.
    expect(await printJobs(d.id)).toHaveLength(0);

    const audit = await dataSource.query(`SELECT * FROM audit_event WHERE tenant_id = $1 AND entity_id = $2 AND action = 'ORDER_LATE_ENTRY'`, [tenantId, d.id]);
    expect(audit).toHaveLength(1);
    expect(audit[0].details).toMatchObject({ reason: 'Rushed lunch, forgot to ring it', approvedBy: adminId });
  });

  it('an ordinary order still prints its kitchen chit (the late-entry rule is not a general one)', async () => {
    const d = await draft();
    await orders.submitOrder(tenantId, d.id, {}, cashierId, 'corr', 'CASHIER');
    expect((await printJobs(d.id)).length).toBeGreaterThan(0);
  });

  it('the time served cannot be in the future', async () => {
    const d = await draft();
    const later = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    await expect(
      orders.submitOrder(tenantId, d.id, { lateEntry: { reason: 'Forgot', servedAt: later, approvalRequestId: await approved() } }, cashierId),
    ).rejects.toMatchObject({ response: { code: 'LATE_SERVED_IN_FUTURE' } });
  });

  it("one manager PIN rings up one order: its approval is not good for a second", async () => {
    const approvalRequestId = await approved();
    const first = await draft();
    await orders.submitOrder(tenantId, first.id, { lateEntry: { reason: 'Forgot', approvalRequestId } }, cashierId);
    const second = await draft();
    await expect(
      orders.submitOrder(tenantId, second.id, { lateEntry: { reason: 'Forgot again', approvalRequestId } }, cashierId),
    ).rejects.toMatchObject({ response: { code: 'APPROVAL_FOR_OTHER_ENTITY' } });
    expect((await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: second.id })).state).toBe('DRAFT');
  });

  it('is listed apart from the rest, by the orders list filter', async () => {
    const ids = (filter: 'yes' | 'no') =>
      orders
        .getOrders(tenantId, { branchId, limit: '100', filters: JSON.stringify({ items: [{ field: 'is_late_entry', operator: 'is', value: filter }] }) })
        .then((r) => r.data);
    const late = await ids('yes');
    const rest = await ids('no');
    expect(late.length).toBeGreaterThanOrEqual(2);
    expect(late.every((o: any) => o.is_late_entry)).toBe(true);
    expect(rest.length).toBeGreaterThanOrEqual(1);
    expect(rest.some((o: any) => o.is_late_entry)).toBe(false);
  });

  it('records a card already charged from its slip, and does not send it to the terminal', async () => {
    const d = await draft();
    const sent = (await orders.submitOrder(tenantId, d.id, { lateEntry: { reason: 'Forgot', approvalRequestId: await approved() } }, cashierId))!;
    const intent = await payments.createPaymentIntent(tenantId, { orderId: sent.id, methodId: cardMethodId, amount: sent.outstanding_total } as any, cashierId);

    // The slip's reference is what the charge is found by later: not optional.
    await expect(payments.processPayment(tenantId, intent.id, { offTerminal: true }, cashierId)).rejects.toMatchObject({
      response: { code: 'OFF_TERMINAL_REFERENCE_REQUIRED' },
    });
    expect((await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: sent.id })).paid_total).toBe('0.0000');

    const paid = await payments.processPayment(tenantId, intent.id, { offTerminal: true, externalReference: '778899' }, cashierId);
    expect(paid).toMatchObject({ status: 'SUCCEEDED', reference: '778899' });
    const attempts = await dataSource.query(`SELECT adapter, status, external_reference FROM payment_attempt WHERE payment_id = $1`, [intent.id]);
    expect(attempts).toEqual([{ adapter: 'MANUAL', status: 'SUCCEEDED', external_reference: '778899' }]);
    expect((await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: sent.id })).outstanding_total).toBe('0.0000');
    // Paying a late entry does not print its receipt by itself either.
    expect((await printJobs(sent.id)).filter((j) => j.document_type === 'CUSTOMER_RECEIPT')).toHaveLength(0);
  });
});
