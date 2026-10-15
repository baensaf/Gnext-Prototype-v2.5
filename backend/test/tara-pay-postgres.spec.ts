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
import { Terminal } from '../src/entities/Terminal.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { TaraPurchase, TaraSimPurchase } from '../src/entities/Tara.entity';
import { OrderService } from '../src/modules/order/order.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { RefundService } from '../src/modules/refund/refund.service';
import { TaraService } from '../src/modules/tara/tara.service';
import { TaraPayService } from '../src/modules/tara/tara-pay.service';
import { deleteTenantData } from './utils/tenant-teardown';

// Tara at the till, against the simulated Tara purchase API: setup, then trace → request → verify
// for each demo barcode, the sweep's inquiry after a lost answer, and same-day reversal.
describe('Tara payments (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: OrderService;
  let payments: PaymentService;
  let refunds: RefundService;
  let tara: TaraService;
  let taraPay: TaraPayService;
  let tenantId: string;
  let branchId: string;
  let otherBranchId: string;
  let cashierId: string;
  let productId: string;
  let drinksId: string;
  let taraMethodId: string;

  const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
  const calls = async (paymentId: string) => {
    const trace = (await dataSource.getRepository(TaraPurchase).findOneByOrFail({ payment_id: paymentId })).trace_number;
    const rows = await dataSource.query(
      `SELECT event_type, status FROM integration_log WHERE tenant_id = $1 AND provider = 'TARA'
         AND (response_payload->>'traceNumber' = $2 OR request_payload->'body'->>'traceNumber' = $2 OR request_payload->'body'->>'id' = $2 OR request_payload->>'path' LIKE '%' || $2)
       ORDER BY created_at`,
      [tenantId, trace],
    );
    return rows.map((r: any) => `${r.event_type}:${r.status}`);
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    orders = moduleRef.get(OrderService);
    payments = moduleRef.get(PaymentService);
    refunds = moduleRef.get(RefundService);
    tara = moduleRef.get(TaraService);
    taraPay = moduleRef.get(TaraPayService);

    const tag = Date.now();
    tenantId = (await save(Tenant, { code: `TARA-${tag}`, name: 'Tara', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'TR1', name: 'A', is_active: true, time_zone: 'Asia/Tehran' })).id;
    otherBranchId = (await save(Branch, { tenant_id: tenantId, code: 'TR2', name: 'B', is_active: true, time_zone: 'Asia/Tehran' })).id;
    for (const code of ['T1', 'T2']) {
      await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code, name: `Till ${code}`, terminal_type: 'CASHIER', is_active: true });
    }
    cashierId = (
      await save(AdminUser, {
        tenant_id: tenantId, username: `tara_cashier_${tag}`, password_hash: await argon2.hash('x'),
        display_name: 'Cashier', role: 'CASHIER', is_active: true,
      })
    ).id;
    const mainsId = (await save(Category, { tenant_id: tenantId, code: 'TR-MAINS', name: 'Mains', is_active: true })).id;
    drinksId = (await save(Category, { tenant_id: tenantId, code: 'TR-DRINKS', name: 'Drinks', is_active: true })).id;
    productId = (await save(Product, { tenant_id: tenantId, category_id: mainsId, code: 'TR-P', name: 'Burger', base_price: '1500000.0000', tax_rate: '0.0000', is_active: true })).id;
    await save(Product, { tenant_id: tenantId, category_id: drinksId, code: 'TR-D', name: 'Cola', base_price: '300000.0000', tax_rate: '0.0000', is_active: true });
  }, 120000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM tara_branch WHERE tenant_id = $1`, [tenantId]);
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const submitted = async () => {
    const d = (await orders.createDraft(tenantId, { branch_id: branchId, order_type: 'TAKEAWAY', items: [{ product_id: productId, quantity: '2' }] }, cashierId, 'corr'))!;
    return (await orders.submitOrder(tenantId, d.id, {}, cashierId))!;
  };
  const payTara = async (order: OrderHeader, barcode: string, amount = order.outstanding_total) => {
    const intent = await payments.createPaymentIntent(tenantId, { orderId: order.id, methodId: taraMethodId, amount } as any, cashierId);
    return await payments.processPayment(tenantId, intent.id, { taraBarcode: barcode }, cashierId);
  };
  const orderOf = (id: string) => dataSource.getRepository(OrderHeader).findOneByOrFail({ id });

  it('connects, turns the Tara method on, and gives each branch till a Tara terminal', async () => {
    const setup = await tara.connect(tenantId, { username: 'iranburger', password: 'secret' }, cashierId);
    expect(setup.connection).toMatchObject({ connected: true, username: 'iranburger' });
    expect(setup.connection!.groups.length).toBeGreaterThan(0);
    expect(setup.method).toMatchObject({ is_active: true });
    taraMethodId = setup.method!.id;

    await expect(tara.setBranchCode(tenantId, branchId, 'abc')).rejects.toMatchObject({ response: { code: 'TARA_BRANCH_CODE_FAILED' } });
    const after = await tara.setBranchCode(tenantId, branchId, '4417');
    const branch = after.branches.find((b) => b.branch_id === branchId)!;
    // Three terminals for two tills: each till gets one, the third waits for a till.
    expect(branch.terminals.map((t) => t.terminal_code)).toEqual(['441701', '441702', '441703']);
    expect(branch.terminals.filter((t) => t.register_id).length).toBe(2);

    // Drinks go under Tara's "beverages" group; everything else under the default.
    await tara.saveGroups(tenantId, { defaultGroupId: 102, categoryGroups: { [drinksId]: 103 } });
  });

  it('refuses Tara before an intent exists at a branch without a Tara code', async () => {
    const d = (await orders.createDraft(tenantId, { branch_id: otherBranchId, order_type: 'TAKEAWAY', items: [{ product_id: productId, quantity: '1' }] }, cashierId, 'corr'))!;
    const sent = (await orders.submitOrder(tenantId, d.id, {}, cashierId))!;
    await expect(
      payments.createPaymentIntent(tenantId, { orderId: sent.id, methodId: taraMethodId, amount: sent.outstanding_total } as any, cashierId),
    ).rejects.toMatchObject({ response: { code: 'TARA_NO_BRANCH_CODE' } });
  });

  it('traces, holds and verifies an approved customer, with the invoice Tara asks for', async () => {
    const order = await submitted();
    const paid = await payTara(order, '980000000001');
    expect(paid.status).toBe('SUCCEEDED');
    expect(paid.reference).toMatch(/^R\d{11}$/);
    expect((await orderOf(order.id)).outstanding_total).toBe('0.0000');
    expect(await calls(paid.id)).toEqual(['Trace:SUCCESS', 'PurchaseRequest:SUCCESS', 'VerifyPurchase:SUCCESS']);

    const sim = await dataSource.getRepository(TaraSimPurchase).findOneByOrFail({ reference_number: paid.reference });
    expect(sim.status).toBe('VERIFIED');
    expect(sim.invoice.invoiceData).toMatchObject({ totalPrice: 3000000, invoiceNumber: order.order_number, vat: 0 });
    expect(sim.invoice.invoiceData.items).toEqual([
      expect.objectContaining({ name: 'Burger', count: 2, unit: 5, fee: 1500000, group: '102', groupTitle: 'فست فود' }),
    ]);
  });

  it('takes Tara as one part of a split payment', async () => {
    const order = await submitted();
    const paid = await payTara(order, '980000000001', '1000000');
    expect(paid.status).toBe('SUCCEEDED');
    expect((await orderOf(order.id)).outstanding_total).toBe('2000000.0000');
  });

  it("fails a customer Tara will not let buy here, and one whose limit is too low", async () => {
    const notHere = await payTara(await submitted(), '980000000002');
    expect(notHere).toMatchObject({ status: 'FAILED', failure_code: 'TARA_DECLINED' });

    const low = await payTara(await submitted(), '980000000003');
    expect(low).toMatchObject({ status: 'FAILED', failure_code: 'TARA_DECLINED' });
    expect(await calls(low.id)).toEqual(['Trace:SUCCESS', 'PurchaseRequest:FAILED']);

    const noCode = await payTara(await submitted(), '');
    expect(noCode).toMatchObject({ status: 'FAILED', failure_code: 'TARA_BARCODE_REQUIRED' });
  });

  it('asks Tara with an inquiry after a lost purchase-request answer, and never sends the request twice', async () => {
    const order = await submitted();
    const waiting = await payTara(order, '980000000004');
    expect(waiting.status).toBe('PROCESSING');
    expect(await dataSource.getRepository(TaraPurchase).findOneByOrFail({ payment_id: waiting.id })).toMatchObject({ awaiting: 'REQUEST' });

    // Another tender waits while Tara may have the money on hold.
    await expect(
      payments.createPaymentIntent(tenantId, { orderId: order.id, methodId: taraMethodId, amount: '1000' } as any, cashierId),
    ).rejects.toMatchObject({ response: { code: 'ACTIVE_PAYMENT_INTENT' } });

    await taraPay.resolvePending(new Date(Date.now() + 10_000));
    const done = await payments.getPaymentById(tenantId, waiting.id);
    expect(done.status).toBe('SUCCEEDED');
    expect(await calls(waiting.id)).toEqual(['Trace:SUCCESS', 'PurchaseRequest:NO_REPLY', 'InquiryPurchase:SUCCESS', 'VerifyPurchase:SUCCESS']);
  });

  it('settles a sale whose verify answer was lost from the inquiry, without verifying again', async () => {
    const waiting = await payTara(await submitted(), '980000000005');
    expect(waiting.status).toBe('PROCESSING');
    await taraPay.resolvePending(new Date(Date.now() + 10_000));
    expect((await payments.getPaymentById(tenantId, waiting.id)).status).toBe('SUCCEEDED');
    expect(await calls(waiting.id)).toEqual(['Trace:SUCCESS', 'PurchaseRequest:SUCCESS', 'VerifyPurchase:NO_REPLY', 'InquiryPurchase:SUCCESS']);
  });

  it('refunds a same-day Tara sale through ReversePurchase', async () => {
    const order = await submitted();
    const paid = await payTara(order, '980000000001');
    await dataSource.getRepository(OrderHeader).update({ id: order.id }, { state: 'COMPLETED', status: 'COMPLETED' } as any);

    const [refund] = await refunds.refundOrder(tenantId, order.id, { reason: 'Wrong order' } as any, { userId: cashierId });
    expect(refund).toMatchObject({ method_kind: 'TARA', amount: '3000000.0000' });
    expect((await dataSource.getRepository(TaraSimPurchase).findOneByOrFail({ reference_number: paid.reference })).status).toBe('REVERSED');
    expect(await dataSource.getRepository(TaraPurchase).findOneByOrFail({ payment_id: paid.id })).toMatchObject({ step: 'REVERSED' });
  });

  it('does not reverse a Tara sale from an earlier business day', async () => {
    const order = await submitted();
    const paid = await payTara(order, '980000000001', '1000000');
    await dataSource.query(`UPDATE payment SET business_date = '2020-01-01' WHERE id = $1`, [paid.id]);
    await expect(payments.reversePayment(tenantId, paid.id, { reason: 'x' }, cashierId)).rejects.toMatchObject({
      response: { code: 'TARA_REVERSE_SAME_DAY' },
    });
  });

  it('stops offering Tara once disconnected', async () => {
    await tara.disconnect(tenantId);
    expect(await tara.tillStatus(tenantId, branchId)).toEqual({ available: false, reason: 'NOT_CONNECTED' });
    expect((await dataSource.getRepository(PaymentMethod).findOneByOrFail({ id: taraMethodId })).is_active).toBe(false);
  });
});
