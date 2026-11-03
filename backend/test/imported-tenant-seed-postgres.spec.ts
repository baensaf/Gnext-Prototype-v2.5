import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { seedImportedTenant } from '../src/seeds/imported-tenant';
import { ReportsService } from '../src/modules/reports/reports.service';
import { UsersService } from '../src/modules/users/users.service';
import { ImportExportService } from '../src/modules/import-export/import-export.service';
import { deleteTenantData } from './utils/tenant-teardown';

// A second demo tenant is imported from a file that is not in this repository, so CI would
// otherwise never run the import. A made-up restaurant stands in: one order of each kind.
describe('Importing a demo tenant from its data file (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let tenantId: string;
  let dir: string;
  const previousDataDir = process.env.DATA_DIR;
  const code = `IMP-TEST-${Date.now()}`;
  const username = `${code.toLowerCase()}@test.local`;

  const base = { shift: 1, businessDate: '2026-01-15', op: 'cashier', discountPercent: null, service: '0', house: null, note: null };
  const data = {
    tenant: { code, name: 'Test Chicken' },
    branch: { code: 'MAIN', name: 'Test Chicken', address: 'Testville', latitude: '10.000000', longitude: '20.000000', opens: '10:00', closes: '22:00' },
    users: [{ key: 'cashier', username, display_name: 'Cashier 1', role: 'CASHIER', password_hash: 'x', pin_hash: null, atBranch: true }],
    couriers: [{ code: 'CR-001', name: 'Courier 1', phone: `0900${String(Date.now()).slice(-7)}` }],
    zoneFee: '100000',
    categories: [{ code: '1', name: 'Fried', active: true }],
    products: [{ code: 'T1', name: 'Test box', category: '1', price: '1000000', active: true }],
    customers: [{ first: 'Ali', last: 'Test', mobile: '09000000001', address: 'Testville, lane 1', joined: '2022-01-01' }],
    orders: [
      { ...base, kind: 'COUNTER', num: '1', placedAt: '2026-01-15T09:00:00.000Z', call: 100, customer: null, subtotal: '1000000', discount: '0', fee: '0', price: '1000000', tenders: [['CASH', '400000'], ['CARD_POS', '600000']], lines: [{ code: 'T1', qty: 1, unit: '1000000' }] },
      { ...base, kind: 'COUNTER', num: '2', placedAt: '2026-01-15T09:10:00.000Z', call: 101, customer: null, subtotal: '1000000', discount: '0', fee: '0', price: '1000000', house: 'STAFF', tenders: [], lines: [{ code: 'T1', qty: 1, unit: '1000000' }] },
      { ...base, kind: 'PHONE', num: '3', placedAt: '2026-01-15T09:20:00.000Z', call: 500, customer: 0, subtotal: '2000000', discount: '0', fee: '150000', price: '2150000', tenders: [['MOBILE_POS', '2150000']], lines: [{ code: 'T1', qty: 2, unit: '1000000', note: 'no sauce' }] },
      { ...base, kind: 'SNAPP', num: '4', placedAt: '2026-01-15T09:30:00.000Z', call: 501, customer: null, subtotal: '1000000', discount: '200000', fee: '100000', price: '900000', tenders: [['ONLINE', '900000']], lines: [{ code: 'T1', qty: 1, unit: '1000000' }] },
    ],
  };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imported-tenant-'));
    fs.writeFileSync(path.join(dir, 'imported-tenant.json'), JSON.stringify(data));
    process.env.DATA_DIR = dir;

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);

    await seedImportedTenant(dataSource);
    const [tenant] = await dataSource.query(`SELECT id FROM tenant WHERE code = $1`, [code]);
    tenantId = tenant.id;
  });

  afterAll(async () => {
    process.env.DATA_DIR = previousDataDir;
    fs.rmSync(dir, { recursive: true, force: true });
    if (tenantId) await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const report = (reportCode: string): Promise<any> => moduleRef.get(ReportsService).queryReport(tenantId, reportCode);

  it('does nothing when the file is missing, and imports only once', async () => {
    process.env.DATA_DIR = path.join(dir, 'nowhere');
    await seedImportedTenant(dataSource);
    process.env.DATA_DIR = dir;
    await seedImportedTenant(dataSource);
    const [{ count }] = await dataSource.query(`SELECT count(*)::int AS count FROM order_header WHERE tenant_id = $1`, [tenantId]);
    expect(count).toBe(4);
  });

  it('adds up in the reports: a meal the house gave away is discount, not sales', async () => {
    const sales = await report('sales-summary');
    expect(sales.summary_totals.order_count).toBe(4);
    expect(sales.summary_totals.net_sales).toBe('4050000.00');
    expect(sales.summary_totals.discounts).toBe('1200000.00');

    const tenders = await report('payments-by-method');
    expect(tenders.summary_totals.net).toBe('4050000.00');

    const [shift] = await dataSource.query(`SELECT closing_orders, expected_cash FROM cashier_shift WHERE tenant_id = $1`, [tenantId]);
    expect(shift.expected_cash).toBe('400000.0000');
    expect(shift.closing_orders).toMatchObject({ orderCount: 3, salesTotal: '3150000.0000' });
  });

  it('finds Snappfood orders in the platform report and shows the tax actually charged', async () => {
    const platform = await report('aggregator-orders');
    expect(platform.rows.map((r: any) => r.order_number)).toEqual(['SNP-4']);
    const tax = await report('tax');
    expect(tax.rows[0].tax_rate).toBe('0.0%');
  });

  it('keeps Snappfood orders and their money off the till, as live ones are', async () => {
    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int AS count FROM order_header o JOIN payment p ON p.order_id = o.id
        WHERE o.tenant_id = $1 AND o.channel = 'AGGREGATOR' AND o.shift_id IS NULL AND p.shift_id IS NULL`,
      [tenantId],
    );
    expect(count).toBe(1);
  });

  it('will not let a reset wipe a history it could not bring back', async () => {
    const importExport = moduleRef.get(ImportExportService);
    await expect(importExport.systemReset(tenantId, 'test')).rejects.toThrow('cannot be reset');
    await expect(importExport.resetAndSeedDemo(tenantId, 'test')).rejects.toThrow('cannot be reset');
    const [{ count }] = await dataSource.query(`SELECT count(*)::int AS count FROM order_header WHERE tenant_id = $1`, [tenantId]);
    expect(count).toBe(4);
  });

  it('starts a new account on the password of whoever made it', async () => {
    const [creator] = await dataSource.query(`SELECT id FROM admin_user WHERE tenant_id = $1 AND username = $2`, [tenantId, username]);
    await moduleRef.get(UsersService).create(tenantId, { username: `new-${username}`, display_name: 'New', role: 'SUPER_ADMIN' } as any, creator.id, 'test');
    const [made] = await dataSource.query(`SELECT password_hash FROM admin_user WHERE tenant_id = $1 AND username = $2`, [tenantId, `new-${username}`]);
    expect(made.password_hash).toBe('x');
  });

  it('leaves no shift or order open, so the sweeps have nothing to do', async () => {
    const [{ open }] = await dataSource.query(`SELECT count(*)::int AS open FROM cashier_shift WHERE tenant_id = $1 AND state <> 'CLOSED'`, [tenantId]);
    const [{ unfinished }] = await dataSource.query(`SELECT count(*)::int AS unfinished FROM order_header WHERE tenant_id = $1 AND (state <> 'COMPLETED' OR status <> 'COMPLETED')`, [tenantId]);
    expect([open, unfinished]).toEqual([0, 0]);
  });

  it('refuses a username another tenant already has, since sign-in looks across all of them', async () => {
    const [other] = await dataSource.query(
      `INSERT INTO tenant (code, name, base_currency, default_locale, time_zone) VALUES ($1, 'Other', 'IRR', 'fa', 'Asia/Tehran') RETURNING id`,
      [`${code}-B`],
    );
    try {
      await expect(
        moduleRef.get(UsersService).create(other.id, { username, display_name: 'Same name', role: 'SUPER_ADMIN' } as any, 'test', 'test'),
      ).rejects.toThrow('already exists');
    } finally {
      await deleteTenantData(dataSource, other.id);
    }
  });
});
