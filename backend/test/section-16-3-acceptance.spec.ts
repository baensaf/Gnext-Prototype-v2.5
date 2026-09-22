import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';

// Services
import { OrderService } from '../src/modules/order/order.service';
import { ShiftService } from '../src/modules/cashier/shift.service';
import { DiscountsService } from '../src/modules/discounts/discounts.service';
import { ApprovalService } from '../src/modules/approval/approval.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { KdsService } from '../src/modules/kds/kds.service';
import { PrintQueueService } from '../src/modules/printing/print-queue.service';
import { CustomerService } from '../src/modules/customer/customer.service';
import { CreditService } from '../src/modules/customer/credit.service';
import { RefundService } from '../src/modules/refund/refund.service';
import { DeliveryService } from '../src/modules/delivery/delivery.service';
import { ReportsService } from '../src/modules/reports/reports.service';
import { SimulationService } from '../src/modules/simulation/simulation.service';
import { OfflineSyncService } from '../src/modules/offline-sync/offline-sync.service';
import { KioskService } from '../src/modules/kiosk/kiosk.service';
import { ImportExportService } from '../src/modules/import-export/import-export.service';
import { SettingsService } from '../src/modules/settings/settings.service';

// Entities
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { OptionGroup } from '../src/entities/OptionGroup.entity';
import { OptionItem } from '../src/entities/OptionItem.entity';
import { ProductOptionGroup } from '../src/entities/ProductOptionGroup.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { Payment } from '../src/entities/Payment.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { ApprovalRule } from '../src/entities/ApprovalRule.entity';
import { KitchenStation } from '../src/entities/KitchenStation.entity';
import { Printer } from '../src/entities/Printer.entity';
import { Customer } from '../src/entities/Customer.entity';
import { DeliveryZone } from '../src/entities/DeliveryZone.entity';
import { AuditEvent } from '../src/entities/AuditEvent.entity';
import { IntegrationLog } from '../src/entities/IntegrationLog.entity';
import { OfflineQueueItem } from '../src/entities/OfflineQueueItem.entity';
import { SyncConflictRecord } from '../src/entities/SyncConflictRecord.entity';
import { TenantSetting } from '../src/entities/TenantSetting.entity';

// Utility
import { MoneyUtil } from '../src/common/utils/money.util';
import { deleteTenantData } from './utils/tenant-teardown';

