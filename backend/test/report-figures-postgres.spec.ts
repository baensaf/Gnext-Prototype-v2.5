import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ReportsService } from '../src/modules/reports/reports.service';
import { OrderService } from '../src/modules/order/order.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { Payment } from '../src/entities/Payment.entity';
import { Refund } from '../src/entities/Refund.entity';
import { ApprovalRequest } from '../src/entities/ApprovalRequest.entity';
import { ApprovalDecision } from '../src/entities/ApprovalDecision.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// Two reports the 2026-09-16 audit caught making figures up: payments-by-method hardcoded
// refunds to zero, and manual-discounts reported every discount as rung up by 'CASHIER-1'
// with approval 'NONE' — including one a manager had approved with their PIN.
describe('report figures come from the records (PostgreSQL)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let reports: ReportsService;
  let orders: OrderService;
  let tenantId: string;
  let branchId: string;
  let productId: string;
  let cashierId: string;
  let managerId: string;

  const noDummyUuid = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    reports = moduleRef.get(ReportsService);
    orders = moduleRef.get(OrderService);

    const save = <T>(entity: any, data: Partial<T>) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data as any)) as Promise<any>;
    tenantId = (await save<Tenant>(Tenant, { code: `RPTFIG-${Date.now()}`, name: 'Report figures fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save<Branch>(Branch, { tenant_id: tenantId, code: 'RPT', name: 'Report branch', time_zone: 'Asia/Tehran', is_active: true })).id;
    const user = (username: string, display_name: string, role: string) =>
      save<AdminUser>(AdminUser, { tenant_id: tenantId, username, display_name, role, password_hash: 'x', is_active: true, branch_id: branchId });
    cashierId = (await user(`cashier-${Date.now()}@fixture`, 'Fixture Cashier', 'CASHIER')).id;
    managerId = (await user(`manager-${Date.now()}@fixture`, 'Fixture Manager', 'MANAGER')).id;
    const category = await save<Category>(Category, { tenant_id: tenantId, code: 'RPT-CAT', name: 'Food', is_active: true });
    productId = (await save<Product>(Product, { tenant_id: tenantId, category_id: category.id, code: 'RPT-BURGER', name: 'Burger', base_price: '250000.0000', tax_rate: '0.0900' })).id;
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const draft = () =>
    orders.createDraft(tenantId, { branch_id: branchId, order_type: 'PICKUP', items: [{ product_id: productId, quantity: 1 }] } as any, cashierId);

  it('names the cashier and the approval behind each manual discount', async () => {
    const withinLimit = await draft();
    await orders.submitOrder(tenantId, withinLimit.id, { manualDiscount: { calculation_type: 'FIXED_AMOUNT', value: '20000' } } as any, cashierId);

    const escalated = await draft();
    const request = await dataSource.getRepository(ApprovalRequest).save(
      dataSource.getRepository(ApprovalRequest).create({
        tenant_id: tenantId,
        code: `APR-RPT-${Date.now()}`,
        action: 'DISCOUNT',
        entity_type: 'Order',
        entity_id: escalated.id,
        requester_user_id: cashierId,
        status: 'APPROVED',
        current_step: 1,
        total_steps: 1,
        expires_at: new Date(Date.now() + 10 * 60 * 1000),
      }),
    );
    await dataSource.getRepository(ApprovalDecision).save(
      dataSource.getRepository(ApprovalDecision).create({ tenant_id: tenantId, request_id: request.id, step_number: 1, approver_user_id: managerId, decision: 'APPROVED' }),
    );
    await orders.submitOrder(
      tenantId,
      escalated.id,
      { manualDiscount: { calculation_type: 'PERCENTAGE', value: '30' }, approvalRequestIds: [request.id] } as any,
      cashierId,
    );

    const { rows } = (await reports.queryReport(tenantId, 'manual-discounts', {})) as any;
    const byOrder = new Map(rows.map((r: any) => [r.order_id, r]));

    expect(byOrder.get(withinLimit.id)).toEqual(
      expect.objectContaining({ amount: '20000.00', cashier_id: cashierId, cashier_name: 'Fixture Cashier', approval_status: 'WITHIN_LIMIT', approved_by: null }),
    );
    expect(byOrder.get(escalated.id)).toEqual(
      expect.objectContaining({ amount: '75000.00', cashier_name: 'Fixture Cashier', approval_status: 'APPROVED', approved_by: 'Fixture Manager' }),
    );
    expect(rows.some((r: any) => r.cashier_id === 'CASHIER-1')).toBe(false);
  }, 60000);

  it('takes refunds off the method they were paid back through', async () => {
    const order = await orders.submitOrder(tenantId, (await draft()).id, {} as any, cashierId);
    const payments = dataSource.getRepository(Payment);
    await payments.save(
      payments.create({ tenant_id: tenantId, order_id: order.id, payment_number: `PAY-RPT-${Date.now()}`, method_id: noDummyUuid, method_kind: 'CARD_POS', amount: '272500.0000', status: 'SUCCEEDED' }),
    );
    const refunds = dataSource.getRepository(Refund);
    await refunds.save(
      refunds.create({ tenant_id: tenantId, order_id: order.id, refund_number: `REF-RPT-${Date.now()}`, method_id: noDummyUuid, method_kind: 'CARD_POS', amount: '72500.0000', status: 'SUCCEEDED' }),
    );
    // A refund that never went through does not count.
    await refunds.save(
      refunds.create({ tenant_id: tenantId, order_id: order.id, refund_number: `REF-RPT-P-${Date.now()}`, method_id: noDummyUuid, method_kind: 'CARD_POS', amount: '1000.0000', status: 'PENDING' }),
    );

    const result = (await reports.queryReport(tenantId, 'payments-by-method', {})) as any;
    const card = result.rows.find((r: any) => r.method_kind === 'CARD_POS');

    expect(card).toEqual(expect.objectContaining({ succeeded_amount: '272500.00', refunded_amount: '72500.00', net_amount: '200000.00' }));
    expect(result.summary_totals).toEqual(expect.objectContaining({ refunded: '72500.00', net: '200000.00' }));
  }, 60000);
});
