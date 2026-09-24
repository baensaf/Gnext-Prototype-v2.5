import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AgentSyncOrder } from '../src/entities/AgentSyncOrder.entity';
import { AuditEvent } from '../src/entities/AuditEvent.entity';
import { Branch } from '../src/entities/Branch.entity';
import { BusinessDayClose } from '../src/entities/BusinessDayClose.entity';
import { CashMovement } from '../src/entities/CashMovement.entity';
import { CashierShift } from '../src/entities/CashierShift.entity';
import { Category } from '../src/entities/Category.entity';
import { DailyStock } from '../src/entities/DailyStock.entity';
import { KitchenTicket } from '../src/entities/KitchenTicket.entity';
import { OptionGroup } from '../src/entities/OptionGroup.entity';
import { OptionItem } from '../src/entities/OptionItem.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { OrderItemOption } from '../src/entities/OrderItemOption.entity';
import { Payment } from '../src/entities/Payment.entity';
import { PaymentAttempt } from '../src/entities/PaymentAttempt.entity';
import { PaymentDevice } from '../src/entities/PaymentDevice.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { PrintJob } from '../src/entities/PrintJob.entity';
import { Product } from '../src/entities/Product.entity';
import { ProductOptionGroup } from '../src/entities/ProductOptionGroup.entity';
import { ProductVariant } from '../src/entities/ProductVariant.entity';
import { Tenant } from '../src/entities/Tenant.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { AgentEnrolmentService } from '../src/modules/agent-gateway/agent-enrolment.service';
import { AgentRegistryService } from '../src/modules/agent-gateway/agent-registry.service';
import { AgentPaymentsService } from '../src/modules/payment/agent-payments.service';
import { AgentSyncService, parseOrder } from '../src/modules/agent-data/agent-sync.service';
import { BusinessDateUtil } from '../src/common/utils/business-date.util';
import { BusinessClock } from '../src/common/utils/business-day';
import { AgentSyncAdminController } from '../src/modules/agent-data/agent-sync-admin.controller';
import { HEAD_OFFICE_ONLY_KEY } from '../src/common/decorators/roles.decorator';
import { deleteTenantData } from './utils/tenant-teardown';