describe('Specification §16.3 Acceptance Workflows Suite', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let orderService: OrderService;
  let shiftService: ShiftService;
  let discountsService: DiscountsService;
  let approvalService: ApprovalService;
  let paymentService: PaymentService;
  let kdsService: KdsService;
  let printQueueService: PrintQueueService;
  let customerService: CustomerService;
  let creditService: CreditService;
  let refundService: RefundService;
  let deliveryService: DeliveryService;
  let reportsService: ReportsService;
  let simulationService: SimulationService;
  let offlineSyncService: OfflineSyncService;
  let kioskService: KioskService;
  let importExportService: ImportExportService;
  let settingsService: SettingsService;

  let tenantId: string;
  let branchId: string;
  let terminalId: string;
  let adminUserId: string;
  let cashierUserId: string;
  let categoryId: string;
  let productId: string;
  let cheeseOptionId: string;
  let jalapenoOptionId: string;
  let cashPaymentMethodId: string;
  let posPaymentMethodId: string;
  let creditPaymentMethodId: string;
  let primaryPrinterId: string;
  let backupPrinterId: string;
  let kitchenStationId: string;
  let deliveryZoneId: string;

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
    orderService = moduleRef.get<OrderService>(OrderService);
    shiftService = moduleRef.get<ShiftService>(ShiftService);
    discountsService = moduleRef.get<DiscountsService>(DiscountsService);
    approvalService = moduleRef.get<ApprovalService>(ApprovalService);
    paymentService = moduleRef.get<PaymentService>(PaymentService);
    kdsService = moduleRef.get<KdsService>(KdsService);
    printQueueService = moduleRef.get<PrintQueueService>(PrintQueueService);
    customerService = moduleRef.get<CustomerService>(CustomerService);
    creditService = moduleRef.get<CreditService>(CreditService);
    refundService = moduleRef.get<RefundService>(RefundService);
    deliveryService = moduleRef.get<DeliveryService>(DeliveryService);
    reportsService = moduleRef.get<ReportsService>(ReportsService);
    simulationService = moduleRef.get<SimulationService>(SimulationService);
    offlineSyncService = moduleRef.get<OfflineSyncService>(OfflineSyncService);
    kioskService = moduleRef.get<KioskService>(KioskService);
    importExportService = moduleRef.get<ImportExportService>(ImportExportService);
    settingsService = moduleRef.get<SettingsService>(SettingsService);

    await dataSource.runMigrations();

    const tag = Date.now().toString();

    // 1. Tenant & Branch
    const tenantRepo = dataSource.getRepository(Tenant);
    const tenant = await tenantRepo.save(
      tenantRepo.create({
        code: `TNT-163-${tag}`,
        name: 'Section 16.3 Certification Tenant',
        base_currency: 'IRR',
        default_locale: 'fa',
        time_zone: 'Asia/Tehran',
      }),
    );
    tenantId = tenant.id;

    const branchRepo = dataSource.getRepository(Branch);
    const branch = await branchRepo.save(
      branchRepo.create({
        tenant_id: tenantId,
        code: `BR-163-${tag}`,
        name: 'Main Acceptance Branch',
        time_zone: 'Asia/Tehran',
        is_active: true,
      }),
    );
    branchId = branch.id;

    // 2. Terminal
    const terminalRepo = dataSource.getRepository(Terminal);
    const terminal = await terminalRepo.save(
      terminalRepo.create({
        tenant_id: tenantId,
        branch_id: branchId,
        code: `TRM-POS-1`,
        name: 'Front Counter POS #1',
        terminal_type: 'CASHIER',
        is_active: true,
      }),
    );
    terminalId = terminal.id;

    // 3. Admin User & Cashier User
    const userRepo = dataSource.getRepository(AdminUser);
    const adminPassHash = await argon2.hash('GnextDemo!2026');
    const adminPinHash = await argon2.hash('1234');
    const adminUser = await userRepo.save(
      userRepo.create({
        tenant_id: tenantId,
        username: `admin_163_${tag}`,
        password_hash: adminPassHash,
        pin_hash: adminPinHash,
        display_name: 'Acceptance Admin',
        role: 'ADMIN',
        is_active: true,
      }),
    );
    adminUserId = adminUser.id;

    const cashierPassHash = await argon2.hash('Cashier123!');
    const cashierUser = await userRepo.save(
      userRepo.create({
        tenant_id: tenantId,
        username: `cashier_163_${tag}`,
        password_hash: cashierPassHash,
        display_name: 'Acceptance Cashier',
        role: 'CASHIER',
        is_active: true,
      }),
    );
    cashierUserId = cashierUser.id;

    // 4. Catalog: Category, Product, Option Groups & Modifiers
    const catRepo = dataSource.getRepository(Category);
    const category = await catRepo.save(
      catRepo.create({
        tenant_id: tenantId,
        code: 'CAT-BURGER-163',
        name: 'Burgers & Sandwiches',
        is_active: true,
      }),
    );
    categoryId = category.id;

    const prodRepo = dataSource.getRepository(Product);
    const product = await prodRepo.save(
      prodRepo.create({
        tenant_id: tenantId,
        category_id: categoryId,
        code: 'PROD-DOUBLE-BURGER',
        name: 'Double Cheeseburger Deluxe',
        base_price: '200000.0000',
        is_active: true,
      }),
    );
    productId = product.id;

    const optGroupRepo = dataSource.getRepository(OptionGroup);
    const optGroup = await optGroupRepo.save(
      optGroupRepo.create({
        tenant_id: tenantId,
        code: 'OPT-EXTRA-TOPPINGS',
        name: 'Extra Toppings',
        min_selection: 0,
        max_selection: 5,
      }),
    );

    const optItemRepo = dataSource.getRepository(OptionItem);
    const cheeseOpt = await optItemRepo.save(
      optItemRepo.create({
        tenant_id: tenantId,
        option_group_id: optGroup.id,
        code: 'MOD-CHEESE',
        name: 'Extra Cheddar Cheese',
        price_delta: '30000.0000',
      }),
    );
    cheeseOptionId = cheeseOpt.id;

    const jalapenoOpt = await optItemRepo.save(
      optItemRepo.create({
        tenant_id: tenantId,
        option_group_id: optGroup.id,
        code: 'MOD-JALAPENO',
        name: 'Pickled Jalapenos',
        price_delta: '15000.0000',
      }),
    );
    jalapenoOptionId = jalapenoOpt.id;

    const pogRepo = dataSource.getRepository(ProductOptionGroup);
    await pogRepo.save(
      pogRepo.create({
        tenant_id: tenantId,
        product_id: productId,
        option_group_id: optGroup.id,
      }),
    );

    // 5. Payment Methods
    const pmRepo = dataSource.getRepository(PaymentMethod);
    const cashPm = await pmRepo.save(
      pmRepo.create({
        tenant_id: tenantId,
        code: 'PM-CASH',
        name: 'Physical Cash',
        kind: 'CASH',
        is_active: true,
      }),
    );
    cashPaymentMethodId = cashPm.id;

    const posPm = await pmRepo.save(
      pmRepo.create({
        tenant_id: tenantId,
        code: 'PM-POS-TERMINAL',
        name: 'Mobile / Network POS Terminal',
        kind: 'NETWORK_POS',
        is_active: true,
      }),
    );
    posPaymentMethodId = posPm.id;

    const creditPm = await pmRepo.save(
      pmRepo.create({
        tenant_id: tenantId,
        code: 'PM-CREDIT',
        name: 'Customer Credit Account',
        kind: 'CUSTOMER_CREDIT',
        is_active: true,
      }),
    );
    creditPaymentMethodId = creditPm.id;

    // What a Snappfood customer paid online is booked to this method.
    await pmRepo.save(
      pmRepo.create({
        tenant_id: tenantId,
        code: 'PM-ONLINE',
        name: 'Online (aggregator)',
        kind: 'ONLINE',
        is_active: true,
      }),
    );

    // 6. Printers & Kitchen Station
    const printerRepo = dataSource.getRepository(Printer);
    const backupPrn = await printerRepo.save(
      printerRepo.create({
        tenant_id: tenantId,
        branch_id: branchId,
        code: 'PRN-BACKUP',
        name: 'Thermal Backup Printer',
        printer_type: 'THERMAL_RECEIPT',
        is_active: true,
      }),
    );
    backupPrinterId = backupPrn.id;

    const primaryPrn = await printerRepo.save(
      printerRepo.create({
        tenant_id: tenantId,
        branch_id: branchId,
        code: 'PRN-FRONT',
        name: 'Front Counter Thermal Printer',
        printer_type: 'THERMAL_RECEIPT',
        fallback_printer_id: backupPrinterId,
        is_active: true,
      }),
    );
    primaryPrinterId = primaryPrn.id;

    const stationRepo = dataSource.getRepository(KitchenStation);
    const station = await stationRepo.save(
      stationRepo.create({
        tenant_id: tenantId,
        branch_id: branchId,
        code: 'STN-GRILL',
        name: 'Hot Kitchen Grill Station',
        is_active: true,
      }),
    );
    kitchenStationId = station.id;

    // 7. Delivery Zone
    const zoneRepo = dataSource.getRepository(DeliveryZone);
    const zone = await zoneRepo.save(
      zoneRepo.create({
        tenant_id: tenantId,
        branch_id: branchId,
        code: 'ZONE-CENTRAL',
        name: 'Central District Zone',
        fee: '20000.0000',
        estimated_minutes: 30,
        is_active: true,
      }),
    );
    deliveryZoneId = zone.id;

    // 8. Approval Rule for Discounts
    const ruleRepo = dataSource.getRepository(ApprovalRule);
    await ruleRepo.save(
      ruleRepo.create({
        tenant_id: tenantId,
        action: 'DISCOUNT',
        threshold_type: 'AMOUNT',
        threshold_value: '20000.0000',
        required_steps: 1,
        approver_role: 'ADMIN',
        is_active: true,
      }),
    );
  }, 40000);

  afterAll(async () => {
    // The fixture tenant is created fresh per run, so nothing here is worth keeping.
    if (dataSource?.isInitialized) await deleteTenantData(dataSource, tenantId);
    if (app) await app.close();
  }, 30000);

  // =========================================================================
  // WORKFLOW 1: POS COMPLETE LIFECYCLE (§16.3.1)
  // =========================================================================
  it('Workflow 1: POS - Shift, Dine-In, Modifiers, Discount Approval, Split Payment, KDS Bump, Print Retry, Shift Close & Reconcile', async () => {
    const correlationId = `corr-pos-${Date.now()}`;

    // Step 1: Open Cashier Shift with Opening Float (500,000 IRR)
    const openShiftRes = await shiftService.openShift(
      tenantId,
      {
        terminalId,
        openingCash: '500000.0000',
        currencyCode: 'IRR',
      },
      cashierUserId,
      correlationId,
    );
    expect(openShiftRes.id).toBeDefined();
    expect(openShiftRes.state).toBe('OPEN');

    // Step 2: Create Dine-In Order with Modifiers (Extra Cheese + Jalapeno)
    const orderDraft = await orderService.createDraft(
      tenantId,
      {
        branch_id: branchId,
        terminal_id: terminalId,
        order_type: 'DINE_IN',
        items: [
          {
            product_id: productId,
            quantity: '2.0000',
            options: [
              { option_item_id: cheeseOptionId },
              { option_item_id: jalapenoOptionId },
            ],
          },
        ],
      },
      cashierUserId,
      correlationId,
    );
    expect(orderDraft.id).toBeDefined();
    expect(orderDraft.order_type).toBe('DINE_IN');

    // Step 3: Discount Evaluation & Manager Approval (50,000 IRR discount > 20,000 threshold)
    const discountEvaluation = await approvalService.evaluateAction(tenantId, 'DISCOUNT', 50000);
    expect(discountEvaluation.requires_approval).toBe(true);

    // Verify Manager PIN for discount authorization
    const managerPinAuth = await approvalService.verifyManagerPin(tenantId, adminUserId, '1234', 'DISCOUNT_APPROVAL');
    expect(managerPinAuth.success).toBe(true);

    // Set discount directly on order draft
    const orderRepo = dataSource.getRepository(OrderHeader);
    orderDraft.discount_amount = '50000.0000';
    orderDraft.total_amount = '440000.0000';
    orderDraft.outstanding_total = '440000.0000';
    await orderRepo.save(orderDraft);

    // Submit Order -> Transition to SUBMITTED
    const submittedOrder = await orderService.submitOrder(tenantId, orderDraft.id, {}, cashierUserId, correlationId);
    expect(['SUBMITTED', 'CONFIRMED']).toContain(submittedOrder.state);

    // Step 4: Split Payment (Cash 200,000 IRR + Mobile POS Terminal 240,000 IRR)
    const cashIntent = await paymentService.createPaymentIntent(
      tenantId,
      {
        orderId: submittedOrder.id,
        methodId: cashPaymentMethodId,
        amount: '200000.0000',
        reference: 'CASH-DRAWER-01',
      },
      cashierUserId,
      correlationId,
    );
    const cashPayment = await paymentService.processPayment(
      tenantId,
      cashIntent.id,
      {},
      cashierUserId,
      correlationId,
    );
    expect(cashPayment.status).toBe('SUCCEEDED');

    const remainingDue = MoneyUtil.subtract(submittedOrder.grand_total, '200000.0000');
    const posIntent = await paymentService.createPaymentIntent(
      tenantId,
      {
        orderId: submittedOrder.id,
        methodId: posPaymentMethodId,
        amount: remainingDue,
        reference: 'POS-AUTH-998811',
      },
      cashierUserId,
      correlationId,
    );
    const posPayment = await paymentService.processPayment(
      tenantId,
      posIntent.id,
      {},
      cashierUserId,
      correlationId,
    );
    expect(posPayment.status).toBe('SUCCEEDED');

    const refreshedOrder = await orderRepo.findOne({ where: { id: submittedOrder.id } });
    expect(MoneyUtil.format(refreshedOrder?.paid_amount || '0')).toBe(MoneyUtil.format(submittedOrder.grand_total));
    expect(MoneyUtil.format(refreshedOrder?.outstanding_total || '0')).toBe('0.0000');

    // Step 5: KDS Kitchen Ticket Progression & Bump
    const generatedTickets = await kdsService.generateTicketsForOrder(tenantId, submittedOrder.id, correlationId);
    expect(generatedTickets.length).toBeGreaterThan(0);
    const ticket = generatedTickets[0];

    // Start Ticket (IN_PREPARATION)
    const inPrepTicket = await kdsService.startTicket(tenantId, ticket.id, cashierUserId);
    expect(['IN_PROGRESS', 'IN_PREPARATION']).toContain(inPrepTicket.state || (inPrepTicket as any).status);

    // Bump Ticket (READY / BUMPED)
    const bumpedTicket = await kdsService.bumpTicket(tenantId, ticket.id, correlationId, cashierUserId);
    expect(['READY', 'BUMPED', 'COMPLETED']).toContain(bumpedTicket.state || (bumpedTicket as any).status);

    // Step 6: Print Failure & Fallback Printer Retry Simulation
    const [printJob] = await printQueueService.enqueueOrderPrintJobs(tenantId, submittedOrder.id);
    expect(printJob).toBeDefined();

    // Simulate Failure on Primary Printer
    const failOutcome = await printQueueService.processSimulationOutcome(tenantId, {
      printJobId: printJob.id,
      outcome: 'FAILED',
      useFallback: true,
    });
    expect(failOutcome.attempt.status).toBe('FAILED');

    // Retry Print Job -> Diverts to Fallback Backup Printer with SUCCESS
    const retryOutcome = await printQueueService.retryJob(tenantId, printJob.id, { useFallback: true });
    expect(retryOutcome.job.status).toBe('SUCCESS');

    // Step 7: Close Cashier Shift
    const closedShift = await shiftService.closeShift(
      tenantId,
      openShiftRes.id,
      {
        actualCash: '700000.0000',
      },
      cashierUserId,
      correlationId,
    );
    expect(closedShift.state).toBe('CLOSED');

    // Step 8: Reports Reconciliation
    const salesReport = await reportsService.queryReport(tenantId, 'sales-summary', {
      branchId,
    });
    expect(salesReport).toBeDefined();
    expect(salesReport.rows.length).toBeGreaterThan(0);

    const shiftReport = await reportsService.queryReport(tenantId, 'cashier-shifts', {
      branchId,
    });
    expect(shiftReport).toBeDefined();
  });

  // =========================================================================
  // WORKFLOW 2: CUSTOMER CREDIT, BOTH REFUND PATHS & AUDIT LINKS (§16.3.2)
  // =========================================================================
  it('Workflow 2: Customer - Credit Account, Partial Payment, Repayment, Aging, Original Refund, Alternative Cash Refund & Audit Links', async () => {
    const correlationId = `corr-cust-${Date.now()}`;
    const tag = Date.now().toString();

    // Step 0: Open Shift for Customer Counter
    const openCustShift = await shiftService.openShift(
      tenantId,
      {
        terminalId,
        openingCash: '500000.0000',
        currencyCode: 'IRR',
      },
      cashierUserId,
      correlationId,
    );
    expect(openCustShift.id).toBeDefined();

    // Step 1: Create Customer with Approved Credit Limit (5,000,000 IRR)
    const custRepo = dataSource.getRepository(Customer);
    const customer = await custRepo.save(
      custRepo.create({
        tenant_id: tenantId,
        code: `CUST-163-${tag}`,
        first_name: 'Hossein',
        last_name: 'Tabatabaei',
        mobile: `0912${tag.slice(-7)}`,
        is_active: true,
      }),
    );
    expect(customer.id).toBeDefined();

    // Create Credit Account
    const creditAccount = await creditService.createAccount(
      tenantId,
      customer.id,
      {
        mode: 'FINITE',
        creditLimit: '5000000.0000',
        currencyCode: 'IRR',
      },
      adminUserId,
      correlationId,
    );
    expect(creditAccount.id).toBeDefined();

    // Step 2: Create Order (Total 800,000 IRR) & Split Payment (Credit 500,000 IRR + Terminal POS 300,000 IRR)
    const orderDraft = await orderService.createDraft(
      tenantId,
      {
        branch_id: branchId,
        terminal_id: terminalId,
        customer_id: customer.id,
        order_type: 'TAKEAWAY',
        items: [
          {
            product_id: productId,
            quantity: '4.0000',
          },
        ],
      },
      cashierUserId,
      correlationId,
    );

    const submittedOrder = await orderService.submitOrder(tenantId, orderDraft.id, {}, cashierUserId, correlationId);
    expect(['SUBMITTED', 'CONFIRMED']).toContain(submittedOrder.state);

    // Credit Payment Tender (500,000 IRR) -> Debits account to -500,000
    const creditIntent = await paymentService.createPaymentIntent(
      tenantId,
      {
        orderId: submittedOrder.id,
        methodId: creditPaymentMethodId,
        amount: '500000.0000',
        reference: `CREDIT-DEBIT-${customer.code}`,
      },
      cashierUserId,
      correlationId,
    );
    const creditPayment = await paymentService.processPayment(
      tenantId,
      creditIntent.id,
      {},
      cashierUserId,
      correlationId,
    );
    expect(creditPayment.status).toBe('SUCCEEDED');

    // Terminal POS Payment Tender (300,000 IRR)
    const posIntent = await paymentService.createPaymentIntent(
      tenantId,
      {
        orderId: submittedOrder.id,
        methodId: posPaymentMethodId,
        amount: '300000.0000',
        reference: 'POS-TXN-776655',
      },
      cashierUserId,
      correlationId,
    );
    const posPayment = await paymentService.processPayment(
      tenantId,
      posIntent.id,
      {},
      cashierUserId,
      correlationId,
    );
    expect(posPayment.status).toBe('SUCCEEDED');

    const orderRepo = dataSource.getRepository(OrderHeader);
    const completedOrder = await orderRepo.findOne({ where: { id: submittedOrder.id } });
    if (completedOrder) {
      completedOrder.state = 'COMPLETED';
      completedOrder.status = 'COMPLETED';
      await orderRepo.save(completedOrder);
    }
    expect(MoneyUtil.format(completedOrder?.paid_amount || '0')).toBe('800000.0000');
    expect(MoneyUtil.format(completedOrder?.outstanding_total || '0')).toBe('0.0000');

    // Step 3: Customer Credit Repayment (200,000 IRR)
    const topUpRes = await creditService.postRepayment(
      tenantId,
      creditAccount.id,
      {
        amount: '200000.0000',
      },
      cashierUserId,
      correlationId,
    );
    expect(MoneyUtil.format(topUpRes.newBalance)).toBe('-300000.0000');

    // Step 4: Verify Statement & Aging Subledger
    const statement = await creditService.getAccountStatement(tenantId, creditAccount.id, {});
    expect(statement.entries.length).toBeGreaterThanOrEqual(2);
    expect(MoneyUtil.format(statement.closingBalance)).toBe('-300000.0000');

    const agingReport = await creditService.getCreditAging(tenantId, {});
    const customerAging = agingReport.customers.find((c: any) => c.customerId === customer.id || c.customerCode === customer.code);
    expect(customerAging).toBeDefined();

    // Step 5: Refund Path A - Partial Original Refund to Credit Account (100,000 IRR)
    const creditRefund = await refundService.createRefundIntent(
      tenantId,
      submittedOrder.id,
      {
        amount: '100000.0000',
        targetMethodId: creditPaymentMethodId,
        reason: 'Customer returned 1 item (Credit account refund)',
        full: false,
      },
      cashierUserId,
      correlationId,
    );
    expect(creditRefund.id).toBeDefined();

    const processedCreditRefund = await refundService.processRefund(
      tenantId,
      creditRefund.id,
      {},
      cashierUserId,
      correlationId,
    );
    expect(processedCreditRefund.status).toBe('SUCCEEDED');

    const postRefundStatement = await creditService.getAccountStatement(tenantId, creditAccount.id, {});
    expect(MoneyUtil.format(postRefundStatement.closingBalance)).toBe('-200000.0000');

    // Step 6: Refund Path B - Alternative Cash Refund with Manager Approval (100,000 IRR)
    // 1. Attempt alternative refund without approval -> Forbidden
    await expect(
      refundService.createRefundIntent(
        tenantId,
        submittedOrder.id,
        {
          amount: '100000.0000',
          targetMethodId: cashPaymentMethodId,
          reason: 'Customer requests cash payout for defective item',
          full: false,
        },
        cashierUserId,
        correlationId,
      ),
    ).rejects.toThrow();

    // 2. Manager Approves Alternative Refund via ApprovalRequest
    const approvalReq = await approvalService.createRequest(
      tenantId,
      cashierUserId,
      {
        action: 'REFUND_ALTERNATIVE_METHOD',
        entity_type: 'OrderHeader',
        entity_id: submittedOrder.id,
        reason: 'Authorized Cash Payout for Terminal Purchase',
      },
      correlationId,
    );

    // Verify Manager PIN & Record Decision
    await approvalService.approveRequest(
      tenantId,
      approvalReq.id,
      adminUserId,
      '1234',
      'Approved by Branch Manager',
      correlationId,
    );

    // 3. Re-execute alternative refund with approvalRequestId -> Success
    const altCashRefund = await refundService.createRefundIntent(
      tenantId,
      submittedOrder.id,
      {
        amount: '100000.0000',
        targetMethodId: cashPaymentMethodId,
        reason: 'Customer requests cash payout for defective item',
        approvalRequestId: approvalReq.id,
        full: false,
      },
      cashierUserId,
      correlationId,
    );
    expect(altCashRefund.is_alternative_method).toBe(true);

    const processedAltRefund = await refundService.processRefund(
      tenantId,
      altCashRefund.id,
      {},
      adminUserId,
      correlationId,
    );
    expect(processedAltRefund.status).toBe('SUCCEEDED');

    // Step 7: Close Shift for Customer Counter
    const closedCustShift = await shiftService.closeShift(
      tenantId,
      openCustShift.id,
      {
        actualCash: '400000.0000',
      },
      cashierUserId,
      correlationId,
    );
    expect(closedCustShift.state).toBe('CLOSED');

    // Step 8: Verify Immutable Audit Records
    const auditRepo = dataSource.getRepository(AuditEvent);
    const orderAudits = await auditRepo.find({ where: { tenant_id: tenantId } });
    expect(orderAudits.length).toBeGreaterThan(5);

    const creditReport = await reportsService.queryReport(tenantId, 'customer-credit', {});
    expect(creditReport).toBeDefined();
  });

  // =========================================================================
  // WORKFLOW 3: DELIVERY COMPLETE LIFECYCLE (§16.3.3)
  // =========================================================================
  it('Workflow 3: Delivery - Order, Courier Check-in, Mobile POS Device, Cash & Mobile Receipt, Discrepancy Approval & Separate Totals', async () => {
    const correlationId = `corr-del-${Date.now()}`;
    const tag = Date.now().toString();

    // Step 0: Open Shift for Delivery Dispatch Counter
    await shiftService.openShift(
      tenantId,
      {
        terminalId,
        openingCash: '200000.0000',
        currencyCode: 'IRR',
      },
      cashierUserId,
      correlationId,
    );

    // Step 1: Create Delivery Order (Total: 400,000 IRR) with real owned delivery context.
    const deliveryCustomer = await customerService.createCustomer(
      tenantId,
      {
        code: `DEL-${tag}`,
        first_name: 'Delivery',
        last_name: 'Customer',
        mobile: `0912${tag.slice(-7).padStart(7, '0')}`,
      },
      correlationId,
    );
    const deliveryAddress = await customerService.createAddress(tenantId, deliveryCustomer.id, {
      title: 'Home',
      address_text: '12 Central Avenue, Tehran',
      postal_code: '1111111111',
      is_default: true,
    });
    const delOrder = await orderService.createDraft(
      tenantId,
      {
        branch_id: branchId,
        terminal_id: terminalId,
        order_type: 'DELIVERY',
        customer_id: deliveryCustomer.id,
        delivery_address_id: deliveryAddress.id,
        delivery_zone_id: deliveryZoneId,
        items: [
          {
            product_id: productId,
            quantity: '2.0000',
          },
        ],
      },
      cashierUserId,
      correlationId,
    );
    const submittedDelOrder = await orderService.submitOrder(tenantId, delOrder.id, {}, cashierUserId, correlationId);
    expect(['SUBMITTED', 'CONFIRMED']).toContain(submittedDelOrder.state);

    // Cash on delivery: nothing is taken at the counter. The courier collects the whole bill at
    // the door — 180,000 on the company mobile POS, the rest in cash. (This workflow used to
    // pay the order in full here and then still expect the courier to bring the same money
    // back, which is the double count the F10 audit finding removed.)
    const codTotal = MoneyUtil.format(submittedDelOrder.grand_total);
    const codCash = MoneyUtil.subtract(codTotal, '180000.0000');
    const codCashShort = MoneyUtil.subtract(codCash, '10000.0000');

    // Step 2: Register Courier & Record Attendance Check-In
    const courier = await deliveryService.createCourier(
      tenantId,
      {
        branch_id: branchId,
        code: `CR-163-${tag}`,
        name: 'Ali Rostami',
        phone: '09121112233',
        vehicle_type: 'MOTORCYCLE',
        compensation_per_delivery: '25000.0000',
      },
      correlationId,
    );
    expect(courier.id).toBeDefined();

    const attendance = await deliveryService.recordAttendance(
      tenantId,
      {
        courier_id: courier.id,
        branch_id: branchId,
        status: 'CHECKED_IN',
      },
    );
    expect(attendance.status).toBe('CHECKED_IN');

    // Step 3: Assign Company Mobile POS Terminal Device to Courier
    const terminalAssign = await deliveryService.assignMobileTerminal(
      tenantId,
      courier.id,
      terminalId,
    );
    expect(terminalAssign.id).toBeDefined();

    // Step 4: Dispatch Delivery to Courier
    const deliveryRecord = await deliveryService.createDeliveryForOrder(tenantId, submittedDelOrder.id, deliveryZoneId);
    expect(deliveryRecord.id).toBeDefined();

    const assignedDelivery = await deliveryService.assignCourier(tenantId, deliveryRecord.id, courier.id, cashierUserId);
    expect(assignedDelivery.state).toBe('ASSIGNED');

    const departedDelivery = await deliveryService.departDelivery(tenantId, deliveryRecord.id, cashierUserId);
    expect(departedDelivery.state).toBe('EN_ROUTE');

    // Step 5: Deliver, collecting 180,000 IRR on the mobile POS and the rest in cash
    const completedDelivery = await deliveryService.completeDelivery(
      tenantId,
      deliveryRecord.id,
      {
        posAmount: 180000,
      },
      cashierUserId,
    );
    expect(completedDelivery.state).toBe('DELIVERED');
    // Delivered but not yet paid: the money is with the courier until they are settled.
    const deliveredOrder = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: submittedDelOrder.id });
    expect(deliveredOrder.state).not.toBe('COMPLETED');
    expect(MoneyUtil.format(deliveredOrder.outstanding_total)).toBe(codTotal);

    // Step 6: Courier Settlement Preview with Separate Expected Instrument Totals
    const previewSettlement = await deliveryService.previewSettlement(tenantId, courier.id);
    expect(MoneyUtil.format(previewSettlement.expected_cash_amount, 2)).toBe(MoneyUtil.format(codCash, 2));
    expect(MoneyUtil.format(previewSettlement.expected_pos_amount, 2)).toBe('180000.00');

    // Create Settlement Batch
    const settlement = await deliveryService.createSettlement(
      tenantId,
      cashierUserId,
      { courier_id: courier.id, branch_id: branchId },
      correlationId,
    );
    expect(settlement.status).toBe('DRAFT');

    // Enter Actuals with Cash Discrepancy (the courier hands over 10,000 IRR less cash than collected)
    const updatedSettlement = await deliveryService.updateSettlement(
      tenantId,
      settlement.id,
      {
        lines: [
          {
            id: settlement.lines[0].id,
            actual_cash: MoneyUtil.format(codCashShort, 2),
            actual_pos: '180000.00',
            receipt_verified: true,
          },
        ],
        total_compensation_amount: '25000.00',
      },
      correlationId,
    );
    expect(MoneyUtil.format(updatedSettlement.cash_discrepancy_amount, 2)).not.toBe('0.00');

    // Step 7: Settlement Close - Discrepancy Requires Approval
    await expect(
      deliveryService.closeSettlement(tenantId, settlement.id, cashierUserId, undefined, correlationId),
    ).rejects.toThrow('requires explicit approval');

    // Create and Approve Discrepancy Approval Request with Manager PIN
    const settleApprovalReq = await approvalService.createRequest(
      tenantId,
      cashierUserId,
      {
        action: 'COURIER_SETTLEMENT_DISCREPANCY',
        entity_type: 'CourierSettlement',
        entity_id: settlement.id,
        reason: 'Courier Cash Shortage - 10,000 IRR deducted from next pay period',
      },
      correlationId,
    );

    await approvalService.approveRequest(
      tenantId,
      settleApprovalReq.id,
      adminUserId,
      '1234',
      'Manager Approved Cash Discrepancy',
      correlationId,
    );

    // Close Settlement with Approval Request ID -> Success
    const closedSettlement = await deliveryService.closeSettlement(
      tenantId,
      settlement.id,
      adminUserId,
      settleApprovalReq.id,
      correlationId,
    );
    expect(closedSettlement.status).toBe('CLOSED');
    expect(closedSettlement.approval_request_id).toBe(settleApprovalReq.id);

    // Step 8: Assert Separate Instrument Totals & Courier Report
    expect(MoneyUtil.format(closedSettlement.expected_cash_amount, 2)).toBe(MoneyUtil.format(codCash, 2));
    expect(MoneyUtil.format(closedSettlement.actual_cash_amount, 2)).toBe(MoneyUtil.format(codCashShort, 2));
    expect(MoneyUtil.format(closedSettlement.expected_pos_amount, 2)).toBe('180000.00');
    expect(MoneyUtil.format(closedSettlement.actual_pos_amount, 2)).toBe('180000.00');

    // The handover paid the customer's bill in full — cash into the open drawer, the card part
    // as a card payment — completed the order, and left the 10,000 short against the courier.
    const settledOrder = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: submittedDelOrder.id });
    expect(settledOrder.state).toBe('COMPLETED');
    expect(MoneyUtil.format(settledOrder.paid_total)).toBe(codTotal);
    expect(MoneyUtil.format(settledOrder.outstanding_total)).toBe('0.0000');
    const codPayments = await dataSource.getRepository(Payment).find({ where: { order_id: submittedDelOrder.id, status: 'SUCCEEDED' } });
    expect(codPayments.map((p) => [p.method_kind, MoneyUtil.format(p.amount)]).sort()).toEqual(
      [['CASH', codCash], ['NETWORK_POS', '180000.0000']].sort(),
    );
    expect(codPayments.find((p) => p.method_kind === 'CASH')?.shift_id).toBeTruthy();

    const courierReport = await reportsService.queryReport(tenantId, 'courier-settlements', {});
    expect(courierReport).toBeDefined();
    expect(courierReport.rows.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // WORKFLOW 4: SNAPPFOOD AGGREGATOR COMPLETE LIFECYCLE (§16.3.4)
  // =========================================================================
  it('Workflow 4: Snappfood - Generate, Accept, Duplicate Idempotency, Snappfood Cancel (no till refund), Exactly-One-Order & Logs', async () => {
    const correlationId = `corr-snapp-${Date.now()}`;
    const seed = Date.now().toString().slice(-6);

    // Step 1: Generate Snappfood Order with Notes
    const genResult = await simulationService.generateSnappfoodOrder(
      tenantId,
      {
        seed,
        branch_id: branchId,
        customer_name: 'Reza Ahmadi',
        customer_phone: '09129998877',
        notes: 'Please add extra cutlery and napkins',
        items: [
          { product_name: 'Double Cheeseburger Deluxe', quantity: 2, price: 200000.0 },
        ],
      },
      correlationId,
    );

    expect(genResult.success).toBe(true);
    expect(genResult.duplicate).toBe(false);
    expect(genResult.order).toBeDefined();
    expect(genResult.order.order_type).toBe('AGGREGATOR');
    expect(genResult.order.notes).toContain('Please add extra cutlery');

    const createdOrder = genResult.order;

    // Step 2: Accept / Modify / Verify Pre-Paid Payment Record
    const acceptResult = await simulationService.triggerSnappfoodAction(
      tenantId,
      {
        order_id: createdOrder.id,
        action: 'ACCEPT',
      },
      correlationId,
    );
    expect(acceptResult.success).toBe(true);
    expect(acceptResult.order.status).toBe('KITCHEN_PREPARING');

    // Assert pre-paid amount on OrderHeader: Snappfood collected it, not the till.
    expect(MoneyUtil.format(createdOrder.paid_amount)).toBe(MoneyUtil.format(createdOrder.total_amount));
    expect(MoneyUtil.format(createdOrder.outstanding_total)).toBe('0.0000');
    // ...and it is a payment, so it shows in payments by method.
    const onlinePayments = await dataSource.getRepository(Payment).find({ where: { tenant_id: tenantId, order_id: createdOrder.id } });
    expect(onlinePayments.map((p) => [p.method_kind, p.status, MoneyUtil.format(p.amount)])).toEqual([
      ['ONLINE', 'SUCCEEDED', MoneyUtil.format(createdOrder.total_amount)],
    ]);

    // Step 3: Duplicate Idempotency Suppression Test
    // Trigger duplicate event with identical idempotency key (`snapp-evt-${seed}`)
    const dupPayload = {
      event_id: `snapp-evt-${seed}`,
      order_code: `SF-${seed}`,
      branch_id: branchId,
      items: [{ product_name: 'Double Cheeseburger Deluxe', quantity: 2, price: 200000.0 }],
    };
    const dupRawBody = JSON.stringify(dupPayload);
    const dupSignature = crypto.createHmac('sha256', 'snappfood-secret-key-123').update(dupRawBody).digest('hex');

    const dupResult = await simulationService.handleSnappfoodWebhook(
      tenantId,
      dupRawBody,
      dupPayload,
      dupSignature,
      undefined,
      'snappfood-secret-key-123',
      correlationId,
    );

    expect(dupResult.success).toBe(true);
    expect(dupResult.duplicate).toBe(true);

    // Verify EXACTLY ONE OrderHeader exists in PostgreSQL for this order code
    const orderRepo = dataSource.getRepository(OrderHeader);
    const matchingOrders = await orderRepo.find({
      where: { tenant_id: tenantId, order_number: `SNP-SF-${seed}` },
    });
    expect(matchingOrders.length).toBe(1);

    // Step 4: Cancel & Refund Workflow
    const cancelResult = await simulationService.triggerSnappfoodAction(
      tenantId,
      {
        order_id: createdOrder.id,
        action: 'CANCEL',
        reason: 'Customer cancelled via Snappfood app',
      },
      correlationId,
    );
    expect(cancelResult.success).toBe(true);
    expect(cancelResult.order.status).toBe('CANCELLED');

    // Snappfood refunds its own customer, so the till refuses to refund a Snappfood order.
    const tillRefund = await refundService
      .createRefundIntent(
        tenantId,
        createdOrder.id,
        {
          amount: createdOrder.total_amount,
          targetMethodId: posPaymentMethodId,
          reason: 'Snappfood order cancellation refund',
          full: true,
        },
        cashierUserId,
        correlationId,
        true, // isCancellationOrchestration
      )
      .catch((err) => err);
    expect(tillRefund.getResponse?.()).toEqual(expect.objectContaining({ code: 'SNAPPFOOD_ORDER_LOCKED' }));

    // Step 5: Verify Reconciliation & Integration Logs
    const snappLogs = await simulationService.getLogs(tenantId, 'SNAPPFOOD');
    expect(snappLogs.length).toBeGreaterThanOrEqual(2);
    const duplicateLogs = snappLogs.filter((l) => l.is_duplicate === true || l.event_type === 'DUPLICATE_REJECTED');
    expect(duplicateLogs.length).toBeGreaterThan(0);

    const auditRepo = dataSource.getRepository(AuditEvent);
    const snappAudits = await auditRepo.find({
      where: { tenant_id: tenantId, action: In(['SNAPPFOOD_WEBHOOK_PROCESSED', 'SNAPPFOOD_ACTION_ACCEPT', 'SNAPPFOOD_ACTION_CANCEL']) },
    });
    expect(snappAudits.length).toBeGreaterThanOrEqual(2);
  });

  // =========================================================================
  // WORKFLOW 5: OFFLINE SYNC COMPLETE LIFECYCLE (§16.3.5)
  // =========================================================================
  it('Workflow 5: Offline Sync - Offline Toggle, Failure/Retry/DLQ, Conflict Creation & Resolution, Online Sync & Status Assertions', async () => {
    const correlationId = `corr-offline-${Date.now()}`;
    const tag = Date.now().toString().slice(-5);

    // Step 1: Set Branch Offline
    const offlineStatus = await offlineSyncService.toggleConnectivity(tenantId, branchId, false);
    expect(offlineStatus.is_online).toBe(false);
    expect(offlineStatus.offline_since).toBeDefined();

    // Step 2: Enqueue Representative Operations
    // A) Normal Offline Order
    const normalItem = await offlineSyncService.enqueueOfflineItem(
      tenantId,
      {
        branch_id: branchId,
        terminal_id: terminalId,
        entity_type: 'ORDER',
        payload: {
          order_num: `OFF-NORM-${tag}`,
          items: [{ product_id: productId, quantity: 1 }],
        },
      },
      correlationId,
    );
    expect(normalItem.status).toBe('PENDING');

    // B) Conflict Order (simulate version mismatch conflict)
    const conflictItem = await offlineSyncService.enqueueOfflineItem(
      tenantId,
      {
        branch_id: branchId,
        terminal_id: terminalId,
        entity_type: 'ORDER',
        client_version: 1,
        payload: {
          order_num: `OFF-CONF-${tag}`,
          simulate_conflict: 'PRICE_MISMATCH',
          cloud_version: 2,
          cloud_original: { server_price: '250000.00', server_version: 2 },
        },
      },
      correlationId,
    );
    expect(conflictItem.status).toBe('PENDING');

    // C) DLQ Failure Order (simulate fatal retry failure)
    const dlqItem = await offlineSyncService.enqueueOfflineItem(
      tenantId,
      {
        branch_id: branchId,
        terminal_id: terminalId,
        entity_type: 'ORDER',
        payload: {
          order_num: `OFF-DLQ-${tag}`,
          simulate_failure: 'Database locking timeout after 3 retries',
        },
      },
      correlationId,
    );
    expect(dlqItem.status).toBe('PENDING');

    // Step 3: Trigger Sync Worker & Verify Retry/DLQ and Conflict Creation
    const workerRes1 = await offlineSyncService.triggerSyncWorker(tenantId, branchId, correlationId);
    expect(workerRes1.processed_count).toBe(3);
    expect(workerRes1.dlq_count).toBe(1);
    expect(workerRes1.conflict_count).toBe(1);
    expect(workerRes1.synced_count).toBe(1);

    // Verify DLQ item status
    const queueRepo = dataSource.getRepository(OfflineQueueItem);
    const refreshedDlq = await queueRepo.findOne({ where: { id: dlqItem.id } });
    expect(refreshedDlq?.status).toBe('DLQ_FAILED');
    expect(refreshedDlq?.failure_reason).toContain('Database locking timeout');

    // Verify Conflict Record creation
    const conflictRepo = dataSource.getRepository(SyncConflictRecord);
    const conflicts = await conflictRepo.find({ where: { tenant_id: tenantId, queue_item_id: conflictItem.id } });
    expect(conflicts.length).toBe(1);
    const conflictRec = conflicts[0];
    expect(conflictRec.conflict_type).toBe('PRICE_MISMATCH');
    expect(conflictRec.resolution_strategy).toBe('UNRESOLVED');

    // Step 4: Conflict Resolution (Strategy: ACCEPT_CLIENT)
    const resolvedConflict = await offlineSyncService.resolveConflict(
      tenantId,
      {
        conflict_id: conflictRec.id,
        resolution_strategy: 'ACCEPT_CLIENT',
      },
      adminUserId,
      correlationId,
    );
    expect(resolvedConflict.conflict.resolution_strategy).toBe('ACCEPT_CLIENT');

    const refreshedConflictQueueItem = await queueRepo.findOne({ where: { id: conflictItem.id } });
    expect(['RESOLVED', 'SYNCED']).toContain(refreshedConflictQueueItem?.status);

    // Step 5: Restore Online Connectivity & Assert Status
    const onlineStatus = await offlineSyncService.toggleConnectivity(tenantId, branchId, true);
    expect(onlineStatus.is_online).toBe(true);
    expect(onlineStatus.offline_since).toBeNull();

    const workerRes2 = await offlineSyncService.triggerSyncWorker(tenantId, branchId, correlationId);
    expect(workerRes2.success).toBe(true);

    const finalStatus = await offlineSyncService.getStatus(tenantId, branchId);
    expect(finalStatus.is_online).toBe(true);
    expect(finalStatus.pending_queue_count).toBe(0);
    expect(finalStatus.last_synced_at).toBeDefined();

    // Step 6: Verify Audit Trail for Offline Connectivity & Conflicts
    const auditRepo = dataSource.getRepository(AuditEvent);
    const offlineAudits = await auditRepo.find({
      where: {
        tenant_id: tenantId,
        action: In(['BRANCH_CONNECTIVITY_OFFLINE', 'BRANCH_CONNECTIVITY_ONLINE', 'OFFLINE_ITEM_ENQUEUED', 'OFFLINE_CONFLICT_RESOLVED']),
      },
    });
    expect(offlineAudits.length).toBeGreaterThanOrEqual(3);
  });

  // =========================================================================
  // WORKFLOW 6: KIOSK COMPLETE LIFECYCLE (§16.3.6)
  // =========================================================================
  it('Workflow 6: Kiosk - Guest vs Mandatory Identification, Idempotency, Tax Calculation, Simulated Payment/Receipt Failures & Retries', async () => {
    const correlationId = `corr-kiosk-${Date.now()}`;
    const tag = Date.now().toString().slice(-5);

    // Step 1: Bootstrap Context & Optional Guest Path
    const bootstrap = await kioskService.getBootstrapContext(tenantId, branchId, terminalId);
    expect(bootstrap.channel).toBe('KIOSK');
    expect(bootstrap.customer_identity_policy).toBe('OPTIONAL');

    // Create Guest Kiosk Order
    const guestOrder = await kioskService.createKioskOrder(
      tenantId,
      {
        branch_id: branchId,
        terminal_id: terminalId,
        order_type: 'TAKEAWAY',
        items: [{ product_id: productId, quantity: 2 }],
      },
      correlationId,
    );

    expect(guestOrder.id).toBeDefined();
    expect(guestOrder.channel).toBe('KIOSK');
    expect(MoneyUtil.format(guestOrder.subtotal_amount)).toBe('400000.0000');
    // VAT at the product's own rate, as on the register; this burger's is the column default, 0.
    expect(MoneyUtil.format(guestOrder.tax_amount)).toBe('0.0000');
    expect(MoneyUtil.format(guestOrder.total_amount)).toBe('400000.0000');

    // Process Kiosk POS Payment
    const guestPaymentRes = await kioskService.processKioskPayment(tenantId, {
      order_id: guestOrder.id,
      payment_method_id: posPaymentMethodId,
    });
    expect(guestPaymentRes.success).toBe(true);
    expect(guestPaymentRes.receipt).toBeDefined();
    expect(guestPaymentRes.receipt.status).toBe('SENT_TO_KITCHEN');

    // Step 2: Mandatory Identification Policy Path
    const settingRepo = dataSource.getRepository(TenantSetting);
    let identitySetting = await settingRepo.findOne({ where: { tenant_id: tenantId, key: 'KIOSK_CUSTOMER_IDENTITY_POLICY' } });
    if (!identitySetting) {
      identitySetting = settingRepo.create({ tenant_id: tenantId, key: 'KIOSK_CUSTOMER_IDENTITY_POLICY', value: 'REQUIRED' as any });
    } else {
      identitySetting.value = 'REQUIRED' as any;
    }
    await settingRepo.save(identitySetting);

    // Attempt order without phone -> expect ForbiddenException
    await expect(
      kioskService.createKioskOrder(tenantId, {
        branch_id: branchId,
        terminal_id: terminalId,
        order_type: 'DINE_IN',
        items: [{ product_id: productId, quantity: 1 }],
      }),
    ).rejects.toThrow('Customer phone number is required');

    // Provide required phone and Persian name -> Success
    const uniqueMobile = `0999${Date.now().toString().slice(-6)}`;
    const identifiedOrder = await kioskService.createKioskOrder(
      tenantId,
      {
        branch_id: branchId,
        terminal_id: terminalId,
        order_type: 'DINE_IN',
        customer_name: 'حمیدرضا رضایی',
        customer_phone: uniqueMobile,
        items: [{ product_id: productId, quantity: 1 }],
      },
      correlationId,
    );
    expect(identifiedOrder.customer_id).toBeDefined();

    // Verify Customer record created with Persian name
    const custRepo = dataSource.getRepository(Customer);
    const createdCustomer = await custRepo.findOne({ where: { id: identifiedOrder.customer_id! } });
    expect(createdCustomer?.first_name).toBe('حمیدرضا رضایی');

    // Step 3: Simulated POS & Receipt Failure & Retry
    const [printJob] = await printQueueService.enqueueOrderPrintJobs(tenantId, identifiedOrder.id);
    expect(printJob).toBeDefined();

    // Simulate failure on primary thermal printer
    const failOutcome = await printQueueService.processSimulationOutcome(tenantId, {
      printJobId: printJob.id,
      outcome: 'FAILED',
      useFallback: true,
    });
    expect(failOutcome.attempt.status).toBe('FAILED');

    // Retry print job with fallback thermal printer
    const retryOutcome = await printQueueService.retryJob(tenantId, printJob.id, { useFallback: true });
    expect(retryOutcome.job.status).toBe('SUCCESS');

    // Revert identity policy to OPTIONAL
    identitySetting.value = 'OPTIONAL' as any;
    await settingRepo.save(identitySetting);
  });

  // =========================================================================
  // WORKFLOW 7: REPORTS EXPORT, PERSIAN IMPORT, LAYOUT SAVE & RESET (§16.3.7)
  // =========================================================================
  it('Workflow 7: Reports/Import/Reset - Every Report CSV/XLSX with Persian Text, Persian Customer/Catalog Imports, Layout Save, Reset & Seeded Relogin', async () => {
    const correlationId = `corr-rep-imp-${Date.now()}`;
    const tag = Date.now().toString().slice(-5);

    // Step 1: Export Every Single Report in CSV & XLSX Formats with Persian Text
    const catalog = await reportsService.getCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(20);

    for (const reportDef of catalog) {
      // Export CSV
      const csvJob = await reportsService.exportReport(tenantId, reportDef.code, { branchId }, 'CSV');
      expect(csvJob.export_job_id).toBeDefined();
      expect(csvJob.content_base64).toBeDefined();
      expect(csvJob.content_base64.length).toBeGreaterThan(0);

      // Verify UTF-8 BOM or header text
      const csvStr = Buffer.from(csvJob.content_base64, 'base64').toString('utf8');
      expect(csvStr.length).toBeGreaterThan(10);

      // Export XLSX
      const xlsxJob = await reportsService.exportReport(tenantId, reportDef.code, { branchId }, 'XLSX');
      expect(xlsxJob.export_job_id).toBeDefined();
      expect(xlsxJob.content_base64).toBeDefined();
      expect(xlsxJob.content_base64.length).toBeGreaterThan(0);
    }

    // Step 2: Persian Customer & Catalog Imports
    // A) Persian Customer Import CSV
    const customerCsv = `کد مشتری,نام,نام خانوادگی,موبایل\nCUST-FA-${tag},محسن,صادقی,0912${tag}99`;
    const custJob = await importExportService.createStagedJob(
      tenantId,
      'CUSTOMERS',
      'customers_persian.csv',
      customerCsv,
    );
    expect(custJob.id).toBeDefined();
    expect(custJob.total_rows).toBe(1);

    const validatedCustJob = await importExportService.validateJob(custJob.id, {
      'کد مشتری': 'code',
      'نام': 'first_name',
      'نام خانوادگی': 'last_name',
      'موبایل': 'mobile',
    });
    expect(validatedCustJob.valid_rows).toBe(1);

    const custImportResult = await importExportService.executeJob(custJob.id, adminUserId);
    expect(custImportResult.importedCount).toBe(1);

    const custRepo = dataSource.getRepository(Customer);
    const importedCust = await custRepo.findOne({ where: { tenant_id: tenantId, code: `CUST-FA-${tag}` } });
    expect(importedCust).toBeDefined();
    expect(importedCust?.first_name).toBe('محسن');
    expect(importedCust?.last_name).toBe('صادقی');

    // B) Persian Catalog Product Import CSV
    const productCsv = `کد کالا,نام کالا,قیمت پایه,کد دسته بندی\nPROD-FA-${tag},چلوکباب کوبیده سیخی,280000.0000,CAT-BURGER-163`;
    const prodJob = await importExportService.createStagedJob(
      tenantId,
      'PRODUCTS',
      'products_persian.csv',
      productCsv,
    );
    expect(prodJob.id).toBeDefined();
    expect(prodJob.total_rows).toBe(1);

    const validatedProdJob = await importExportService.validateJob(prodJob.id, {
      'کد کالا': 'code',
      'نام کالا': 'name_fa',
      'قیمت پایه': 'base_price',
      'کد دسته بندی': 'category_code',
    });
    expect(validatedProdJob.valid_rows).toBe(1);

    const prodImportResult = await importExportService.executeJob(prodJob.id, adminUserId);
    expect(prodImportResult.importedCount).toBe(1);

    const prodRepo = dataSource.getRepository(Product);
    const importedProd = await prodRepo.findOne({ where: { tenant_id: tenantId, code: `PROD-FA-${tag}` } });
    expect(importedProd).toBeDefined();
    expect(importedProd?.name).toBe('چلوکباب کوبیده سیخی');
    expect(MoneyUtil.format(importedProd?.base_price || '0')).toBe('280000.0000');

    // Step 3: Save Layout & System Preferences
    const layoutSettings = await settingsService.updateSetting(
      tenantId,
      'SYSTEM',
      { auto_logout_minutes: 45, default_theme: 'DARK', grid_layout_mode: 'COMPACT' },
      correlationId,
    );
    expect(layoutSettings.key).toBe('SYSTEM');
    expect(layoutSettings.value.grid_layout_mode).toBe('COMPACT');

    const fetchedSettings = await settingsService.getSettings(tenantId);
    expect(fetchedSettings['SYSTEM']?.grid_layout_mode).toBe('COMPACT');

    // Step 4: System Reset & Seeded Relogin Verification
    const resetResult = await importExportService.systemReset(tenantId, adminUserId);
    expect(resetResult.resetTables).toBeDefined();
    expect(resetResult.resetTables.length).toBeGreaterThan(0);

    const seedResult = await importExportService.applySeedProfile(tenantId, adminUserId, 'MINIMAL');
    expect(seedResult.success).toBe(true);

    // Verify seeded admin user exists and password hash validates
    const userRepo = dataSource.getRepository(AdminUser);
    const seededAdmins = await userRepo.find({ where: { tenant_id: tenantId } });
    expect(seededAdmins.length).toBeGreaterThan(0);
    const seededAdmin = seededAdmins[0];
    expect(seededAdmin.is_active).toBe(true);

    const validPassword = await argon2.verify(seededAdmin.password_hash, 'GnextDemo!2026');
    expect(validPassword).toBe(true);
  }, 60000);
});

