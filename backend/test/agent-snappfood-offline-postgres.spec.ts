import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AgentSyncOrder } from '../src/entities/AgentSyncOrder.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Courier } from '../src/entities/Courier.entity';
import { CourierAttendance } from '../src/entities/CourierAttendance.entity';
import { Delivery } from '../src/entities/Delivery.entity';
import { DeliveryAssignment } from '../src/entities/DeliveryAssignment.entity';
import { KitchenTicket } from '../src/entities/KitchenTicket.entity';
import { OptionGroup } from '../src/entities/OptionGroup.entity';
import { OptionItem } from '../src/entities/OptionItem.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { PrintJob } from '../src/entities/PrintJob.entity';
import { Product } from '../src/entities/Product.entity';
import { ProductOptionGroup } from '../src/entities/ProductOptionGroup.entity';
import { Tenant } from '../src/entities/Tenant.entity';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { CashierShift } from '../src/entities/CashierShift.entity';
import { BusinessClock } from '../src/common/utils/business-day';
import { AgentEnrolmentService } from '../src/modules/agent-gateway/agent-enrolment.service';
import { AgentRegistryService } from '../src/modules/agent-gateway/agent-registry.service';
import { SimulationService } from '../src/modules/simulation/simulation.service';
import { deleteTenantData } from './utils/tenant-teardown';

