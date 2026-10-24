import { randomUUID } from 'crypto';
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
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { PrintJob } from '../src/entities/PrintJob.entity';
import { ShiftService } from '../src/modules/cashier/shift.service';
import { OrderService } from '../src/modules/order/order.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { RefundService } from '../src/modules/refund/refund.service';
import { deleteTenantData } from './utils/tenant-teardown';
import { deliveryFixture } from './utils/delivery-fixture';

// The till rules of 2026-10-24: a takeaway goes to the kitchen once it is paid (O-19) and goes
// back to the cart while nothing is paid (O-20); a counter order is not edited and never becomes a
// delivery (O-22, O-23); an order is cancelled on its own business day and refunded after it (O-21).
describe('Pay before the kitchen (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: OrderService;
  let payments: PaymentService;
  let refunds: RefundService;
  let tenantId: string;
  let branchId: string;
  let terminalId: string;
  let shiftId: string;
  let burger: string;
  let water: string;
  let cash: string;
  let delivery: Awaited<ReturnType<typeof deliveryFixture>>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    orders = moduleRef.get(OrderService);
    payments = moduleRef.get(PaymentService);
    refunds = moduleRef.get(RefundService);

    const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
    tenantId = (await save(Tenant, { code: `PAYKIT-${Date.now()}`, name: 'Pay before kitchen', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'PK1', name: 'Nasr', is_active: true, time_zone: 'Asia/Tehran' })).id;
    terminalId = (await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'PK-1', name: 'Till 1', terminal_type: 'CASHIER', is_active: true })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'PK-MAINS', name: 'Mains', is_active: true })).id;
    burger = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'BURGER', name: 'Burger', base_price: '100000.0000', tax_rate: '0.0000', is_active: true })).id;
    water = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'WATER', name: 'Free water', base_price: '0.0000', tax_rate: '0.0000', is_active: true })).id;
    cash = (await save(PaymentMethod, { tenant_id: tenantId, code: 'CASH', name: 'Cash', kind: 'CASH', currency_code: 'IRR', is_active: true })).id;
    shiftId = ((await moduleRef.get(ShiftService).openShift(tenantId, { terminalId } as any)) as any).id;
    delivery = await deliveryFixture(dataSource, tenantId, branchId);
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const send = async (fields: Record<string, unknown> = { order_type: 'TAKEAWAY' }) => {
    const draft = await orders.createDraft(tenantId, {
      branch_id: branchId,
      terminal_id: terminalId,
      shift_id: shiftId,
      channel: 'POS',
      items: [{ product_id: burger, quantity: 1 }],
      ...fields,
    } as any);
    return orders.submitOrder(tenantId, draft.id, {} as any);
  };
  const pay = async (orderId: string, amount: string) => {
    const intent = await payments.createPaymentIntent(tenantId, { orderId, methodId: cash, amount } as any);
    await payments.processPayment(tenantId, intent.id, {} as any);
    await orders.afterPaymentSucceeded(tenantId, orderId);
  };
  const reload = (id: string) => dataSource.getRepository(OrderHeader).findOneByOrFail({ id });
  const kitchenTickets = (id: string) =>
    dataSource.getRepository(PrintJob).count({ where: { tenant_id: tenantId, entity_id: id, document_type: 'KITCHEN_TICKET' } });

  it('keeps a takeaway out of the kitchen until it is paid, then sends and completes it', async () => {
    const sent = await send();
    expect(sent).toMatchObject({ state: 'SUBMITTED', call_number: null });
    expect(await kitchenTickets(sent!.id)).toBe(0);

    await pay(sent!.id, '100000.0000');
    const paid = await reload(sent!.id);
    expect(paid.state).toBe('COMPLETED');
    expect(paid.call_number).toEqual(expect.any(Number));
    expect(await kitchenTickets(sent!.id)).toBe(1);
  });

  it('sends a delivery to the kitchen at once, unpaid', async () => {
    const sent = await send({ ...delivery });
    expect(sent).toMatchObject({ state: 'CONFIRMED', call_number: expect.any(Number) });
    expect(await kitchenTickets(sent!.id)).toBe(1);
  });

  it('puts an unpaid takeaway back in the cart, and refuses once part of it is paid', async () => {
    const sent = await send();
    const back = await orders.returnToCart(tenantId, sent!.id);
    expect(back.state).toBe('DRAFT');

    const again = await orders.submitOrder(tenantId, sent!.id, {} as any);
    await pay(again!.id, '40000.0000');
    await expect(orders.returnToCart(tenantId, again!.id)).rejects.toMatchObject({ response: { code: 'CART_HAS_PAYMENT' } });
    expect((await reload(again!.id)).call_number).toBeNull();
  });

  it('does not edit a counter order, nor make it a delivery', async () => {
    const sent = await send({ order_type: 'DINE_IN' });
    await expect(
      orders.editOrder(tenantId, sent!.id, { changes: { add: [{ productId: burger, quantity: '1' }] } } as any),
    ).rejects.toMatchObject({ response: { code: 'COUNTER_ORDER_NOT_EDITED' } });
    await expect(orders.changeOrderType(tenantId, sent!.id, { orderType: 'DELIVERY', ...delivery } as any)).rejects.toMatchObject({
      response: { code: 'ORDER_TYPE_LOCKED' },
    });
  });

  // O-26: nothing to pay, so it is done as it is sent.
  it('sends and completes a counter order with nothing to pay', async () => {
    const sent = await send({ order_type: 'TAKEAWAY', items: [{ product_id: water, quantity: 1 }] });
    const done = await reload(sent!.id);
    expect(done.state).toBe('COMPLETED');
    expect(done.call_number).toEqual(expect.any(Number));
    expect(await kitchenTickets(sent!.id)).toBe(1);
  });

  // Y-16: what goes back depends on whether the card was charged.
  it('refuses to cancel while a card charge is unanswered', async () => {
    const sent = await send({ ...delivery });
    await dataSource.query(
      `INSERT INTO payment (id, tenant_id, order_id, payment_number, method_kind, amount, status, currency_code)
       VALUES ($1, $2, $3, $4, 'NETWORK_POS', '100000.0000', 'PROCESSING', 'IRR')`,
      [randomUUID(), tenantId, sent!.id, `PAY-${Date.now()}`],
    );
    await expect(orders.cancelOrder(tenantId, sent!.id, { reasonCodeId: randomUUID() } as any)).rejects.toMatchObject({
      response: { code: 'CHARGE_UNRESOLVED' },
    });
  });

  it('refunds only an order from an earlier business day, and cancels only one from today', async () => {
    const today = await send();
    await pay(today!.id, '100000.0000');
    await expect(refunds.refundOrder(tenantId, today!.id, { reason: 'Changed their mind' } as any)).rejects.toMatchObject({
      response: { code: 'CANCEL_INSTEAD' },
    });

    const earlier = await send();
    await pay(earlier!.id, '100000.0000');
    await dataSource.getRepository(OrderHeader).update({ id: earlier!.id }, { business_date: '2020-01-01' } as any);
    await expect(orders.cancelOrder(tenantId, earlier!.id, { reasonCodeId: randomUUID() } as any)).rejects.toMatchObject({
      response: { code: 'REFUND_INSTEAD' },
    });
    const [refund] = await refunds.refundOrder(tenantId, earlier!.id, { reason: 'Came back the next day' } as any);
    expect(refund).toMatchObject({ amount: '100000.0000' });
  });
});
