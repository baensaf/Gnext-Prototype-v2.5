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
import { AdminUser } from '../src/entities/AdminUser.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { ShiftService } from '../src/modules/cashier/shift.service';
import { OrderService } from '../src/modules/order/order.service';
import { ReportsService } from '../src/modules/reports/reports.service';
import { loadBusinessClock } from '../src/common/utils/business-clock';
import { deleteTenantData } from './utils/tenant-teardown';
import { deliveryFixture } from './utils/delivery-fixture';

// Sales by day, hour, channel and employee, and voids & cancellations (2026-10-14): one
// cashier sells two delivery orders and voids a cola off the first (only a delivery that has not
// gone out takes line changes, O-22).
describe('Sales breakdown reports (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let reports: ReportsService;
  let tenantId: string;
  let branchId: string;
  let today: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    reports = moduleRef.get(ReportsService);
    const orders = moduleRef.get(OrderService);
    const shifts = moduleRef.get(ShiftService);

    const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
    tenantId = (await save(Tenant, { code: `RPTBD-${Date.now()}`, name: 'Breakdown', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'RB1', name: 'Nasr', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const terminalId = (await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'RB-1', name: 'Till 1', terminal_type: 'CASHIER', is_active: true })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'RB-MAINS', name: 'Mains', is_active: true })).id;
    const burger = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'BURGER', name: 'Burger', base_price: '100000.0000', tax_rate: '0.0000', is_active: true })).id;
    const cola = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'COLA', name: 'Cola', base_price: '30000.0000', tax_rate: '0.0000', is_active: true })).id;
    const cashier = (await save(AdminUser, { tenant_id: tenantId, username: `sara-${Date.now()}`, display_name: 'Sara', password_hash: 'x', role: 'CASHIER', branch_id: branchId })).id;
    const shiftId = ((await shifts.openShift(tenantId, { terminalId } as any)) as any).id;
    today = (await loadBusinessClock(dataSource.manager, tenantId, branchId)).today();
    const delivery = await deliveryFixture(dataSource, tenantId, branchId);

    const sell = async (items: Array<{ product_id: string; quantity: number }>) => {
      const draft = await orders.createDraft(
        tenantId,
        { branch_id: branchId, terminal_id: terminalId, shift_id: shiftId, ...delivery, channel: 'POS', items } as any,
        cashier,
      );
      await orders.submitOrder(tenantId, draft.id, {} as any, cashier);
      return draft.id;
    };
    const first = await sell([{ product_id: burger, quantity: 2 }, { product_id: cola, quantity: 1 }]);
    await sell([{ product_id: burger, quantity: 1 }]);
    const colaLine = await dataSource.getRepository(OrderItem).findOneByOrFail({ order_id: first, product_id: cola });
    await orders.editOrder(
      tenantId,
      first,
      { changes: { void: [{ orderItemId: colaLine.id, reasonCodeId: randomUUID() }] }, reason: 'Changed their mind' } as any,
      cashier,
    );
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const run = (code: string) => reports.queryReport(tenantId, code, { startDate: today, endDate: today, branchId });

  it('adds up the day', async () => {
    const report = await run('sales-by-day');
    expect(report.rows).toEqual([expect.objectContaining({ business_date: today, orders: 2, net_sales: '300000.00', average_check: '150000.00' })]);
  });

  it('splits the day by hour, all of it in some hour', async () => {
    const report = await run('sales-by-hour');
    expect(report.summary_totals).toMatchObject({ orders: 2, net_sales: '300000.00', share_percent: '100.0' });
    expect(report.rows.every((r: any) => /^\d{2}:00$/.test(r.hour))).toBe(true);
  });

  it('splits by channel and order type', async () => {
    const report = await run('sales-by-channel');
    expect(report.rows).toEqual([expect.objectContaining({ channel: 'POS', order_type: 'DELIVERY', orders: 2, share_percent: '100.0' })]);
  });

  it('credits the cashier who rang the orders up, with the line they voided', async () => {
    const report = await run('sales-by-employee');
    expect(report.rows).toEqual([
      expect.objectContaining({ employee: 'Sara', orders: 2, net_sales: '300000.00', voided_lines: 1, cancelled_orders: 0 }),
    ]);
  });

  it('lists the voided line with who struck it off and why', async () => {
    const report = await run('voids-cancellations');
    expect(report.rows).toEqual([
      expect.objectContaining({ kind: 'LINE_VOID', item: 'Cola', amount: '30000.00', reason: 'Changed their mind', by: 'Sara' }),
    ]);
  });
});