// Snappfood orders taken on the till while the cloud was away (protocol §17): one order per
// code, whichever record arrives first, with Snappfood's lines and money booked.
describe('Snappfood orders taken offline (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let tenantId: string;
  let branchId: string;
  let deviceKey: string;
  let snapshot: any;
  const ids: Record<string, string> = {};
  const today = BusinessClock.fromConfig({}, 'Asia/Tehran').today();
  // The burger and the cola at Snappfood's markup: 15%, rounded up to 10,000 rials.
  const BURGER_ON_SNAPPFOOD = '2820000';
  const COLA_ON_SNAPPFOOD = '410000';

  const save = <T>(entity: any, data: Partial<T>) =>
    dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
  const upload = (orders: any[]) => request(app.getHttpServer()).post('/api/v1/agent/sync/orders').set('Authorization', `Bearer ${deviceKey}`).send({ orders });

  /** A Snappfood order as the till would upload it (§17.6), priced from the snapshot. */
  const tillOrder = (code: string, over: Partial<any> = {}, qty = 2, unit = BURGER_ON_SNAPPFOOD) => {
    const lineTotal = (Number(unit) + Number(COLA_ON_SNAPPFOOD)) * qty;
    const tax = Math.round(lineTotal * 0.1);
    return {
      id: randomUUID(),
      data_version: snapshot.data_version,
      state: 'OPEN',
      terminal_id: ids.till,
      shift_id: null,
      created_by: randomUUID(),
      channel: 'AGGREGATOR',
      order_type: 'AGGREGATOR',
      table_id: null,
      guest_count: null,
      delivery_zone_id: null,
      call_number: 501,
      business_date: today,
      placed_at: new Date(Date.now() - 20 * 60000).toISOString(),
      completed_at: null,
      cancelled_at: null,
      cancellation_note: null,
      notes: null,
      lines: [
        {
          id: randomUUID(),
          product_id: ids.burger,
          product_name: 'چیزبرگر',
          variant_id: null,
          variant_name: null,
          quantity: String(qty),
          unit_price: unit,
          options: [{ option_item_id: ids.cola, name: 'کوکا', group_name: 'نوشیدنی', price_delta: COLA_ON_SNAPPFOOD }],
          tax_rate: '0.1000',
          line_total: String(lineTotal),
          tax: String(tax),
          notes: null,
        },
      ],
      totals: { subtotal: String(lineTotal), delivery_fee: '0', discount_total: '0', tax_total: String(tax), grand_total: String(lineTotal + tax) },
      payments: [],
      prints: [{ printer_id: randomUUID(), kind: 'KITCHEN', document_type: 'KITCHEN_TICKET', status: 'PRINTED', at: new Date().toISOString() }],
      snappfood: {
        code,
        expedition: 'DELIVERY',
        payment: 'ONLINE',
        customer: { name: 'حمید بیانک', phone: '09121111111', address: 'تهران، ونک، پلاک ۲' },
        courier_id: ids.courier,
      },
      ...over,
    };
  };

  /** Snappfood's webhook for the same code, with its own quantity of burgers. */
  const snappfoodSends = (code: string, qty: number) =>
    moduleRef.get(SimulationService).generateSnappfoodOrder(tenantId, {
      code,
      event_id: `evt-${code}-${Date.now()}`,
      branch_id: branchId,
      phone: '+989121111111',
      price: 282000 * qty + 28200 * qty + 80000,
      products: [{ id: 1, title: 'چیزبرگر', product_id: ids.burger, quantity: qty, price: 282000, vat: 0.1, toppings: [] }],
    });

  const orderByCode = (code: string) => dataSource.getRepository(OrderHeader).find({ where: { tenant_id: tenantId, order_number: `SNP-${code}` } });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);

    tenantId = (await save(Tenant, { code: `SNAPPOFF-${Date.now()}`, name: 'Snappfood offline fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'SFO', name: 'Snappfood branch', is_active: true, time_zone: 'Asia/Tehran', branch_type: 'RESTAURANT' })).id;
    const category = await save(Category, { tenant_id: tenantId, code: 'BRG', name: 'برگر', sort_order: 1, is_active: true });
    ids.burger = (await save(Product, { tenant_id: tenantId, code: 'B01', name: 'چیزبرگر', category_id: category.id, base_price: '2450000.0000', tax_rate: '0.1000', is_active: true })).id;
    const drinks = await save(OptionGroup, { tenant_id: tenantId, code: 'DRK', name: 'نوشیدنی', min_selection: 0, max_selection: 1, is_required: false });
    ids.cola = (await save(OptionItem, { tenant_id: tenantId, option_group_id: drinks.id, code: 'COLA', name: 'کوکا', price_delta: '350000.0000', sort_order: 1 })).id;
    await save(ProductOptionGroup, { tenant_id: tenantId, product_id: ids.burger, option_group_id: drinks.id, sort_order: 1, excluded_item_ids: [] });
    await save(PaymentMethod, { tenant_id: tenantId, code: 'CASH', name: 'نقد', kind: 'CASH', is_active: true, sort_order: 1 });
    await save(PaymentMethod, { tenant_id: tenantId, code: 'ONLINE', name: 'آنلاین', kind: 'ONLINE', is_active: true, sort_order: 2 });
    await save(TenantSetting, { tenant_id: tenantId, branch_id: null, key: 'CHANNEL_PRICING', value: { SNAPPFOOD: { markup_percent: 15, round_to: 10000 } } } as any);
    ids.till = (await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'T1', name: 'صندوق ۱', terminal_type: 'CASHIER', is_active: true })).id;
    await save(CashierShift, { tenant_id: tenantId, branch_id: branchId, terminal_id: ids.till, user_id: randomUUID(), shift_number: 'S-1', state: 'OPEN', business_date: today });
    ids.courier = (await save(Courier, { tenant_id: tenantId, branch_id: branchId, code: 'C1', name: 'رضا کریمی', phone: '09120000000', is_active: true })).id;
    ids.idleCourier = (await save(Courier, { tenant_id: tenantId, branch_id: branchId, code: 'C2', name: 'علی موسوی', phone: '09123333333', is_active: true })).id;
    await save(CourierAttendance, { tenant_id: tenantId, courier_id: ids.courier, branch_id: branchId, date: today, status: 'CHECKED_IN', availability_status: 'AVAILABLE', checked_in_at: new Date() });

    const { code } = await moduleRef.get(AgentRegistryService).createEnrolmentCode(tenantId, branchId, {});
    deviceKey = (await moduleRef.get(AgentEnrolmentService).enrol({ code, machine: { hostname: 'SFO-PC' } }, { clientKey: 'test', wsUrl: '' })).device_key;
    snapshot = (await request(app.getHttpServer()).get('/api/v1/agent/data/snapshot').set('Authorization', `Bearer ${deviceKey}`).expect(200)).body;
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it("gives the till Snappfood's prices, the branch's couriers and the ONLINE call numbers", () => {
    expect(snapshot.snappfood.prices).toEqual([{ product_id: ids.burger, variant_id: null, price: BURGER_ON_SNAPPFOOD }]);
    expect(snapshot.snappfood.add_ons).toEqual([{ option_item_id: ids.cola, price_delta: COLA_ON_SNAPPFOOD }]);
    expect(snapshot.couriers).toEqual([
      { id: ids.courier, name: 'رضا کریمی', phone: '09120000000', checked_in: true },
      { id: ids.idleCourier, name: 'علی موسوی', phone: '09123333333', checked_in: false },
    ]);
    expect(snapshot.settings.call_numbers.ONLINE).toEqual({ start: 500, end: 599 });
    expect(snapshot.settings.call_number_issued_today).toMatchObject({ business_date: today, POS: 0, ONLINE: 0 });
    expect(snapshot.printing.documents).toHaveProperty('COURIER_SLIP', null);
  });

  it("books the till's order first, then folds Snappfood's record into it", async () => {
    const order = tillOrder('SF-T1');
    const res = await upload([order]).expect(200);
    expect(res.body.results).toEqual([{ id: order.id, result: 'ACCEPTED', order_number: 'SNP-SF-T1', flags: [] }]);

    const header = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: order.id });
    expect(header).toMatchObject({
      order_number: 'SNP-SF-T1',
      channel: 'AGGREGATOR',
      order_type: 'AGGREGATOR',
      state: 'CONFIRMED',
      shift_id: null,
      call_number: 501,
      aggregator_expedition: 'DELIVERY',
      aggregator_match: 'TILL_ONLY',
      source: 'AGENT_OFFLINE',
    });
    expect(header.accepted_at).toBeTruthy();
    expect(header.notes).toContain('حمید بیانک');
    // The branch already made it: nothing for the kitchen screens or the printers.
    expect(await dataSource.getRepository(KitchenTicket).count({ where: { order_id: order.id } })).toBe(0);
    expect(await dataSource.getRepository(PrintJob).count({ where: { entity_id: order.id } })).toBe(0);
    // On the delivery board, with the courier the till picked and the address it typed.
    const delivery = await dataSource.getRepository(Delivery).findOneByOrFail({ order_id: order.id });
    expect(delivery).toMatchObject({ state: 'ASSIGNED', courier_id: ids.courier });
    expect(delivery.address_snapshot).toMatchObject({ address_text: 'تهران، ونک، پلاک ۲', typed_on_till: true });
    expect(await dataSource.getRepository(DeliveryAssignment).count({ where: { order_id: order.id, courier_id: ids.courier, status: 'ASSIGNED' } })).toBe(1);
    // The day's Snappfood counter moves past the till's number.
    const [counter] = await dataSource.query(
      `SELECT "last_value" FROM "order_call_counter" WHERE "tenant_id" = $1 AND "branch_id" = $2 AND "channel_group" = 'ONLINE'`,
      [tenantId, branchId],
    );
    expect(Number(counter.last_value)).toBe(2);

    // Snappfood's record arrives with one burger, not two: Snappfood's lines and money stand.
    const result = await snappfoodSends('SF-T1', 1);
    expect(result.success).toBe(true);
    expect(await orderByCode('SF-T1')).toHaveLength(1);
    const matched = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: order.id });
    expect(matched).toMatchObject({ state: 'CONFIRMED', aggregator_match: 'MATCHED', call_number: 501 });
    expect(Number(matched.paid_total)).toBeGreaterThan(0);
    expect(Number(matched.outstanding_total)).toBe(0);
    const items = await dataSource.getRepository(OrderItem).find({ where: { order_id: order.id }, order: { line_number: 'ASC' } });
    expect(items.map((i) => [i.state, Number(i.quantity)])).toEqual([
      ['VOID', 2],
      ['ACTIVE', 1],
    ]);
    const row = await dataSource.getRepository(AgentSyncOrder).findOneByOrFail({ id: order.id });
    expect(row.flags).toEqual(['SNAPPFOOD_DIFFERS']);
  });

  it("joins the till's order to Snappfood's when Snappfood's came first", async () => {
    await snappfoodSends('SF-W1', 2);
    const [waiting] = await orderByCode('SF-W1');
    expect(waiting.state).toBe('PENDING_ACCEPTANCE');

    const order = tillOrder('SF-W1', { call_number: 502 });
    const res = await upload([order]).expect(200);
    expect(res.body.results).toEqual([{ id: order.id, result: 'ACCEPTED', order_number: 'SNP-SF-W1', flags: [] }]);

    const all = await orderByCode('SF-W1');
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(waiting.id);
    expect(all[0]).toMatchObject({ state: 'CONFIRMED', call_number: 502, aggregator_match: 'MATCHED' });
    expect(all[0].accepted_at).toBeTruthy();
    // Snappfood's lines stand, and no order was booked under the till's id.
    expect(await dataSource.getRepository(OrderItem).count({ where: { order_id: waiting.id, state: 'ACTIVE' } })).toBe(1);
    expect(await dataSource.getRepository(OrderHeader).count({ where: { id: order.id } })).toBe(0);
    expect(await dataSource.getRepository(KitchenTicket).count({ where: { order_id: waiting.id } })).toBe(0);
    const delivery = await dataSource.getRepository(Delivery).findOneByOrFail({ order_id: waiting.id });
    expect(delivery).toMatchObject({ state: 'ASSIGNED', courier_id: ids.courier });
  });

  it('flags an order the cloud had already accepted, which the kitchen may have made twice', async () => {
    await snappfoodSends('SF-A1', 2);
    const [waiting] = await orderByCode('SF-A1');
    await dataSource.getRepository(OrderHeader).update({ id: waiting.id }, { state: 'CONFIRMED', status: 'CONFIRMED', accepted_at: new Date() });

    const res = await upload([tillOrder('SF-A1', { call_number: 503 })]).expect(200);
    expect(res.body.results[0]).toMatchObject({ result: 'ACCEPTED', order_number: 'SNP-SF-A1', flags: ['SNAPPFOOD_ACCEPTED_TWICE'] });
  });

  it('holds a Snappfood order priced in store, or without its code or with payments', async () => {
    const inStore = tillOrder('SF-H1', {}, 2, '2450000');
    const noCode = tillOrder('SF-H2');
    noCode.snappfood = { ...noCode.snappfood, code: 'x' };
    const paid = tillOrder('SF-H3', {
      payments: [{ id: randomUUID(), method_id: randomUUID(), method_kind: 'CASH', amount: '100', status: 'APPROVED', card: null, at: new Date().toISOString() }],
    });
    const res = await upload([inStore, noCode, paid]).expect(200);
    expect(res.body.results.map((r: any) => [r.result, r.flags])).toEqual([
      ['HELD', ['PRICE_MISMATCH']],
      ['HELD', ['INVALID_ORDER']],
      ['HELD', ['INVALID_ORDER']],
    ]);
    expect(await orderByCode('SF-H1')).toHaveLength(0);
  });
});
