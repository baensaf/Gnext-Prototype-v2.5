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
import { CashierShift } from '../src/entities/CashierShift.entity';
import { BusinessDayClose } from '../src/entities/BusinessDayClose.entity';
import { AuditEvent } from '../src/entities/AuditEvent.entity';
import { ShiftService } from '../src/modules/cashier/shift.service';
import { BusinessDayService } from '../src/modules/cashier/business-day.service';
import { BusinessDayAutoCloseService } from '../src/modules/cashier/business-day-auto-close.service';
import { OrderService } from '../src/modules/order/order.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { assignCallNumber } from '../src/modules/order/call-number';
import { loadBusinessClock } from '../src/common/utils/business-clock';
import { deleteTenantData } from './utils/tenant-teardown';

// The overnight business day end to end: a Tehran shop and a Dubai shop on an 08:00–04:00 day,
// with the cutoff at 04:00 on each one's own clock. Only Date is faked, so the database and
// its drivers keep real timers.
describe('the overnight business day (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let shifts: ShiftService;
  let businessDays: BusinessDayService;
  let autoClose: BusinessDayAutoCloseService;
  let orders: OrderService;
  let payments: PaymentService;
  let settings: SettingsService;

  let tenantId: string;
  let tehranBranch: string;
  let dubaiBranch: string;
  let tehranTill: string;
  let dubaiTill: string;
  let burger: string;
  let cash: string;

  /** Sets the clock to a wall-clock time in Tehran (+03:30). */
  const tehranTime = (local: string) => jest.setSystemTime(new Date(`${local}+03:30`));

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    shifts = moduleRef.get(ShiftService);
    businessDays = moduleRef.get(BusinessDayService);
    autoClose = moduleRef.get(BusinessDayAutoCloseService);
    orders = moduleRef.get(OrderService);
    payments = moduleRef.get(PaymentService);
    settings = moduleRef.get(SettingsService);

    const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
    tenantId = (await save(Tenant, { code: `BDAY-${Date.now()}`, name: 'Overnight', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    tehranBranch = (await save(Branch, { tenant_id: tenantId, code: 'THR', name: 'Tehran', is_active: true, time_zone: 'Asia/Tehran' })).id;
    dubaiBranch = (await save(Branch, { tenant_id: tenantId, code: 'DXB', name: 'Dubai', is_active: true, time_zone: 'Asia/Dubai' })).id;
    // The days closed automatically start at a branch's creation; the scenario runs in October
    // 2026 on a fake clock, so the branches must predate it whatever today's real date is.
    await dataSource.getRepository(Branch).update({ tenant_id: tenantId }, { created_at: new Date('2026-10-01T00:00:00Z') } as any);
    tehranTill = (await save(Terminal, { tenant_id: tenantId, branch_id: tehranBranch, code: 'THR-1', name: 'Till 1', terminal_type: 'CASHIER', is_active: true })).id;
    dubaiTill = (await save(Terminal, { tenant_id: tenantId, branch_id: dubaiBranch, code: 'DXB-1', name: 'Till 1', terminal_type: 'CASHIER', is_active: true })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'BDAY-MAINS', name: 'Mains', is_active: true })).id;
    burger = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'BURGER', name: 'Burger', base_price: '100000.0000', tax_rate: '0.0000', is_active: true })).id;
    cash = (await save(PaymentMethod, { tenant_id: tenantId, code: 'CASH', name: 'Cash', kind: 'CASH', currency_code: 'IRR', is_active: true })).id;
    // Only Date: Postgres and the pool keep their real timers.
    jest.useFakeTimers({
      doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    });
    // Head office's rule, as the migration writes it for every chain. Written before every date
    // the tests use, so the real calendar never lands inside them.
    tehranTime('2026-09-01T12:00:00');
    await settings.updateSetting(tenantId, 'BUSINESS_DAY', { cutoff: '04:00' }, 'bday-setup');
  }, 60000);

  afterAll(async () => {
    jest.useRealTimers();
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const sell = async (terminalId: string, branchId: string, shiftId?: string) => {
    const draft = await orders.createDraft(tenantId, {
      branch_id: branchId,
      terminal_id: terminalId,
      shift_id: shiftId,
      order_type: 'TAKEAWAY',
      channel: 'POS',
      items: [{ product_id: burger, quantity: 1 }],
    } as any);
    await orders.submitOrder(tenantId, draft.id, {} as any);
    return (await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: draft.id }))!;
  };
  // As the payment route does: once paid, a takeaway goes to the kitchen and gets its call number (O-19).
  const payCash = async (order: OrderHeader) => {
    const intent = await payments.createPaymentIntent(tenantId, { orderId: order.id, methodId: cash, amount: order.grand_total } as any);
    const paid = await payments.processPayment(tenantId, intent.id, {} as any);
    await orders.afterPaymentSucceeded(tenantId, order.id);
    return paid;
  };
  const callNumberOf = async (order: OrderHeader) =>
    (await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: order.id })).call_number;
  const closeShift = async (shiftId: string) => {
    const statement: any = await shifts.getShiftStatement(tenantId, shiftId);
    return await shifts.closeShift(tenantId, shiftId, { actualCash: String(statement.expectedCash) } as any, undefined, 'bday-close');
  };

  let nightShift: CashierShift;

  it('opens a shift at 01:30 on the business day that began the evening before', async () => {
    tehranTime('2026-10-15T01:30:00');
    nightShift = (await shifts.openShift(tenantId, { terminalId: tehranTill } as any)) as CashierShift;
    expect(nightShift.business_date).toBe('2026-10-14');
  });

  it('dates a sale, its payment and its call number by the cutoff, whatever the calendar says', async () => {
    tehranTime('2026-10-15T01:45:00');
    const first = await sell(tehranTill, tehranBranch, nightShift.id);
    expect(first.business_date).toBe('2026-10-14');
    const paid: any = await payCash(first);
    expect(paid.business_date ?? paid.payment?.business_date).toBe('2026-10-14');

    tehranTime('2026-10-15T03:59:00');
    const last = await sell(tehranTill, tehranBranch, nightShift.id);
    expect(last.business_date).toBe('2026-10-14');
    await payCash(last);
    // Call numbers keep counting through midnight: one day, one sequence.
    expect(await callNumberOf(last)).toBe(((await callNumberOf(first)) ?? 0) + 1);
  });

  it('refuses a sale on the old shift from 04:00, and says why', async () => {
    tehranTime('2026-10-15T04:00:00');
    await expect(sell(tehranTill, tehranBranch, nightShift.id)).rejects.toMatchObject({
      response: { code: 'SHIFT_BUSINESS_DAY_ENDED' },
    });
    await expect(shifts.requireDrawer(tenantId, tehranBranch, tehranTill)).rejects.toMatchObject({
      response: { code: 'SHIFT_BUSINESS_DAY_ENDED' },
    });
    // Card and credit only note their shift: they note none rather than the ended one.
    expect(await shifts.resolveDrawer(tenantId, tehranBranch, tehranTill)).toBeNull();
  });

  it('still lets the old shift be counted and closed after the cutoff', async () => {
    tehranTime('2026-10-15T04:10:00');
    const closed: any = await closeShift(nightShift.id);
    expect(closed.state ?? closed.shift?.state).toBe('CLOSED');
  });

  it('opens the next shift on the new day without anyone closing the old one', async () => {
    tehranTime('2026-10-15T08:00:00');
    expect(await dataSource.getRepository(BusinessDayClose).count({ where: { tenant_id: tenantId, branch_id: tehranBranch } })).toBe(0);
    const morning = (await shifts.openShift(tenantId, { terminalId: tehranTill } as any)) as CashierShift;
    expect(morning.business_date).toBe('2026-10-15');

    const sale = await sell(tehranTill, tehranBranch, morning.id);
    expect(sale.business_date).toBe('2026-10-15');
    await payCash(sale);
    // A new business day starts its call numbers again.
    const firstOfNight = await dataSource.getRepository(OrderHeader).findOne({ where: { tenant_id: tenantId, business_date: '2026-10-14' }, order: { call_number: 'ASC' } });
    expect(await callNumberOf(sale)).toBe(firstOfNight!.call_number);
    await closeShift(morning.id);
  });

  it('refuses to open a shift on a day other than the current one', async () => {
    tehranTime('2026-10-15T09:00:00');
    await expect(shifts.openShift(tenantId, { terminalId: tehranTill, businessDate: '2026-10-14' } as any)).rejects.toMatchObject({
      response: { code: 'NOT_THE_BUSINESS_DAY' },
    });
  });

  it('turns each branch over at its own 04:00', async () => {
    const at = new Date('2026-10-16T00:15:00Z'); // 03:45 in Tehran, 04:15 in Dubai
    jest.setSystemTime(at);
    expect((await loadBusinessClock(dataSource.manager, tenantId, tehranBranch)).today()).toBe('2026-10-15');
    expect((await loadBusinessClock(dataSource.manager, tenantId, dubaiBranch)).today()).toBe('2026-10-16');

    const dubaiShift = (await shifts.openShift(tenantId, { terminalId: dubaiTill } as any)) as CashierShift;
    expect(dubaiShift.business_date).toBe('2026-10-16');
    const dubaiSale = await sell(dubaiTill, dubaiBranch, dubaiShift.id);
    expect(dubaiSale.business_date).toBe('2026-10-16');
    await payCash(dubaiSale);
    await closeShift(dubaiShift.id);
  });

  it('numbers calls per branch business day through midnight', async () => {
    const order = (placed: string) =>
      dataSource.getRepository(OrderHeader).save(
        dataSource.getRepository(OrderHeader).create({ tenant_id: tenantId, branch_id: dubaiBranch, channel: 'KIOSK', order_number: `BD-${placed}-${Math.random()}` }),
      );
    // In Dubai (+04:00): 23:30 and 01:30 are one night; 04:00 starts the next.
    jest.setSystemTime(new Date('2026-10-20T23:30:00+04:00'));
    const a = await assignCallNumber(dataSource.manager, await order('a'));
    jest.setSystemTime(new Date('2026-10-21T01:30:00+04:00'));
    const b = await assignCallNumber(dataSource.manager, await order('b'));
    jest.setSystemTime(new Date('2026-10-21T04:00:00+04:00'));
    const c = await assignCallNumber(dataSource.manager, await order('c'));
    expect([a, b, c]).toEqual([400, 401, 400]);
  });

  it('closes an ended day by itself once its shifts are counted, and waits while one is open', async () => {
    // A Tehran shift opened in the evening of the 16th and left running past the cutoff.
    tehranTime('2026-10-16T20:00:00');
    const evening = (await shifts.openShift(tenantId, { terminalId: tehranTill } as any)) as CashierShift;
    await payCash(await sell(tehranTill, tehranBranch, evening.id));

    tehranTime('2026-10-17T04:30:00');
    const waiting = await autoClose.processBranch(tenantId, tehranBranch, new Date());
    expect(waiting).toContainEqual(expect.objectContaining({ businessDate: '2026-10-16', outcome: 'WAITING_FOR_SHIFTS' }));
    // Days whose shifts were all counted closed on their own.
    expect(waiting).toContainEqual(expect.objectContaining({ businessDate: '2026-10-14', outcome: 'CLOSED' }));
    expect(waiting).toContainEqual(expect.objectContaining({ businessDate: '2026-10-15', outcome: 'CLOSED' }));

    await closeShift(evening.id);
    const after = await autoClose.processBranch(tenantId, tehranBranch, new Date());
    expect(after).toEqual([expect.objectContaining({ businessDate: '2026-10-16', outcome: 'CLOSED' })]);

    const close = await dataSource.getRepository(BusinessDayClose).findOneOrFail({ where: { tenant_id: tenantId, branch_id: tehranBranch, business_date: '2026-10-14' } });
    expect(close.totals).toMatchObject({ orderCount: 2 });

    // Nothing is closed twice.
    expect(await autoClose.processBranch(tenantId, tehranBranch, new Date())).toEqual([]);
    await expect(businessDays.closeBusinessDay(tenantId, tehranBranch, '2026-10-14')).rejects.toThrow(/already closed/);
  });

  it('keeps the cutoff chain-wide: a branch cannot set its own', async () => {
    await expect(settings.updateSetting(tenantId, 'BUSINESS_DAY', { cutoff: '06:00' }, 'bday-branch', dubaiBranch)).rejects.toThrow(
      /organization-wide/,
    );
  });

  it('applies a changed cutoff from the moment it is saved, without re-dating what is stored', async () => {
    tehranTime('2026-10-18T12:00:00');
    await settings.updateSetting(tenantId, 'BUSINESS_DAY', { cutoff: '05:00' }, 'bday-move');
    const clock = await loadBusinessClock(dataSource.manager, tenantId, tehranBranch);
    expect(clock.today()).toBe('2026-10-18');
    expect(clock.dateAt(new Date('2026-10-19T04:30:00+03:30'))).toBe('2026-10-18');
    expect(clock.dateAt(new Date('2026-10-19T05:00:00+03:30'))).toBe('2026-10-19');
    // The night shift opened under the 04:00 cutoff keeps the date it was given.
    const stored = await dataSource.getRepository(CashierShift).findOneByOrFail({ id: nightShift.id });
    expect(stored.business_date).toBe(nightShift.business_date);
  });
});
