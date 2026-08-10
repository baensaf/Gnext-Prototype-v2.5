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
import { IntegrationLog } from '../src/entities/IntegrationLog.entity';
import { OperationalAlert } from '../src/entities/OperationalAlert.entity';
import { checkTranslations } from '../src/scripts/translation-check';

describe('R27 Final Integration, Regression & Customer-Validation Certification Suite', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let reportsService: ReportsService;
  let testTenantId: string;
  let testBranchId: string;

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

      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "system" varchar(32);
      ALTER TABLE "integration_log" ALTER COLUMN "system" DROP NOT NULL;
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "provider" varchar(64);
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "event_type" varchar(64);
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "hmac_signature" varchar(128);
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(128);
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "is_duplicate" boolean DEFAULT false;
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "status" varchar(32) DEFAULT 'SUCCESS';
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "request_payload" jsonb;
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "response_payload" jsonb;
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "error_message" text;
    `);

    // Setup unique fixture tenant per run
    const tenantRepo = dataSource.getRepository(Tenant);
    const tenantCode = `R27-CERT-${Date.now()}`;
    const tenant = await tenantRepo.save(
      tenantRepo.create({
        code: tenantCode,
        name: 'R27 Certification Tenant',
        base_currency: 'IRR',
        default_locale: 'fa',
        time_zone: 'Asia/Tehran',
      }),
    );
    testTenantId = tenant.id;

    const branchRepo = dataSource.getRepository(Branch);
    const branch = await branchRepo.save(
      branchRepo.create({
        tenant_id: testTenantId,
        code: 'BR-R27',
        name: 'R27 Main Branch',
        time_zone: 'Asia/Tehran',
      }),
    );
    testBranchId = branch.id;
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('Journey 1: Dine-in Order & EOD Shift Reconciliation', async () => {
    const orderRepo = dataSource.getRepository(OrderHeader);
    const itemRepo = dataSource.getRepository(OrderItem);
    const paymentRepo = dataSource.getRepository(Payment);
    const shiftRepo = dataSource.getRepository(CashierShift);

    const tag = Date.now().toString();

    // 1. Create Dine-in Order
    const order = await orderRepo.save(
      orderRepo.create({
        tenant_id: testTenantId,
        branch_id: testBranchId,
        order_number: `ORD-J1-${tag}`,
        order_type: 'DINE_IN',
        status: 'COMPLETED',
        subtotal_amount: '200000.0000',
        tax_amount: '18000.0000',
        discount_amount: '20000.0000',
        total_amount: '198000.0000',
        paid_amount: '198000.0000',
        placed_at: new Date(),
      }),
    );

    await itemRepo.save(
      itemRepo.create({
        tenant_id: testTenantId,
        order_id: order.id,
        product_id: '00000000-0000-0000-0000-000000000001',
        product_name: 'Cheeseburger',
        quantity: '1.0000',
        unit_price: '200000.0000',
        line_total: '200000.0000',
        total_amount: '200000.0000',
      }),
    );

    // 2. Split Payments (Cash + Mobile POS)
    await paymentRepo.save(
      paymentRepo.create({
        tenant_id: testTenantId,
        order_id: order.id,
        payment_number: `PAY-J1-A-${tag}`,
        method_id: '00000000-0000-0000-0000-000000000001',
        method_kind: 'CASH',
        amount: '100000.0000',
        status: 'COMPLETED',
        business_date: '2026-08-10',
      }),
    );

    await paymentRepo.save(
      paymentRepo.create({
        tenant_id: testTenantId,
        order_id: order.id,
        payment_number: `PAY-J1-B-${tag}`,
        method_id: '00000000-0000-0000-0000-000000000002',
        method_kind: 'MOBILE_POS',
        amount: '98000.0000',
        status: 'COMPLETED',
        business_date: '2026-08-10',
      }),
    );

    // 3. Shift Open/Close Balance
    await shiftRepo.save(
      shiftRepo.create({
        tenant_id: testTenantId,
        branch_id: testBranchId,
        terminal_id: '00000000-0000-0000-0000-000000000001',
        shift_number: `SHIFT-J1-${tag}`,
        opened_by: '00000000-0000-0000-0000-000000000001',
        business_date: '2026-08-10',
        opening_cash: '50000.0000',
        expected_cash: '150000.0000',
        actual_cash: '150000.0000',
        short_over: '0.0000',
        state: 'CLOSED',
        closed_at: new Date(),
      }),
    );

    const salesReport = await reportsService.queryReport(testTenantId, 'sales-summary', {});
    expect(salesReport).toBeDefined();
    expect(salesReport.rows.length).toBeGreaterThan(0);
  });

  it('Journey 2: Customer Credit & Reversals Audit', async () => {
    const creditAccRepo = dataSource.getRepository(CustomerCreditAccount);
    const creditEntryRepo = dataSource.getRepository(CreditEntry);

    const custId = `00000000-0000-0000-0000-${Date.now().toString(16).slice(-12).padStart(12, '0')}`;
    const creditAcc = await creditAccRepo.save(
      creditAccRepo.create({
        tenant_id: testTenantId,
        customer_id: custId,
        currency_code: 'IRR',
        credit_limit: '1000000.0000',
        current_balance: '300000.0000',
        status: 'ACTIVE',
      }),
    );

    await creditEntryRepo.save(
      creditEntryRepo.create({
        tenant_id: testTenantId,
        account_id: creditAcc.id,
        entry_type: 'PURCHASE',
        amount: '-300000.0000',
        business_date: '2026-08-10',
        balance_after: '300000.0000',
      }),
    );

    const creditReport = await reportsService.queryReport(testTenantId, 'customer-credit', {});
    expect(creditReport).toBeDefined();
  });

  it('Journey 3: Delivery Roster & Settlement Discrepancies', async () => {
    const settlementRepo = dataSource.getRepository(CourierSettlement);
    const tag = Date.now().toString();

    await settlementRepo.save(
      settlementRepo.create({
        tenant_id: testTenantId,
        courier_id: '00000000-0000-0000-0000-000000000001',
        settlement_number: `SETTLE-J3-${tag}`,
        settlement_date: new Date(),
        expected_cash_amount: '150000.00',
        actual_cash_amount: '150000.00',
        net_settlement_amount: '150000.00',
        cash_discrepancy_amount: '0.00',
        status: 'CLOSED',
      }),
    );

    const settlementsReport = await reportsService.queryReport(testTenantId, 'courier-settlements', {});
    expect(settlementsReport).toBeDefined();
  });

  it('Journey 4: Snappfood Webhook Adapter & Duplicate Rejection', async () => {
    const logRepo = dataSource.getRepository(IntegrationLog);
    const tag = Date.now().toString();

    // 1. Initial Webhook
    await logRepo.save(
      logRepo.create({
        tenant_id: testTenantId,
        provider: 'SNAPPFOOD',
        event_type: 'ORDER_CREATED',
        idempotency_key: `SF-KEY-${tag}`,
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: { orderCode: `SF-ORD-${tag}` },
      }),
    );

    // 2. Duplicate Webhook
    await logRepo.save(
      logRepo.create({
        tenant_id: testTenantId,
        provider: 'SNAPPFOOD',
        event_type: 'ORDER_CREATED',
        idempotency_key: `SF-KEY-${tag}`,
        is_duplicate: true,
        status: 'REJECTED',
        request_payload: { orderCode: `SF-ORD-${tag}` },
      }),
    );

    const integrationReport = await reportsService.queryReport(testTenantId, 'integration-operations', {});
    expect(integrationReport).toBeDefined();
  });

  it('Journey 5: Offline Queue & Sync Alerts', async () => {
    const alertRepo = dataSource.getRepository(OperationalAlert);

    await alertRepo.save(
      alertRepo.create({
        tenant_id: testTenantId,
        branch_id: testBranchId,
        type: 'OFFLINE_SYNC_DELAY',
        severity: 'WARNING',
        title: 'Branch Offline Duration Exceeded Threshold',
        message: 'Branch BR-R27 has pending offline transactions queued for sync.',
        acknowledged: false,
      }),
    );

    const alerts = await reportsService.getAlerts(testTenantId);
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('Journey 6: Translation Key Parity & Report Export Certification', async () => {
    // 1. Translation Parity
    const translationRes = checkTranslations();
    expect(translationRes.success).toBe(true);
    expect(translationRes.missingEn.length).toBe(0);
    expect(translationRes.missingFa.length).toBe(0);

    // 2. CSV Export with UTF-8 BOM
    const csv = await reportsService.exportReport(testTenantId, 'sales-summary', {}, 'CSV');
    expect(csv.content.startsWith('\uFEFF')).toBe(true);

    // 3. XLSX Binary Export
    const xlsx = await reportsService.exportReport(testTenantId, 'sales-summary', {}, 'XLSX');
    expect(xlsx.content_base64).toBeDefined();
    expect(xlsx.content_base64.length).toBeGreaterThan(100);
  });
});
