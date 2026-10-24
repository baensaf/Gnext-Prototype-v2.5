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
import { ShiftService } from '../src/modules/cashier/shift.service';
import { Terminal } from '../src/entities/Terminal.entity';
import { PaymentService } from '../src/modules/payment/payment.service';
import { deleteTenantData } from './utils/tenant-teardown';

// A card the customer already paid on another reader (a standalone terminal, or before the order
// was rung up) is recorded from its slip: the reference is required, the till's terminal is not asked.
describe('card charged on another reader (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: OrderService;
  let payments: PaymentService;
  let tenantId: string;
  let branchId: string;
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
    payments = moduleRef.get(PaymentService);

    const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
    const tag = Date.now();
    tenantId = (await save(Tenant, { code: `OFFT-${tag}`, name: 'Off-terminal card', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'OT1', name: 'A', is_active: true, time_zone: 'Asia/Tehran' })).id;
    cashierId = (
      await save(AdminUser, {
        tenant_id: tenantId, username: `ot_cashier_${tag}`, password_hash: await argon2.hash('x'),
        display_name: 'Cashier', role: 'CASHIER', is_active: true,
      })
    ).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'OT-MAINS', name: 'Mains', is_active: true })).id;
    productId = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'OT-P', name: 'Burger', base_price: '100000.0000', tax_rate: '0.0000', is_active: true })).id;
    cardMethodId = (await save(PaymentMethod, { tenant_id: tenantId, code: 'CARD', name: 'Card', kind: 'CARD_POS', is_active: true })).id;
    // Every payment at the till belongs to an open shift, card included (Payments PRD).
    const till = await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'OT-TILL', name: 'Till 1', terminal_type: 'CASHIER', is_active: true });
    await moduleRef.get(ShiftService).openShift(tenantId, { terminalId: till.id } as any);
  }, 120000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const draft = async () =>
    (await orders.createDraft(tenantId, { branch_id: branchId, order_type: 'TAKEAWAY', items: [{ product_id: productId, quantity: '1' }] }, cashierId, 'corr'))!;

  it('records a card already charged from its slip, and does not send it to the terminal', async () => {
    const d = await draft();
    const sent = (await orders.submitOrder(tenantId, d.id, {}, cashierId))!;
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
  });
});