// Orders a branch took offline, uploaded by its agent and booked by the cloud (protocol §12.4–§12.6).
describe('agent offline order upload (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let tenantId: string;
  let branchId: string;
  let deviceKey: string;
  let dataVersion: string;
  const ids: Record<string, string> = {};
  // The business day the fixture's orders were placed on (09:42 in Tehran), by the 04:00 cutoff.
  // Fixed rather than read off the clock: the orders carry a fixed placing time, and a date
  // taken from the day the suite runs would disagree with it on every other day.
  const today = BusinessClock.fromConfig({}, 'Asia/Tehran').dateAt('2026-09-24T06:12:40.000Z');

  const save = <T>(entity: any, data: Partial<T>) =>
    dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
  const upload = (orders: any[]) => request(app.getHttpServer()).post('/api/v1/agent/sync/orders').set('Authorization', `Bearer ${deviceKey}`).send({ orders });

  /** An order as the offline till would record it, with its arithmetic done right. */
  const offlineOrder = (over: Partial<any> = {}, lines?: any[]) => {
    const ls = lines ?? [
      { product: ids.burger, name: 'چیزبرگر', unit: '2450000', qty: 2, options: [{ option_item_id: ids.cola, name: 'کوکا', price_delta: '350000' }], rate: '0.1000' },
    ];
    const built = ls.map((l) => {
      const unit = Number(l.unit) + (l.options || []).reduce((s: number, o: any) => s + Number(o.price_delta), 0);
      const lineTotal = unit * l.qty;
      const tax = Math.round(lineTotal * Number(l.rate));
      return {
        id: randomUUID(),
        product_id: l.product,
        product_name: l.name,
        variant_id: l.variant ?? null,
        variant_name: l.variantName ?? null,
        quantity: String(l.qty),
        unit_price: l.unit,
        options: l.options || [],
        tax_rate: l.rate,
        line_total: String(lineTotal),
        tax: String(tax),
        notes: null,
      };
    });
    const subtotal = built.reduce((s, l) => s + Number(l.line_total), 0);
    const tax = built.reduce((s, l) => s + Number(l.tax), 0);
    const grand = subtotal + tax;
    const order: any = {
      id: randomUUID(),
      data_version: dataVersion,
      state: 'COMPLETED',
      terminal_id: ids.till,
      shift_id: ids.shift,
      created_by: ids.cashier,
      channel: 'POS',
      order_type: 'TAKEAWAY',
      table_id: null,
      guest_count: null,
      delivery_zone_id: null,
      call_number: 140,
      business_date: today,
      placed_at: '2026-09-24T06:12:40.000Z',
      completed_at: '2026-09-24T06:20:02.000Z',
      cancelled_at: null,
      cancellation_note: null,
      notes: null,
      lines: built,
      totals: { subtotal: String(subtotal), delivery_fee: '0', discount_total: '0', tax_total: String(tax), grand_total: String(grand) },
      payments: [{ id: randomUUID(), method_id: ids.cash, method_kind: 'CASH', amount: String(grand), status: 'APPROVED', card: null, at: '2026-09-24T06:19:50.000Z' }],
      prints: [],
      ...over,
    };
    return order;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);

    tenantId = (await save(Tenant, { code: `AGENTSYNC-${Date.now()}`, name: 'Agent sync fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'ASY', name: 'Offline branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    ids.cashier = randomUUID();
    ids.category = (await save(Category, { tenant_id: tenantId, code: 'BRG', name: 'برگر', sort_order: 1, is_active: true })).id;
    ids.burger = (await save(Product, { tenant_id: tenantId, code: 'B01', name: 'چیزبرگر', category_id: ids.category, base_price: '2450000.0000', tax_rate: '0.1000', is_active: true })).id;
    ids.fries = (await save(Product, { tenant_id: tenantId, code: 'F01', name: 'سیب‌زمینی', category_id: ids.category, base_price: '0.0000', tax_rate: '0.0000', is_active: true })).id;
    ids.large = (await save(ProductVariant, { tenant_id: tenantId, product_id: ids.fries, code: 'L', name: 'بزرگ', base_price: '1500000.0000', sort_order: 1, is_active: true })).id;
    ids.drinks = (await save(OptionGroup, { tenant_id: tenantId, code: 'DRK', name: 'نوشیدنی', min_selection: 0, max_selection: 1, is_required: false })).id;
    ids.cola = (await save(OptionItem, { tenant_id: tenantId, option_group_id: ids.drinks, code: 'COLA', name: 'کوکا', price_delta: '350000.0000', sort_order: 1 })).id;
    await save(ProductOptionGroup, { tenant_id: tenantId, product_id: ids.burger, option_group_id: ids.drinks, sort_order: 1, excluded_item_ids: [] });
    ids.cash = (await save(PaymentMethod, { tenant_id: tenantId, code: 'CASH', name: 'نقد', kind: 'CASH', is_active: true, sort_order: 1 })).id;
    ids.card = (await save(PaymentMethod, { tenant_id: tenantId, code: 'CARD', name: 'کارت', kind: 'NETWORK_POS', is_active: true, sort_order: 2 })).id;
    ids.device = (await save(PaymentDevice, { tenant_id: tenantId, branch_id: branchId, code: 'POS1', name: 'Saman', is_active: true } as any)).id;
    ids.till = (await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'T1', name: 'صندوق ۱', terminal_type: 'CASHIER', is_active: true })).id;
    ids.shift = (await save(CashierShift, { tenant_id: tenantId, branch_id: branchId, terminal_id: ids.till, user_id: ids.cashier, shift_number: 'S-0001', state: 'OPEN', business_date: today })).id;

    const { code } = await moduleRef.get(AgentRegistryService).createEnrolmentCode(tenantId, branchId, {});
    const enrolled = await moduleRef.get(AgentEnrolmentService).enrol({ code, machine: { hostname: 'ASY-PC' } }, { clientKey: 'test', wsUrl: '' });
    deviceKey = enrolled.device_key;

    // The till sells from the snapshot its agent fetched.
    const snap = await request(app.getHttpServer()).get('/api/v1/agent/data/snapshot').set('Authorization', `Bearer ${deviceKey}`).expect(200);
    dataVersion = snap.body.data_version;
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('refuses a caller without a device key, and a batch that is not one', async () => {
    await request(app.getHttpServer()).post('/api/v1/agent/sync/orders').send({ orders: [] }).expect(401);
    const res = await upload([{ state: 'COMPLETED' }]).expect(400);
    expect(res.body.code).toBe('INVALID_PAYLOAD');
    await upload(Array.from({ length: 51 }, () => ({ id: randomUUID() }))).expect(400);
  });

  it('books a completed cash order as the till recorded it', async () => {
    const order = offlineOrder();
    const res = await upload([order]).expect(200);
    expect(res.body.results).toEqual([{ id: order.id, result: 'ACCEPTED', order_number: expect.stringMatching(/^ORD-/), flags: [] }]);

    const header = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: order.id });
    expect(header).toMatchObject({
      source: 'AGENT_OFFLINE',
      state: 'COMPLETED',
      channel: 'POS',
      order_type: 'TAKEAWAY',
      branch_id: branchId,
      shift_id: ids.shift,
      terminal_id: ids.till,
      call_number: 140,
      business_date: today,
      created_by: ids.cashier,
    });
    expect(new Date(header.placed_at).toISOString()).toBe('2026-09-24T06:12:40.000Z');
    expect(Number(header.grand_total)).toBe(6160000);
    expect(Number(header.tax_total)).toBe(560000);
    expect(Number(header.paid_total)).toBe(6160000);
    expect(Number(header.outstanding_total)).toBe(0);

    const items = await dataSource.getRepository(OrderItem).find({ where: { order_id: order.id } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ product_id: ids.burger, product_name: 'چیزبرگر', state: 'ACTIVE' });
    expect(Number(items[0].quantity)).toBe(2);
    expect(Number(items[0].line_total)).toBe(5600000);
    const options = await dataSource.getRepository(OrderItemOption).find({ where: { order_item_id: items[0].id } });
    expect(options).toEqual([expect.objectContaining({ option_item_id: ids.cola, option_item_name: 'کوکا' })]);

    const payment = await dataSource.getRepository(Payment).findOneByOrFail({ id: order.payments[0].id });
    expect(payment).toMatchObject({ status: 'SUCCEEDED', method_kind: 'CASH', shift_id: ids.shift, business_date: today });
    expect(new Date(payment.posted_at).toISOString()).toBe('2026-09-24T06:19:50.000Z');
    const cash = await dataSource.getRepository(CashMovement).find({ where: { shift_id: ids.shift, payment_id: payment.id } });
    expect(cash).toEqual([expect.objectContaining({ type: 'CASH_PAYMENT' })]);
    expect(Number(cash[0].amount)).toBe(6160000);

    // The branch already made it: nothing goes to the kitchen or the printers again.
    expect(await dataSource.getRepository(KitchenTicket).count({ where: { order_id: order.id } as any })).toBe(0);
    expect(await dataSource.getRepository(PrintJob).count({ where: { entity_id: order.id } })).toBe(0);

    const counter = await dataSource.query(
      `SELECT last_value FROM order_call_counter WHERE tenant_id = $1 AND branch_id = $2 AND business_date = $3 AND channel_group = 'POS'`,
      [tenantId, branchId, today],
    );
    expect(Number(counter[0].last_value)).toBe(41);
    expect(await dataSource.getRepository(AuditEvent).count({ where: { tenant_id: tenantId, action: 'ORDER_OFFLINE_SYNCED', entity_id: order.id } })).toBe(1);
  });

  // The agent's till (1.6.0) sends §13.12's additions: they are taken without complaint.
  it("accepts an order in the offline till's own shape, with its additions", async () => {
    const order = offlineOrder({ call_number: 139 }, [
      {
        product: ids.burger, name: 'چیزبرگر', unit: '2450000', qty: 1, rate: '0.1000',
        options: [{ option_item_id: ids.cola, name: 'کوکا', group_name: 'نوشیدنی', price_delta: '350000' }],
      },
    ]);
    order.voided_lines = [
      { product_name: 'سیب‌زمینی', variant_name: 'بزرگ', quantity: '1', line_total: '1500000', voided_by: ids.cashier, approved_by: null, at: '2026-09-24T06:15:00.000Z' },
    ];
    order.cancelled_by = null;
    order.approved_by = null;
    delete order.payments[0].card; // a cash payment carries no card block at all
    const res = await upload([order]).expect(200);
    expect(res.body.results).toEqual([{ id: order.id, result: 'ACCEPTED', order_number: expect.stringMatching(/^ORD-/), flags: [] }]);
  });

  it('answers DUPLICATE for a resend, and holds a different order under the same id', async () => {
    const order = offlineOrder({ call_number: 141 });
    const first = (await upload([order]).expect(200)).body.results[0];
    const again = (await upload([order]).expect(200)).body.results[0];
    expect(again).toEqual({ id: order.id, result: 'DUPLICATE', order_number: first.order_number, flags: [] });

    const other = { ...order, notes: 'a different order' };
    expect((await upload([other]).expect(200)).body.results[0]).toEqual({ id: order.id, result: 'HELD', order_number: null, flags: ['ID_REUSED'] });
    expect(await dataSource.getRepository(OrderHeader).count({ where: { id: order.id } })).toBe(1);
    expect((await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: order.id })).notes).toBeNull();
  });

  it('leaves an unconfirmed card charge for a manager to check, as any other', async () => {
    const order = offlineOrder({ call_number: 142 });
    order.payments = [
      {
        id: randomUUID(),
        method_id: ids.card,
        method_kind: 'NETWORK_POS',
        amount: order.totals.grand_total,
        status: 'UNKNOWN',
        card: { terminal_id: ids.device },
        at: '2026-09-24T06:19:50.000Z',
      },
    ];
    expect((await upload([order]).expect(200)).body.results[0].result).toBe('ACCEPTED');

    const payment = await dataSource.getRepository(Payment).findOneByOrFail({ id: order.payments[0].id });
    expect(payment).toMatchObject({ status: 'PROCESSING', needs_terminal_check: true, device_id: ids.device });
    expect(await dataSource.getRepository(PaymentAttempt).findOneByOrFail({ payment_id: payment.id })).toMatchObject({ adapter: 'AGENT', status: 'UNKNOWN' });
    expect(Number((await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: order.id })).outstanding_total)).toBe(Number(order.totals.grand_total));

    await moduleRef.get(AgentPaymentsService).resolveByHand(tenantId, payment.id, { outcome: 'APPROVED', rrn: '123456789012', reason: 'terminal report' }, {});
    expect((await dataSource.getRepository(Payment).findOneByOrFail({ id: payment.id })).status).toBe('SUCCEEDED');
    expect(Number((await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: order.id })).outstanding_total)).toBe(0);
  });

  it('books a card charge the terminal approved, with its reference', async () => {
    const order = offlineOrder({ call_number: 143 });
    order.payments = [
      {
        id: randomUUID(),
        method_id: ids.card,
        method_kind: 'NETWORK_POS',
        amount: order.totals.grand_total,
        status: 'APPROVED',
        card: { terminal_id: ids.device, rrn: '998877665544', card_pan_masked: '603799******1234', response_code: '00' },
        at: '2026-09-24T06:19:50.000Z',
      },
    ];
    expect((await upload([order]).expect(200)).body.results[0].result).toBe('ACCEPTED');
    const payment = await dataSource.getRepository(Payment).findOneByOrFail({ id: order.payments[0].id });
    expect(payment).toMatchObject({ status: 'SUCCEEDED', reference: '998877665544' });
    // A card is not cash in the drawer.
    expect(await dataSource.getRepository(CashMovement).count({ where: { payment_id: payment.id } })).toBe(0);
  });

  it('holds an order whose numbers do not add up, and one priced off its snapshot', async () => {
    const wrong = offlineOrder({ call_number: 150 });
    wrong.lines[0].line_total = '5600001';
    const offSnapshot = offlineOrder({ call_number: 151 }, [{ product: ids.burger, name: 'چیزبرگر', unit: '2000000', qty: 1, rate: '0.1000' }]);

    const res = (await upload([wrong, offSnapshot]).expect(200)).body.results;
    expect(res).toEqual([
      { id: wrong.id, result: 'HELD', order_number: null, flags: ['TOTAL_MISMATCH'] },
      { id: offSnapshot.id, result: 'HELD', order_number: null, flags: ['PRICE_MISMATCH'] },
    ]);
    expect(await dataSource.getRepository(OrderHeader).count({ where: [{ id: wrong.id }, { id: offSnapshot.id }] })).toBe(0);
    const held = await dataSource.getRepository(AgentSyncOrder).findOneByOrFail({ id: wrong.id });
    expect(held).toMatchObject({ status: 'HELD', flags: ['TOTAL_MISMATCH'] });
    expect(held.payload.lines[0].line_total).toBe('5600001');
  });

  it('books at the charged price and flags what changed since: price, snapshot, item, shift, day, stock', async () => {
    // Head office raised the burger after the till's snapshot.
    await dataSource.getRepository(Product).update({ id: ids.burger }, { base_price: '2600000.0000' });
    const priceChanged = offlineOrder({ call_number: 160 });

    const unknownSnapshot = offlineOrder({ call_number: 161, data_version: 'not-a-version-we-served' });

    const closedShift = await save(CashierShift, {
      tenant_id: tenantId, branch_id: branchId, terminal_id: ids.till, user_id: ids.cashier, shift_number: 'S-0000', state: 'CLOSED', business_date: '2026-09-20',
    });
    const lateShift = offlineOrder({
      call_number: 162,
      shift_id: closedShift.id,
      business_date: '2026-09-20',
      placed_at: '2026-09-20T10:00:00.000Z',
      completed_at: '2026-09-20T10:05:00.000Z',
    });
    await save(BusinessDayClose, { tenant_id: tenantId, branch_id: branchId, business_date: '2026-09-20', status: 'CLOSED' } as any);

    await save(DailyStock, { tenant_id: tenantId, branch_id: branchId, product_id: ids.fries, variant_id: ids.large, business_date: today, quantity: 1 });
    const oversold = offlineOrder({ call_number: 163 }, [{ product: ids.fries, name: 'سیب‌زمینی', variant: ids.large, variantName: 'بزرگ', unit: '1500000', qty: 2, rate: '0.0000' }]);

    const res = (await upload([priceChanged, unknownSnapshot, lateShift, oversold]).expect(200)).body.results;
    expect(res.map((r: any) => [r.result, [...r.flags].sort()])).toEqual([
      ['ACCEPTED', ['PRICE_CHANGED']],
      ['ACCEPTED', ['PRICE_CHANGED', 'SNAPSHOT_UNKNOWN']],
      ['ACCEPTED', ['DAY_CLOSED', 'PRICE_CHANGED', 'SHIFT_CLOSED']],
      ['ACCEPTED', ['STOCK_NEGATIVE']],
    ]);
    // Booked at what the guest was charged, not today's price.
    const item = await dataSource.getRepository(OrderItem).findOneByOrFail({ order_id: priceChanged.id });
    expect(Number(item.unit_price)).toBe(2450000);
    // The closed shift's drawer now holds that cash, for a manager to look at.
    expect(await dataSource.getRepository(CashMovement).count({ where: { shift_id: closedShift.id } })).toBe(1);
    await dataSource.getRepository(Product).update({ id: ids.burger }, { base_price: '2450000.0000' });

    await dataSource.getRepository(Product).update({ id: ids.fries }, { is_active: false });
    const removed = offlineOrder({ call_number: 164 }, [{ product: ids.fries, name: 'سیب‌زمینی', variant: ids.large, variantName: 'بزرگ', unit: '1500000', qty: 1, rate: '0.0000' }]);
    expect((await upload([removed]).expect(200)).body.results[0]).toMatchObject({ result: 'ACCEPTED', flags: expect.arrayContaining(['ITEM_REMOVED']) });
    await dataSource.getRepository(Product).update({ id: ids.fries }, { is_active: true });
  });

  it("flags an order the till dated other than by the branch's 04:00 cutoff, and keeps the till's date", async () => {
    // 01:30 in Tehran on the 25th is still the 24th's business day.
    const night = { placed_at: '2026-09-24T22:00:00.000Z', completed_at: '2026-09-24T22:05:00.000Z' };
    const byCutoff = offlineOrder({ call_number: 165, business_date: '2026-09-24', ...night });
    const byCalendar = offlineOrder({ call_number: 166, business_date: '2026-09-25', ...night });
    const res = (await upload([byCutoff, byCalendar]).expect(200)).body.results;
    expect(res[0]).toMatchObject({ result: 'ACCEPTED' });
    expect(res[0].flags).not.toContain('BUSINESS_DATE_DIFFERS');
    expect(res[1]).toMatchObject({ result: 'ACCEPTED', flags: expect.arrayContaining(['BUSINESS_DATE_DIFFERS']) });
    expect((await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: byCalendar.id })).business_date).toBe('2026-09-25');
  });

  it('books a cancelled order without payments, and an open one for the POS to finish', async () => {
    const cancelled = offlineOrder({ call_number: 170, state: 'CANCELLED', completed_at: null, cancelled_at: '2026-09-24T06:14:00.000Z', cancellation_note: 'guest left', payments: [] });
    const open = offlineOrder({ call_number: 171, state: 'OPEN', order_type: 'DINE_IN', completed_at: null, guest_count: 3, payments: [] });
    const res = (await upload([cancelled, open]).expect(200)).body.results;
    expect(res.map((r: any) => r.result)).toEqual(['ACCEPTED', 'ACCEPTED']);

    expect(await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: cancelled.id })).toMatchObject({ state: 'CANCELLED' });
    const openRow = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: open.id });
    expect(openRow).toMatchObject({ state: 'CONFIRMED', order_type: 'DINE_IN', guest_count: 3 });
    expect(Number(openRow.outstanding_total)).toBe(Number(open.totals.grand_total));
  });

  it('holds an order it cannot place, and books it on retry once the cause is fixed', async () => {
    const unknownShift = offlineOrder({ call_number: 180, shift_id: randomUUID() });
    expect((await upload([unknownShift]).expect(200)).body.results[0]).toMatchObject({ result: 'HELD', flags: ['SHIFT_UNKNOWN'] });

    const methodId = randomUUID();
    const order = offlineOrder({ call_number: 181 });
    order.payments[0].method_id = methodId;
    expect((await upload([order]).expect(200)).body.results[0]).toMatchObject({ result: 'HELD', flags: ['INVALID_ORDER'] });
    // A resend of a held order stays held until head office retries it.
    expect((await upload([order]).expect(200)).body.results[0]).toMatchObject({ result: 'HELD', flags: ['INVALID_ORDER'] });

    await save(PaymentMethod, { id: methodId, tenant_id: tenantId, code: 'CASH2', name: 'نقد ۲', kind: 'CASH', is_active: true, sort_order: 3 } as any);
    const retried = await moduleRef.get(AgentSyncService).retry(tenantId, order.id);
    expect(retried).toMatchObject({ result: 'ACCEPTED', flags: [] });
    expect((await upload([order]).expect(200)).body.results[0]).toMatchObject({ result: 'DUPLICATE', order_number: retried.order_number });
  });

  it("shows head office what needs a look, and clears it as it is reviewed or retried", async () => {
    expect(Reflect.getMetadata(HEAD_OFFICE_ONLY_KEY, AgentSyncAdminController)).toBe(true);
    const sync = moduleRef.get(AgentSyncService);

    const attention = await sync.list(tenantId);
    // Held orders, and booked ones with flags nobody has reviewed; clean ones are left out.
    expect(attention.every((r) => r.status === 'HELD' || r.flags.length > 0)).toBe(true);
    const flagged = attention.find((r) => r.status === 'ACCEPTED' && r.call_number === 163)!;
    expect(flagged).toMatchObject({ branch_name: 'Offline branch', order_state: 'COMPLETED', call_number: 163, order_number: expect.stringMatching(/^ORD-/) });
    expect(flagged.grand_total).toBe('3000000');
    const held = attention.find((r) => r.status === 'HELD' && r.flags.includes('TOTAL_MISMATCH'))!;
    expect(held.error).toContain('Line 1');

    const all = await sync.list(tenantId, { view: 'all' });
    expect(all.length).toBeGreaterThan(attention.length);
    expect(all.some((r) => r.status === 'ACCEPTED' && r.flags.length === 0)).toBe(true);

    await sync.markReviewed(tenantId, flagged.id, ids.cashier);
    expect((await sync.list(tenantId)).some((r) => r.id === flagged.id)).toBe(false);
    await expect(sync.markReviewed(tenantId, held.id)).rejects.toThrow(/retried, not reviewed/);

    // Retrying something still wrong keeps it held, and says why.
    expect(await sync.retry(tenantId, held.id, ids.cashier)).toMatchObject({ result: 'HELD', flags: ['TOTAL_MISMATCH'] });
    expect(await dataSource.getRepository(AuditEvent).count({ where: { tenant_id: tenantId, action: 'AGENT_SYNC_ORDER_RETRIED', entity_id: held.id } })).toBe(1);
  });

  it('checks the shape of an order before anything else', () => {
    const ok = offlineOrder();
    expect(() => parseOrder(ok)).not.toThrow();
    expect(() => parseOrder({ ...ok, state: 'PAID' })).toThrow(/state/);
    expect(() => parseOrder({ ...ok, lines: [] })).toThrow(/lines/);
    expect(() => parseOrder({ ...ok, totals: { ...ok.totals, discount_total: '1000' } })).toThrow(/discounts/);
    expect(() => parseOrder({ ...ok, lines: [{ ...ok.lines[0], quantity: '1.5' }] })).toThrow(/quantity/);
    expect(() => parseOrder({ ...ok, payments: [{ ...ok.payments[0], status: 'UNKNOWN' }] })).toThrow(/card/);
  });
});
