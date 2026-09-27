import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Customer } from '../src/entities/Customer.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { OrderService } from '../src/modules/order/order.service';
import { csvField, lifecycleGroupOf, normaliseDigits, parseGridFilters } from '../src/modules/order/order-list';
import { deleteTenantData } from './utils/tenant-teardown';

// The Orders page asks the server for one page at a time. It used to fetch the default 50
// and filter, count and search those in the browser, so anything older was out of reach.
describe('order list (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: OrderService;
  let tenantId: string;
  let branchA: string;
  let branchB: string;
  let seq = 0;

  const day = (d: number, hour = 12) => new Date(Date.UTC(2026, 8, d, hour, 0, 0));

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    orders = moduleRef.get(OrderService);

    const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
    tenantId = (await save(Tenant, { code: `OLIST-${Date.now()}`, name: 'Order list', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchA = (await save(Branch, { tenant_id: tenantId, code: 'OLA', name: 'A', is_active: true, time_zone: 'Asia/Tehran' })).id;
    branchB = (await save(Branch, { tenant_id: tenantId, code: 'OLB', name: 'B', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'OL-MAINS', name: 'Mains', is_active: true })).id;
    const productId = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'OL-P', name: 'Burger', base_price: '1.0000', tax_rate: '0.0000', is_active: true })).id;
    const sara = await save(Customer, { tenant_id: tenantId, code: 'C-SARA', first_name: 'Sara', last_name: 'Ahmadi', mobile: '09121234567' });

    const order = async (data: Partial<OrderHeader>, item = 'Burger') => {
      const saved = await save(OrderHeader, {
        tenant_id: tenantId,
        branch_id: branchA,
        order_number: `OL-${++seq}`,
        channel: 'POS',
        order_type: 'TAKEAWAY',
        ...data,
        state: data.status || 'COMPLETED',
        status: data.status || 'COMPLETED',
      });
      await save(OrderItem, { tenant_id: tenantId, order_id: saved.id, product_id: productId, product_name: item, unit_price: '1', quantity: '1', total_price: '1', line_number: 1 });
      // placed_at is a create-date column; set the day after the insert.
      if (data.placed_at) await dataSource.query(`UPDATE order_header SET placed_at = $1 WHERE id = $2`, [data.placed_at, saved.id]);
      return saved;
    };

    // Sixty old completed orders push the one that matters past the old cap of 50.
    for (let i = 0; i < 60; i++) await order({ placed_at: day(10) });
    await order({ placed_at: day(1), customer_id: sara.id, notes: 'first ever' }, 'Pizza');
    await order({ placed_at: day(20), status: 'CONFIRMED', call_number: 142, channel: 'KIOSK' });
    await order({ placed_at: day(20), status: 'PENDING_ACCEPTANCE', channel: 'AGGREGATOR', order_type: 'AGGREGATOR' });
    await order({ placed_at: day(20), status: 'DRAFT' });
    await order({ placed_at: day(20), status: 'CANCELLED' });
    await order({ placed_at: day(20), status: 'COMPLETED', refunded_total: '5000.0000', grand_total: '99000.0000' });
    await order({ placed_at: day(20), branch_id: branchB, status: 'CONFIRMED' });
    // Branch B also has a COD delivery still out from the 5th, a day already finished, and a
    // customer whose mobile was saved in the +98 form.
    const nima = await save(Customer, { tenant_id: tenantId, code: 'C-NIMA', first_name: 'Nima', last_name: 'Hosseini', mobile: '+989351112233' });
    await order({ placed_at: day(5), branch_id: branchB, status: 'OUT_FOR_DELIVERY', order_type: 'DELIVERY', customer_id: nima.id });
    await order({ placed_at: day(5), branch_id: branchB, status: 'COMPLETED' });
  }, 120000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('pages through the whole book and reports the true total', async () => {
    const first = await orders.getOrders(tenantId, { branchId: branchA, limit: '25' });
    const last = await orders.getOrders(tenantId, { branchId: branchA, limit: '25', page: '3' });
    expect(first.total).toBe(66);
    expect(first.data).toHaveLength(25);
    expect(last.data).toHaveLength(16);
    expect(last.data[last.data.length - 1].notes).toBe('first ever');
  });

  it('counts each tab under the other filters, and the tabs add up to All', async () => {
    const { counts } = await orders.getOrders(tenantId, { branchId: branchA, counts: '1', limit: '1' });
    expect(counts).toMatchObject({ ALL: 66, OPEN: 1, WAITING: 1, HELD: 1, CANCELLED: 1, REFUNDED: 1, COMPLETED: 61, OTHER: 0 });
  });

  it('filters by lifecycle group, date range, channel and type', async () => {
    const open = await orders.getOrders(tenantId, { branchId: branchA, group: 'OPEN' });
    expect(open.data.map((o: any) => o.call_number)).toEqual([142]);

    const refunded = await orders.getOrders(tenantId, { branchId: branchA, group: 'REFUNDED' });
    expect(refunded.data.map((o: any) => o.lifecycle)).toEqual(['REFUNDED']);

    const onThe20th = await orders.getOrders(tenantId, { branchId: branchA, from: day(20, 0).toISOString(), to: day(21, 0).toISOString() });
    expect(onThe20th.total).toBe(5);

    expect((await orders.getOrders(tenantId, { branchId: branchA, channel: 'KIOSK' })).total).toBe(1);
    expect((await orders.getOrders(tenantId, { branchId: branchA, type: 'AGGREGATOR' })).total).toBe(1);
  });

  it('searches the whole book by customer, mobile, item and call number, in Persian digits too', async () => {
    const byName = await orders.getOrders(tenantId, { branchId: branchA, q: 'ahmadi' });
    expect(byName.data.map((o: any) => [o.notes, o.customer_name, o.customer_mobile])).toEqual([['first ever', 'Sara Ahmadi', '09121234567']]);
    expect((await orders.getOrders(tenantId, { branchId: branchA, q: '۰۹۱۲۱۲۳' })).total).toBe(1);
    expect((await orders.getOrders(tenantId, { branchId: branchA, q: 'pizza' })).total).toBe(1);
    expect((await orders.getOrders(tenantId, { branchId: branchA, q: '۱۴۲' })).data[0].call_number).toBe(142);
  });

  it('shows open orders from earlier days under a date range, but keeps finished ones to it', async () => {
    const onThe20th = { branchId: branchB, from: day(20, 0).toISOString(), to: day(21, 0).toISOString() };
    const open = await orders.getOrders(tenantId, { ...onThe20th, group: 'OPEN' });
    expect(open.data.map((o: any) => o.status).sort()).toEqual(['CONFIRMED', 'OUT_FOR_DELIVERY']);

    const { counts } = await orders.getOrders(tenantId, { ...onThe20th, counts: '1', limit: '1' });
    expect(counts).toMatchObject({ ALL: 2, OPEN: 2, COMPLETED: 0 });

    // A spreadsheet of the 20th is the 20th.
    const csv = await orders.exportOrdersCsv(tenantId, onThe20th);
    expect(csv.slice(1).trim().split('\r\n')).toHaveLength(2);
  });

  it('finds a +98 mobile from the 09 number staff type, and the other way round', async () => {
    expect((await orders.getOrders(tenantId, { branchId: branchB, q: '09351112233' })).total).toBe(1);
    expect((await orders.getOrders(tenantId, { branchId: branchB, q: '۰۹۳۵۱۱' })).total).toBe(1);
    expect((await orders.getOrders(tenantId, { branchId: branchA, q: '+98912123' })).total).toBe(1);
  });

  it('sorts by total, and keeps the old single-state filter for the POS held list', async () => {
    const byTotal = await orders.getOrders(tenantId, { branchId: branchA, sort: 'grand_total', dir: 'desc', limit: '1' });
    expect(byTotal.data[0].grand_total).toBe('99000.0000');
    const held = await orders.getOrders(tenantId, { branchId: branchA, state: 'DRAFT' });
    expect(held.total).toBe(1);
  });

  it('exports the filtered book as CSV', async () => {
    const csv = await orders.exportOrdersCsv(tenantId, { branchId: branchA, q: 'ahmadi' });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith('order_number,call_number,branch')).toBe(true);
    expect(lines[1]).toContain('Sara Ahmadi');
  });

  it('finds orders by id, for the refunds list', async () => {
    const some = await orders.getOrders(tenantId, { branchId: branchA, limit: '2' });
    const ids = some.data.map((o: any) => o.id);
    const found = await orders.getOrders(tenantId, { ids: [...ids, 'not-a-uuid'].join(',') });
    expect(found.data.map((o: any) => o.id).sort()).toEqual([...ids].sort());
  });

  describe("the grid's column filters", () => {
    const filters = (items: any[], logic?: 'and' | 'or') => JSON.stringify({ items, ...(logic ? { logic } : {}) });
    const list = (items: any[], extra: any = {}, logic?: 'and' | 'or') =>
      orders.getOrders(tenantId, { branchId: branchA, ...extra, filters: filters(items, logic) });

    it('filters by channel, type, order number, customer, item and amount', async () => {
      expect((await list([{ field: 'channel', operator: 'is', value: 'KIOSK' }])).total).toBe(1);
      expect((await list([{ field: 'channel', operator: 'not', value: 'POS' }])).total).toBe(2);
      expect((await list([{ field: 'order_type', operator: 'isAnyOf', value: ['AGGREGATOR', 'DELIVERY'] }])).total).toBe(1);
      expect((await list([{ field: 'customer_name', operator: 'contains', value: 'ahmadi' }])).data[0].notes).toBe('first ever');
      // Staff type the 09 form; the filter also finds the same mobile, and reads Persian digits.
      expect((await list([{ field: 'customer_name', operator: 'contains', value: '۰۹۱۲۱۲۳' }])).total).toBe(1);
      expect((await list([{ field: 'customer_name', operator: 'isNotEmpty' }])).total).toBe(1);
      expect((await list([{ field: 'customer_name', operator: 'isEmpty' }])).total).toBe(65);
      expect((await list([{ field: 'items', operator: 'contains', value: 'PIZ' }])).total).toBe(1);
      expect((await list([{ field: 'grand_total', operator: '>=', value: '99000' }])).total).toBe(1);
      const numbered = (await orders.getOrders(tenantId, { branchId: branchA, limit: '1' })).data[0].order_number;
      expect((await list([{ field: 'order_number', operator: 'equals', value: numbered }])).total).toBe(1);
    });

    it('takes % and _ as the characters they are', async () => {
      expect((await list([{ field: 'order_number', operator: 'contains', value: '%' }])).total).toBe(0);
      expect((await list([{ field: 'items', operator: 'contains', value: '_' }])).total).toBe(0);
    });

    it('combines with and by default, or when asked, and never outside the branch or tab', async () => {
      const kiosk = { field: 'channel', operator: 'is', value: 'KIOSK' };
      const aggregator = { field: 'order_type', operator: 'is', value: 'AGGREGATOR' };
      expect((await list([kiosk, aggregator])).total).toBe(0);
      expect((await list([kiosk, aggregator], {}, 'or')).total).toBe(2);
      // "Or" does not reach past the tab, the branch or the tenant.
      expect((await list([kiosk, aggregator], { group: 'WAITING' }, 'or')).total).toBe(1);
      const branchBOnly = await orders.getOrders(tenantId, {
        branchId: branchB,
        filters: filters([{ field: 'branch_id', operator: 'is', value: branchA }, kiosk], 'or'),
      });
      expect(branchBOnly.total).toBe(0);
    });

    it('lets open orders through a date filter on the list, but not in the export', async () => {
      const onThe20th = [{ field: 'placed_at', operator: 'between', value: [day(20, 0).toISOString(), day(21, 0).toISOString()] }];
      const listed = await orders.getOrders(tenantId, { branchId: branchB, filters: filters(onThe20th), counts: '1' });
      expect(listed.counts).toMatchObject({ ALL: 2, OPEN: 2 });
      const csv = await orders.exportOrdersCsv(tenantId, { branchId: branchB, filters: filters(onThe20th) });
      expect(csv.slice(1).trim().split('\r\n')).toHaveLength(2);
      // Only a start: everything from the 20th on.
      const since = [{ field: 'placed_at', operator: 'between', value: [day(20, 0).toISOString(), null] }];
      expect((await list(since)).total).toBe(5);
    });

    it('ignores a filter still waiting for its value', async () => {
      expect((await list([{ field: 'order_number', operator: 'contains', value: '' }, { field: 'channel', operator: 'isAnyOf', value: [] }])).total).toBe(66);
    });

    it('refuses fields, operators and values it does not know', () => {
      expect(() => parseGridFilters('{not json')).toThrow(BadRequestException);
      expect(() => parseGridFilters(filters([{ field: 'notes', operator: 'contains', value: 'x' }]))).toThrow(/cannot be filtered by notes/);
      expect(() => parseGridFilters(filters([{ field: 'channel', operator: 'contains', value: 'x' }]))).toThrow(/Unknown filter/);
      expect(() => parseGridFilters(filters([{ field: 'channel', operator: '__proto__' }]))).toThrow(/Unknown filter/);
      expect(() => parseGridFilters(filters(Array.from({ length: 13 }, () => ({ field: 'channel', operator: 'is' }))))).toThrow(/At most 12/);
      return Promise.all([
        expect(list([{ field: 'grand_total', operator: '>', value: '1; DROP TABLE order_header' }])).rejects.toThrow(/Not a number/),
        expect(list([{ field: 'branch_id', operator: 'is', value: 'not-a-uuid' }])).rejects.toThrow(/Not a value/),
        expect(list([{ field: 'placed_at', operator: 'between', value: ['yesterday', null] }])).rejects.toThrow(/Not a date/),
      ]);
    });
  });

  it('groups, reads digits and quotes CSV the same way everywhere', () => {
    expect(lifecycleGroupOf({ status: 'OUT_FOR_DELIVERY' })).toBe('OPEN');
    expect(lifecycleGroupOf({ status: 'COMPLETED', refunded_total: '0.0000' })).toBe('COMPLETED');
    expect(lifecycleGroupOf({ status: 'REJECTED' })).toBe('CANCELLED');
    expect(normaliseDigits('۱۲٣')).toBe('123');
    expect(csvField('a,"b"')).toBe('"a,""b"""');
  });
});
