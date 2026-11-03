import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { Payment } from '../src/entities/Payment.entity';
import { ReasonCode } from '../src/entities/ReasonCode.entity';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { Refund } from '../src/entities/Refund.entity';
import { ShiftService } from '../src/modules/cashier/shift.service';
import { OrderService } from '../src/modules/order/order.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { RefundService } from '../src/modules/refund/refund.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { deleteTenantData } from './utils/tenant-teardown';

// What the 2026-11-03 audit of the prototype against the PRDs changed: the Payments page's row,
// refund reasons from head office's codes, and the order types a branch offers.
describe('prototype aligned with the PRDs (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let shifts: ShiftService;
  let orders: OrderService;
  let payments: PaymentService;
  let refunds: RefundService;
  let settings: SettingsService;

  let tenantId: string;
  let branchId: string;
  let till: string;
  let burger: string;
  let cash: string;
  let cashierId: string;
  let refundCode: string;
  let cancelCode: string;

  const stamp = Date.now();
  const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    shifts = moduleRef.get(ShiftService);
    orders = moduleRef.get(OrderService);
    payments = moduleRef.get(PaymentService);
    refunds = moduleRef.get(RefundService);
    settings = moduleRef.get(SettingsService);

    tenantId = (await save(Tenant, { code: `ALIGN-${stamp}`, name: 'Align', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'ALN', name: 'Align', is_active: true, time_zone: 'Asia/Tehran' })).id;
    till = (await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'POS-1', name: 'Till one', terminal_type: 'CASHIER', is_active: true })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'ALN-MAINS', name: 'Mains', is_active: true })).id;
    burger = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'BURGER', name: 'Burger', base_price: '100000.0000', tax_rate: '0.0000', is_active: true })).id;
    cash = (await save(PaymentMethod, { tenant_id: tenantId, code: 'CASH', name: 'Cash', kind: 'CASH', currency_code: 'IRR', is_active: true })).id;
    cashierId = (await save(AdminUser, { tenant_id: tenantId, username: `align-${stamp}@x.test`, display_name: 'Sara', password_hash: '!', role: 'CASHIER', branch_id: branchId, is_active: true })).id;
    refundCode = (await save(ReasonCode, { tenant_id: tenantId, code: 'WRONG', name: 'Wrong item', type: 'REFUND', applies_to: ['REFUND'], is_active: true })).id;
    cancelCode = (await save(ReasonCode, { tenant_id: tenantId, code: 'CHANGED', name: 'Changed mind', type: 'VOID', applies_to: ['ORDER_CANCEL'], is_active: true })).id;
    await shifts.openShift(tenantId, { terminalId: till } as any, cashierId);
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const draft = (orderType = 'TAKEAWAY') =>
    orders.createDraft(tenantId, { branch_id: branchId, terminal_id: till, order_type: orderType, channel: 'POS', items: [{ product_id: burger, quantity: 1 }] } as any);
  const paidOrder = async () => {
    const created = await draft();
    await orders.submitOrder(tenantId, created.id, {} as any);
    const order = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: created.id });
    const intent = await payments.createPaymentIntent(tenantId, { orderId: order.id, methodId: cash, amount: order.grand_total, shiftId: undefined } as any, cashierId);
    await payments.processPayment(tenantId, intent.id, {} as any, cashierId);
    await orders.afterPaymentSucceeded(tenantId, order.id);
    return order;
  };

  it('lists who took a payment and where, and keeps an unanswered charge on top', async () => {
    const first = await paidOrder();
    const second = await paidOrder();
    const row = (await payments.listPayments(tenantId, { branchId })).data.find((p: any) => p.order_id === second.id);
    expect(row).toMatchObject({ register_name: 'Till one', cashier_name: 'Sara', needs_terminal_check: false });
    expect(row.call_number).not.toBeNull();

    // The older of the two payments is the one the terminal never answered.
    await dataSource.getRepository(Payment).update({ order_id: first.id }, { needs_terminal_check: true });
    const listed = (await payments.listPayments(tenantId, { branchId })).data;
    expect(listed[0].order_id).toBe(first.id);
    await dataSource.getRepository(Payment).update({ order_id: first.id }, { needs_terminal_check: false });
  });

  it('takes a refund reason from the refund codes only, and records its name', async () => {
    const order = await paidOrder();
    await dataSource.getRepository(OrderHeader).update({ id: order.id }, { state: 'COMPLETED', status: 'COMPLETED', business_date: '2020-01-01' } as any);
    await expect(refunds.refundOrder(tenantId, order.id, { reasonCodeId: cancelCode } as any, { userId: cashierId })).rejects.toMatchObject({
      response: { code: 'REFUND_REASON_INVALID' },
    });
    await refunds.refundOrder(tenantId, order.id, { reasonCodeId: refundCode } as any, { userId: cashierId });
    expect(await dataSource.getRepository(Refund).findOneByOrFail({ order_id: order.id })).toMatchObject({ reason_text: 'Wrong item', reason_code_id: refundCode });
  });

  describe('order types a branch offers', () => {
    const headOffice = { role: 'ADMIN', branchId: null } as any;
    const manager = { role: 'MANAGER', branchId } as any;

    afterAll(async () => {
      await dataSource.getRepository(TenantSetting).delete({ tenant_id: tenantId, key: 'ORDER_WORKFLOW' });
    });

    it('offers all three until head office says otherwise', async () => {
      expect(await orders.offeredOrderTypes(tenantId, branchId)).toEqual(['DINE_IN', 'TAKEAWAY', 'DELIVERY']);
    });

    it('refuses a till order of a type head office turned off, and a change to it', async () => {
      await settings.updateSetting(tenantId, 'ORDER_WORKFLOW', { enableDineIn: false }, 'align', undefined, headOffice);
      expect(await orders.offeredOrderTypes(tenantId, branchId)).toEqual(['TAKEAWAY', 'DELIVERY']);

      const created = await draft('DINE_IN');
      await expect(orders.submitOrder(tenantId, created.id, {} as any)).rejects.toMatchObject({ response: { code: 'ORDER_TYPE_NOT_OFFERED' } });

      const takeaway = await draft('TAKEAWAY');
      await expect(orders.changeOrderType(tenantId, takeaway.id, { orderType: 'DINE_IN' } as any)).rejects.toMatchObject({
        response: { code: 'ORDER_TYPE_NOT_OFFERED' },
      });
    });

    it('keeps head office\'s choice when a manager saves the rest of the group', async () => {
      await settings.updateSetting(tenantId, 'ORDER_WORKFLOW', { enableDineIn: true, enableAggregators: false }, 'align-mgr', branchId, manager);
      expect(await orders.offeredOrderTypes(tenantId, branchId)).toEqual(['TAKEAWAY', 'DELIVERY']);
    });

    it('lets head office pick for one branch', async () => {
      await settings.updateSetting(tenantId, 'ORDER_WORKFLOW', { enableDelivery: false }, 'align-branch', branchId, headOffice);
      expect(await orders.offeredOrderTypes(tenantId, branchId)).toEqual(['TAKEAWAY']);
    });

    it('refuses turning all three off', async () => {
      await expect(
        settings.updateSetting(tenantId, 'ORDER_WORKFLOW', { enableDineIn: false, enableTakeaway: false, enableDelivery: false }, 'align-none', undefined, headOffice),
      ).rejects.toThrow(/at least one/);
    });
  });
});
