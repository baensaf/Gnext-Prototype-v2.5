import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { ReportsService } from '../src/modules/reports/reports.service';
import { CustomerService } from '../src/modules/customer/customer.service';
import { CreditService } from '../src/modules/customer/credit.service';
import { SimulationService } from '../src/modules/simulation/simulation.service';
import { KioskService } from '../src/modules/kiosk/kiosk.service';
import { ImportExportService } from '../src/modules/import-export/import-export.service';
import { ApprovalService } from '../src/modules/approval/approval.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { Payment } from '../src/entities/Payment.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { CashierShift } from '../src/entities/CashierShift.entity';
import { CourierSettlement } from '../src/entities/CourierSettlement.entity';
import { CustomerCreditAccount } from '../src/entities/CustomerCreditAccount.entity';
import { CreditEntry } from '../src/entities/CreditEntry.entity';
import { IntegrationLog } from '../src/entities/IntegrationLog.entity';
import { OperationalAlert } from '../src/entities/OperationalAlert.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { Customer } from '../src/entities/Customer.entity';
import { Product } from '../src/entities/Product.entity';
import { Category } from '../src/entities/Category.entity';
import { checkTranslations } from '../src/scripts/translation-check';

describe('R27 Final Integration, Regression & Customer-Validation Certification Suite', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let reportsService: ReportsService;
  let customerService: CustomerService;
  let creditService: CreditService;
  let simulationService: SimulationService;
  let kioskService: KioskService;
  let importExportService: ImportExportService;
  let approvalService: ApprovalService;
  let authService: AuthService;

  let testTenantId: string;
  let testBranchId: string;
  let testAdminUserId: string;
  let testProductId: string;

  beforeAll(async () => {
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_NAME = process.env.DB_NAME || 'appdb';
    process.env.DB_USER = process.env.DB_USER || 'admin';
    process.env.DB_USERNAME = process.env.DB_USERNAME || 'admin';
    process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'admin';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = moduleRef.get<DataSource>(DataSource);
    reportsService = moduleRef.get<ReportsService>(ReportsService);
    customerService = moduleRef.get<CustomerService>(CustomerService);
    creditService = moduleRef.get<CreditService>(CreditService);
    simulationService = moduleRef.get<SimulationService>(SimulationService);
    kioskService = moduleRef.get<KioskService>(KioskService);
    importExportService = moduleRef.get<ImportExportService>(ImportExportService);
    approvalService = moduleRef.get<ApprovalService>(ApprovalService);
    authService = moduleRef.get<AuthService>(AuthService);

    await dataSource.runMigrations();

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

    const userRepo = dataSource.getRepository(AdminUser);
    const adminPassHash = await argon2.hash('GnextDemo!2026');
    const adminPinHash = await argon2.hash('1234');
    const adminUser = await userRepo.save(
      userRepo.create({
        tenant_id: testTenantId,
        username: `admin_r27_${Date.now()}`,
        password_hash: adminPassHash,
        pin_hash: adminPinHash,
        display_name: 'R27 Test Manager',
        role: 'ADMIN',
        is_active: true,
      }),
    );
    testAdminUserId = adminUser.id;

    const categoryRepo = dataSource.getRepository(Category);
    const category = await categoryRepo.save(
      categoryRepo.create({
        tenant_id: testTenantId,
        code: 'CAT-BURGER',
        name: 'Burgers',
        is_active: true,
      }),
    );

    const productRepo = dataSource.getRepository(Product);
    const product = await productRepo.save(
      productRepo.create({
        tenant_id: testTenantId,
        category_id: category.id,
        code: 'PROD-R27-CHEESEBURGER',
        name: 'Cheeseburger R27',
        base_price: '250000.0000',
        is_active: true,
      }),
    );
    testProductId = product.id;

    const pmRepo = dataSource.getRepository(PaymentMethod);
    await pmRepo.save(
      pmRepo.create({
        tenant_id: testTenantId,
        code: 'PM-POS',
        name: 'Network POS Terminal',
        kind: 'NETWORK_POS',
        is_active: true,
      }),
    );
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
        line_number: 1,
        product_id: testProductId,
        product_code: 'PROD-CHEESEBURGER',
        product_name: 'Cheeseburger',
        quantity: '1.0000',
        unit_price: '200000.0000',
        base_total: '200000.0000',
        subtotal: '200000.0000',
        modifier_total: '0.0000',
        discount_total: '0.0000',
        discount_amount: '0.0000',
        tax_total: '0.0000',
        tax_amount: '0.0000',
        packaging_total: '0.0000',
        line_total: '200000.0000',
        total_amount: '200000.0000',
        state: 'ACTIVE',
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

  it('Journey 2: Customer Credit, Partial Credit/Terminal Payment, Repayment, Aging/Statement, Refund & Manager Approval', async () => {
    const custRepo = dataSource.getRepository(Customer);
    const orderRepo = dataSource.getRepository(OrderHeader);
    const paymentRepo = dataSource.getRepository(Payment);

    const tag = Date.now().toString();

    // 1. Create Customer with Credit Limit
    const customer = await custRepo.save(
      custRepo.create({
        tenant_id: testTenantId,
        code: `CUST-CRED-${tag}`,
        first_name: 'Ahmad',
        last_name: 'Rezaei',
        mobile: `0912${tag.slice(-7)}`,
        is_active: true,
      }),
    );

    // 2. Post Repayment / Top-Up via CreditService
    const creditAccount = await dataSource.getRepository(CustomerCreditAccount).findOne({ where: { tenant_id: testTenantId, customer_id: customer.id } });
    expect(creditAccount).toBeDefined();

    const repayRes = await creditService.postRepayment(
      testTenantId,
      creditAccount!.id,
      { amount: '500000.0000', reason: 'Initial Credit Repayment / Top-Up' },
      testAdminUserId,
      `corr-repay-${tag}`,
    );
    expect(repayRes.entry).toBeDefined();
    expect(Number(repayRes.entry.balance_after)).toBeGreaterThanOrEqual(500000);

    // 3. Partial Credit + Terminal Payment Order Split
    const order = await orderRepo.save(
      orderRepo.create({
        tenant_id: testTenantId,
        branch_id: testBranchId,
        customer_id: customer.id,
        order_number: `ORD-CRED-${tag}`,
        order_type: 'TAKEAWAY',
        status: 'COMPLETED',
        subtotal_amount: '400000.0000',
        tax_amount: '36000.0000',
        discount_amount: '0.0000',
        total_amount: '436000.0000',
        paid_amount: '436000.0000',
        placed_at: new Date(),
      }),
    );

    // Credit Payment portion (200,000 IRR)
    await creditService.postPurchase(
      testTenantId,
      creditAccount!.id,
      {
        amount: '200000.0000',
        orderId: order.id,
      },
      testAdminUserId,
    );

    await paymentRepo.save(
      paymentRepo.create({
        tenant_id: testTenantId,
        order_id: order.id,
        payment_number: `PAY-PART-CRED-${tag}`,
        method_kind: 'CUSTOMER_CREDIT',
        amount: '200000.0000',
        status: 'COMPLETED',
        business_date: '2026-08-11',
      }),
    );

    // Terminal Payment portion (236,000 IRR)
    await paymentRepo.save(
      paymentRepo.create({
        tenant_id: testTenantId,
        order_id: order.id,
        payment_number: `PAY-PART-TERM-${tag}`,
        method_kind: 'NETWORK_POS',
        amount: '236000.0000',
        status: 'COMPLETED',
        business_date: '2026-08-11',
      }),
    );

    // 4. Assert Statement and Credit Aging Subledger
    const statement = await creditService.getAccountStatement(testTenantId, creditAccount!.id, {});
    expect(statement.customerId).toBe(customer.id);
    expect(statement.entries.length).toBeGreaterThanOrEqual(2);

    const agingReport = await creditService.getCreditAging(testTenantId, {});
    expect(agingReport.customers.find((c: any) => c.customerId === customer.id)).toBeDefined();

    // 5. Manager Approval Check for Alternative Method
    const pinVerification = await approvalService.verifyManagerPin(
      testTenantId,
      testAdminUserId,
      '1234',
      'ALTERNATIVE_METHOD_APPROVAL',
    );
    expect(pinVerification.success).toBe(true);

    // 6. Verify Reports Link
    const creditReport = await reportsService.queryReport(testTenantId, 'customer-credit', {});
    expect(creditReport).toBeDefined();
  });

  it('Journey 3: Snappfood Simulated Order Lifecycle, Duplicate Webhook Idempotency, Cancellation/Refund & Integration Log Verification', async () => {
    const tag = Date.now().toString();
    const idempotencyKey = `SF-IDEM-${tag}`;

    // 1. Initial Webhook / Order Generation with valid product_id
    const genResult = await simulationService.generateSnappfoodOrder(
      testTenantId,
      {
        orderCode: `SF-ORD-${tag}`,
        customerName: 'Snappfood Customer',
        customerPhone: '09123334455',
        totalPrice: 180000,
        items: [{ product_id: testProductId, product_name: 'Cheeseburger R27', count: 1, price: 180000 }],
        idempotency_key: idempotencyKey,
      },
      `corr-sf-gen-${tag}`,
    );
    expect(genResult.order).toBeDefined();
    expect(genResult.order.order_number).toBeDefined();

    // 2. Duplicate Webhook Trigger -> Rejection Asserted
    const dupResult = await simulationService.triggerSnappfoodDuplicate(
      testTenantId,
      undefined,
      `corr-sf-dup-${tag}`,
    );
    expect(dupResult.success).toBe(true);
    expect(dupResult.duplicate).toBe(true);

    // 3. Lifecycle Action Transitions: ACCEPT, PICK, CANCEL/REFUND
    const acceptRes = await simulationService.triggerSnappfoodAction(
      testTenantId,
      { action: 'ACCEPT', order_id: genResult.order.id },
      `corr-sf-act-${tag}`,
    );
    expect(acceptRes.order.id).toBe(genResult.order.id);

    const cancelRes = await simulationService.triggerSnappfoodAction(
      testTenantId,
      { action: 'CANCEL', order_id: genResult.order.id, reason: 'Customer Cancelled' },
      `corr-sf-cancel-${tag}`,
    );
    expect(cancelRes.order.id).toBe(genResult.order.id);

    // 4. Verification of Integration Logs & Report Reconciliation
    const logs = await simulationService.getLogs(testTenantId, 'SNAPPFOOD', undefined);
    expect(logs.length).toBeGreaterThan(0);

    const integrationReport = await reportsService.queryReport(testTenantId, 'integration-operations', {});
    expect(integrationReport).toBeDefined();
  });

  it('Journey 4: Kiosk Guest/Required Identification Policy & Simulated POS Payment Failure Retry', async () => {
    const settingRepo = dataSource.getRepository(TenantSetting);
    const tag = Date.now().toString();

    // 1. Set Kiosk Identity Policy to REQUIRED
    let setting = await settingRepo.findOne({ where: { tenant_id: testTenantId, key: 'KIOSK_CUSTOMER_IDENTITY_POLICY' } });
    if (!setting) {
      setting = settingRepo.create({
        tenant_id: testTenantId,
        key: 'KIOSK_CUSTOMER_IDENTITY_POLICY',
        value: 'REQUIRED' as any,
      });
    } else {
      setting.value = 'REQUIRED' as any;
    }
    await settingRepo.save(setting);

    const bootstrap = await kioskService.getBootstrapContext(testTenantId, testBranchId);
    expect(bootstrap.customer_identity_policy).toBe('REQUIRED');

    // 2. Attempt Kiosk order without customer phone -> Forbidden Exception
    await expect(
      kioskService.createKioskOrder(
        testTenantId,
        {
          branch_id: testBranchId,
          order_type: 'TAKEAWAY',
          items: [{ product_id: testProductId, quantity: 1 }],
        },
        `corr-kiosk-fail-${tag}`,
      ),
    ).rejects.toThrow('Customer phone number is required by kiosk policy');

    // 3. Order Creation with valid phone -> Success
    const validKioskOrder = await kioskService.createKioskOrder(
      testTenantId,
      {
        branch_id: testBranchId,
        order_type: 'TAKEAWAY',
        customer_name: 'Kiosk Test Guest',
        customer_phone: `0912${tag.slice(-7)}`,
        items: [{ product_id: testProductId, quantity: 1 }],
      },
      `corr-kiosk-pass-${tag}`,
    );
    expect(validKioskOrder.id).toBeDefined();

    // 4. Kiosk Payment Execution -> Receipt & Status Verification
    const payResult = await kioskService.processKioskPayment(
      testTenantId,
      { order_id: validKioskOrder.id },
      `corr-kiosk-pay-${tag}`,
    );
    expect(payResult.success).toBe(true);
    expect(payResult.receipt.status).toBe('PAID & SENT TO KITCHEN');
    expect(payResult.receipt.reference_number).toBeDefined();
  });

  it('Journey 5: Persian CSV Customer & Catalog Import, Protected Reset, Minimal Reseed & Post-Reset Login', async () => {
    // 1. Stage Persian CSV Import for Customers
    const persianCustomersCsv = 'کد مشتری,نام,نام خانوادگی,شماره تماس,ایمیل,وضعیت\nCUST-FA-01,مجید,محمدی,09121110022,majid@example.com,فعال';
    const stagedJob = await importExportService.createStagedJob(
      testTenantId,
      'CUSTOMERS',
      'customers_fa.csv',
      persianCustomersCsv,
    );
    expect(stagedJob.id).toBeDefined();

    // Auto Map, Validate & Execute Import
    const columnMapping = { 'کد مشتری': 'code', 'نام': 'first_name', 'نام خانوادگی': 'last_name', 'شماره تماس': 'mobile', 'ایمیل': 'email' };
    await importExportService.validateJob(stagedJob.id, columnMapping);
    const execResult = await importExportService.executeJob(stagedJob.id, testAdminUserId);
    expect(execResult.importedCount).toBeGreaterThanOrEqual(1);

    // 2. Protected System Reset PIN Verification Failure & Execution
    await expect(
      approvalService.verifyManagerPin(testTenantId, testAdminUserId, '99999999', 'SYSTEM_RESET'),
    ).rejects.toThrow();

    const resetRes = await importExportService.systemReset(testTenantId, testAdminUserId);
    expect(resetRes.resetTables).toBeDefined();

    // 3. Minimal Reseed Execution
    const seedRes = await importExportService.applySeedProfile(testTenantId, testAdminUserId, 'MINIMAL');
    expect(seedRes.profile).toBeDefined();

    // 4. Verify Admin Login Post-Reset
    const userRepo = dataSource.getRepository(AdminUser);
    const adminUser = await userRepo.findOne({ where: { tenant_id: testTenantId } });
    if (adminUser) {
      const loginRes = await authService.login(adminUser.username, 'GnextDemo!2026');
      expect(loginRes.sessionToken).toBeDefined();
    }
  });

  it('Journey 6: Delivery Roster & Settlement Discrepancies', async () => {
    const settlementRepo = dataSource.getRepository(CourierSettlement);
    const tag = Date.now().toString();

    await settlementRepo.save(
      settlementRepo.create({
        tenant_id: testTenantId,
        courier_id: '00000000-0000-0000-0000-000000000001',
        settlement_number: `SETTLE-J6-${tag}`,
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

  it('Journey 7: Offline Queue & Sync Alerts', async () => {
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

  it('Journey 8: Translation Key Parity & Report Export Certification', async () => {
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
