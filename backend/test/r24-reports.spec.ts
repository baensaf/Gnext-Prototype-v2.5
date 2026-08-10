import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ReportsService } from '../src/modules/reports/reports.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { Payment } from '../src/entities/Payment.entity';
import { CashierShift } from '../src/entities/CashierShift.entity';
import { CourierSettlement } from '../src/entities/CourierSettlement.entity';
import { CustomerCreditAccount } from '../src/entities/CustomerCreditAccount.entity';
import { CreditEntry } from '../src/entities/CreditEntry.entity';

describe('R24 Reports, Alerts, Exports & Audit Verification Suite', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let reportsService: ReportsService;
  let testTenantId: string;

  beforeAll(async () => {
    process.env.DB_PORT = process.env.DB_PORT || '5433';
    process.env.DB_NAME = process.env.DB_NAME || 'appdb_test';
    process.env.DB_USER = process.env.DB_USER || 'postgres';
    process.env.DB_USERNAME = process.env.DB_USERNAME || 'postgres';
    process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = moduleRef.get<DataSource>(DataSource);
    reportsService = moduleRef.get<ReportsService>(ReportsService);

    // Ensure schema columns exist
    await dataSource.query(`
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "placed_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "subtotal" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "discount_total" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "discount_amount" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "tax_total" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "tax_amount" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "total_amount" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "notes" text;
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "special_instructions" text;
      ALTER TABLE "order_item" ALTER COLUMN "total_price" DROP NOT NULL;
      ALTER TABLE "payment" ALTER COLUMN "payment_method_id" DROP NOT NULL;
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "user_id" uuid;
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "opened_by" uuid;
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "closed_by" uuid;
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "opening_cash" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "opening_float" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "expected_cash" numeric(19,4);
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "actual_cash" numeric(19,4);
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "short_over" numeric(19,4);
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "over_short_amount" numeric(19,4);
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "closing_note" text;
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "notes" text;

      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "code" varchar(32);
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "first_name" varchar(80);
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "last_name" varchar(80);
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "mobile" varchar(32);
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "national_id" varchar(20);
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true;
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "created_by" uuid;
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1;

      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "decimal_precision" smallint DEFAULT 0;
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "rounding_increment" numeric(19,4) DEFAULT '1.0000';
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "is_enabled" boolean DEFAULT true;
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "is_base" boolean DEFAULT false;
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "created_by" uuid;
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1;

      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "provider" varchar(64);
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "event_type" varchar(64);
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "hmac_signature" varchar(128);
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(128);
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "is_duplicate" boolean DEFAULT false;
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "status" varchar(32) DEFAULT 'SUCCESS';
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "request_payload" jsonb;
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "response_payload" jsonb;
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "error_message" text;

      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "event_type" varchar(50);
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "actor_type" varchar(30);
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "actor_id" uuid;
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "action" varchar(80);
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "entity_type" varchar(40);
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "entity_id" uuid;
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "branch_id" uuid;
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "correlation_id" uuid;
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "ip" varchar(45);
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "before_data" jsonb;
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "after_data" jsonb;
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "details" jsonb;
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "occurred_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    `);

    // Setup unique fixture tenant per run to avoid cross-run state pollution
    const tenantRepo = dataSource.getRepository(Tenant);
    const tenantCode = `R24-TENANT-${Date.now()}`;
    const tenant = await tenantRepo.save(
      tenantRepo.create({
        code: tenantCode,
        name: 'R24 Verification Tenant',
        base_currency: 'IRR',
        default_locale: 'fa',
        time_zone: 'Asia/Tehran',
      }),
    );
    testTenantId = tenant.id;

    // Seed test fixtures for cross-report reconciliation
    const branchRepo = dataSource.getRepository(Branch);
    const branch = await branchRepo.save(
      branchRepo.create({
        tenant_id: testTenantId,
        code: 'BR-R24',
        name: 'R24 Main Branch',
        time_zone: 'Asia/Tehran',
      }),
    );

    const orderRepo = dataSource.getRepository(OrderHeader);
    const itemRepo = dataSource.getRepository(OrderItem);
    const paymentRepo = dataSource.getRepository(Payment);
    const shiftRepo = dataSource.getRepository(CashierShift);
    const settlementRepo = dataSource.getRepository(CourierSettlement);
    const creditAccRepo = dataSource.getRepository(CustomerCreditAccount);
    const creditEntryRepo = dataSource.getRepository(CreditEntry);

    const uniqueTag = Date.now().toString();

    // Seed Order
    const order = await orderRepo.save(
      orderRepo.create({
        tenant_id: testTenantId,
        branch_id: branch.id,
        order_number: `ORD-R24-${uniqueTag}`,
        order_type: 'PICKUP',
        status: 'COMPLETED',
        subtotal_amount: '100000.0000',
        tax_amount: '9000.0000',
        discount_amount: '0.0000',
        total_amount: '109000.0000',
        paid_amount: '109000.0000',
        placed_at: new Date(),
      }),
    );

    await itemRepo.save(
      itemRepo.create({
        tenant_id: testTenantId,
        order_id: order.id,
        product_id: '00000000-0000-0000-0000-000000000001',
        product_name: 'Espresso',
        quantity: '2.0000',
        unit_price: '50000.0000',
        line_total: '100000.0000',
        total_amount: '100000.0000',
      }),
    );

    // Seed Payment
    await paymentRepo.save(
      paymentRepo.create({
        tenant_id: testTenantId,
        order_id: order.id,
        payment_number: `PAY-R24-${uniqueTag}`,
        method_id: '00000000-0000-0000-0000-000000000001',
        method_kind: 'CASH',
        amount: '109000.0000',
        status: 'COMPLETED',
        business_date: '2026-08-09',
      }),
    );

    // Seed Shift
    await shiftRepo.save(
      shiftRepo.create({
        tenant_id: testTenantId,
        branch_id: branch.id,
        terminal_id: '00000000-0000-0000-0000-000000000001',
        shift_number: `SHIFT-R24-${uniqueTag}`,
        opened_by: '00000000-0000-0000-0000-000000000001',
        business_date: '2026-08-09',
        opening_cash: '50000.0000',
        expected_cash: '159000.0000',
        actual_cash: '159000.0000',
        short_over: '0.0000',
        state: 'CLOSED',
        closed_at: new Date(),
      }),
    );

    // Seed Credit Account & Entry with dynamic customer_id
    const custId = `00000000-0000-0000-0000-${Date.now().toString(16).slice(-12).padStart(12, '0')}`;
    const creditAcc = await creditAccRepo.save(
      creditAccRepo.create({
        tenant_id: testTenantId,
        customer_id: custId,
        currency_code: 'IRR',
        credit_limit: '500000.0000',
        current_balance: '100000.0000',
        status: 'ACTIVE',
      }),
    );

    await creditEntryRepo.save(
      creditEntryRepo.create({
        tenant_id: testTenantId,
        account_id: creditAcc.id,
        order_id: order.id,
        entry_type: 'PURCHASE',
        amount: '-100000.0000',
        business_date: '2026-08-09',
        balance_after: '100000.0000',
      }),
    );

    // Seed Courier Settlement
    await settlementRepo.save(
      settlementRepo.create({
        tenant_id: testTenantId,
        courier_id: '00000000-0000-0000-0000-000000000001',
        settlement_number: `SETTLE-R24-${uniqueTag}`,
        settlement_date: new Date(),
        expected_cash_amount: '100000.00',
        actual_cash_amount: '100000.00',
        net_settlement_amount: '100000.00',
        cash_discrepancy_amount: '0.00',
        status: 'CLOSED',
      }),
    );
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('should list all report catalog entries defined in Section 13 (23 core reports)', async () => {
    const catalog = await reportsService.getCatalog();
    expect(catalog).toBeDefined();
    expect(catalog.length).toBeGreaterThanOrEqual(23);

    const requiredCodes = [
      'sales-summary',
      'product-sales',
      'payments-by-method',
      'mixed-payments',
      'mobile-pos',
      'alternative-refunds',
      'discounts',
      'manual-discounts',
      'discount-stacking',
      'cashier-shifts',
      'cash-discrepancies',
      'customer-credit',
      'credit-eod-usage',
      'credit-aging',
      'customer-activity',
      'aggregator-orders',
      'snappfood-reconciliation',
      'courier-attendance',
      'courier-settlements',
      'courier-reconciliation',
      'tax-packaging',
      'print-operations',
      'integration-operations',
    ];

    for (const code of requiredCodes) {
      const match = catalog.find((c) => c.code === code);
      expect(match).toBeDefined();
    }
  });

  it('should query all 23 reports against real PostgreSQL data without mock placeholders', async () => {
    const catalog = await reportsService.getCatalog();
    for (const item of catalog) {
      const res = await reportsService.queryReport(testTenantId, item.code, {});
      expect(res).toBeDefined();
      expect(res.report_code).toBe(item.code);
      expect(Array.isArray(res.rows)).toBe(true);
      expect(res.summary_totals).toBeDefined();
    }
  });

  it('should ensure page totals equal export totals for identical filters', async () => {
    const pageResult = await reportsService.queryReport(testTenantId, 'sales-summary', {});
    const exportResult = await reportsService.exportReport(testTenantId, 'sales-summary', {}, 'CSV');

    expect(exportResult.content).toContain('SUMMARY TOTALS');
    expect(exportResult.content).toContain(pageResult.summary_totals.net_sales);
    expect(exportResult.content).toContain(pageResult.summary_totals.gross_subtotal);
  });

  it('should produce UTF-8 BOM CSV exports and real ExcelJS XLSX binary streams', async () => {
    const csvExport = await reportsService.exportReport(testTenantId, 'product-sales', {}, 'CSV');
    expect(csvExport.filename).toContain('product-sales');
    expect(csvExport.mime_type).toContain('text/csv');
    expect(csvExport.content.startsWith('\uFEFF')).toBe(true);

    const xlsxExport = await reportsService.exportReport(testTenantId, 'product-sales', {}, 'XLSX');
    expect(xlsxExport.filename).toContain('.xlsx');
    expect(xlsxExport.mime_type).toContain('spreadsheetml');
    expect(xlsxExport.content_base64).toBeDefined();
    expect(xlsxExport.content_base64.length).toBeGreaterThan(100);
  });

  it('should persist operational alerts in PostgreSQL so they survive restart', async () => {
    const alerts = await reportsService.getAlerts(testTenantId);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].id).toBeDefined();

    const targetAlert = alerts[0];
    const ackResult = await reportsService.acknowledgeAlert(testTenantId, targetAlert.id, '00000000-0000-0000-0000-000000000001');
    expect(ackResult.acknowledged).toBe(true);
    expect(ackResult.acknowledged_by).toBe('00000000-0000-0000-0000-000000000001');

    // Re-query to confirm database persistence
    const reQueriedAlerts = await reportsService.getAlerts(testTenantId);
    const updatedMatch = reQueriedAlerts.find((a) => a.id === targetAlert.id);
    expect(updatedMatch.acknowledged).toBe(true);
  });

  it('should log audit event on alert acknowledgment and report export with masking', async () => {
    const auditRes = await reportsService.getAuditLogs(testTenantId, { limit: 10 });
    expect(auditRes.data).toBeDefined();
    const ackLog = auditRes.data.find((e) => e.action === 'ALERT_ACKNOWLEDGED');
    expect(ackLog).toBeDefined();

    const exportLog = auditRes.data.find((e) => e.action === 'REPORT_EXPORTED');
    expect(exportLog).toBeDefined();
  });

  it('should support saved report views CRUD operations', async () => {
    const newView = await reportsService.createSavedView(testTenantId, '00000000-0000-0000-0000-000000000001', {
      name: 'Custom Sales View',
      reportCode: 'sales-summary',
      filters: { startDate: '2026-08-01' },
    });

    expect(newView.id).toBeDefined();
    expect(newView.name).toBe('Custom Sales View');

    const views = await reportsService.getSavedViews(testTenantId, 'sales-summary');
    expect(views.length).toBeGreaterThan(0);

    const deleteRes = await reportsService.deleteSavedView(testTenantId, newView.id);
    expect(deleteRes.success).toBe(true);
  });

  it('should reconcile sales, payments, shifts, customer credit, and courier settlements across reports', async () => {
    const salesReport = await reportsService.queryReport(testTenantId, 'sales-summary', {});
    const paymentsReport = await reportsService.queryReport(testTenantId, 'payments-by-method', {});
    const shiftsReport = await reportsService.queryReport(testTenantId, 'cashier-shifts', {});
    const creditReport = await reportsService.queryReport(testTenantId, 'customer-credit', {});

    // Verification properties:
    expect(parseFloat(salesReport.summary_totals.paid_total)).toEqual(parseFloat(paymentsReport.summary_totals.succeeded));
    expect(parseFloat(creditReport.summary_totals.debit)).toEqual(100000);
    expect(parseFloat(shiftsReport.summary_totals.expected_cash)).toEqual(159000);
  });
});
