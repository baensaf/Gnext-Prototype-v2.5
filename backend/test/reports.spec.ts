import { Test, TestingModule } from '@nestjs/testing';
import { ReportsService } from '../src/modules/reports/reports.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { Payment } from '../src/entities/Payment.entity';
import { Refund } from '../src/entities/Refund.entity';
import { AuditEvent } from '../src/entities/AuditEvent.entity';
import { IntegrationLog } from '../src/entities/IntegrationLog.entity';
import { CashierShift } from '../src/entities/CashierShift.entity';
import { CourierSettlement } from '../src/entities/CourierSettlement.entity';
import { CourierSettlementLine } from '../src/entities/CourierSettlementLine.entity';
import { CourierAttendance } from '../src/entities/CourierAttendance.entity';
import { Customer } from '../src/entities/Customer.entity';
import { CustomerCreditAccount } from '../src/entities/CustomerCreditAccount.entity';
import { CreditEntry } from '../src/entities/CreditEntry.entity';
import { OrderAdjustment } from '../src/entities/OrderAdjustment.entity';
import { DiscountCampaign } from '../src/entities/DiscountCampaign.entity';
import { PaymentDevice } from '../src/entities/PaymentDevice.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { PrintJob } from '../src/entities/PrintJob.entity';
import { PrintAttempt } from '../src/entities/PrintAttempt.entity';
import { Printer } from '../src/entities/Printer.entity';
import { Delivery } from '../src/entities/Delivery.entity';
import { OfflineQueueItem } from '../src/entities/OfflineQueueItem.entity';
import { Product } from '../src/entities/Product.entity';
import { Category } from '../src/entities/Category.entity';
import { Branch } from '../src/entities/Branch.entity';
import { OperationalAlert } from '../src/entities/OperationalAlert.entity';
import { SavedReportView } from '../src/entities/SavedReportView.entity';
import { ReportExportJob } from '../src/entities/ReportExportJob.entity';

describe('ReportsService (Unit)', () => {
  let service: ReportsService;
  let orderRepo: any;
  let auditRepo: any;
  let alertRepo: any;
  let exportJobRepo: any;

  beforeEach(async () => {
    orderRepo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };

    auditRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((val) => val),
      save: jest.fn().mockImplementation((val) => Promise.resolve(val)),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([
          [
            {
              id: 'audit-1',
              action: 'USER_LOGIN',
              before_data: null,
              after_data: { username: 'admin@gnext.local', password: 'secretpassword', pin: '1234' },
              details: null,
            },
          ],
          1,
        ]),
      }),
    };

    alertRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'alert-1',
          tenant_id: 't-1',
          type: 'CASH_DISCREPANCY',
          severity: 'WARNING',
          title: 'Cash Drawer Variance',
          message: 'Variance detected',
          acknowledged: false,
        },
      ]),
      findOne: jest.fn().mockResolvedValue({
        id: 'alert-1',
        tenant_id: 't-1',
        title: 'Cash Drawer Variance',
        severity: 'WARNING',
        acknowledged: false,
      }),
      create: jest.fn().mockImplementation((val) => val),
      save: jest.fn().mockImplementation((val) => Promise.resolve(val)),
    };

    exportJobRepo = {
      create: jest.fn().mockImplementation((val) => val),
      save: jest.fn().mockImplementation((val) => Promise.resolve({ id: 'export-job-1', ...val })),
    };

    const mockRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((val) => val),
      save: jest.fn().mockImplementation((val) => Promise.resolve(val)),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: mockRepo },
        { provide: getRepositoryToken(Payment), useValue: mockRepo },
        { provide: getRepositoryToken(Refund), useValue: mockRepo },
        { provide: getRepositoryToken(AuditEvent), useValue: auditRepo },
        { provide: getRepositoryToken(IntegrationLog), useValue: mockRepo },
        { provide: getRepositoryToken(CashierShift), useValue: mockRepo },
        { provide: getRepositoryToken(CourierSettlement), useValue: mockRepo },
        { provide: getRepositoryToken(CourierSettlementLine), useValue: mockRepo },
        { provide: getRepositoryToken(CourierAttendance), useValue: mockRepo },
        { provide: getRepositoryToken(Customer), useValue: mockRepo },
        { provide: getRepositoryToken(CustomerCreditAccount), useValue: mockRepo },
        { provide: getRepositoryToken(CreditEntry), useValue: mockRepo },
        { provide: getRepositoryToken(OrderAdjustment), useValue: mockRepo },
        { provide: getRepositoryToken(DiscountCampaign), useValue: mockRepo },
        { provide: getRepositoryToken(PaymentDevice), useValue: mockRepo },
        { provide: getRepositoryToken(PaymentMethod), useValue: mockRepo },
        { provide: getRepositoryToken(PrintJob), useValue: mockRepo },
        { provide: getRepositoryToken(PrintAttempt), useValue: mockRepo },
        { provide: getRepositoryToken(Printer), useValue: mockRepo },
        { provide: getRepositoryToken(Delivery), useValue: mockRepo },
        { provide: getRepositoryToken(OfflineQueueItem), useValue: mockRepo },
        { provide: getRepositoryToken(Product), useValue: mockRepo },
        { provide: getRepositoryToken(Category), useValue: mockRepo },
        { provide: getRepositoryToken(Branch), useValue: mockRepo },
        { provide: getRepositoryToken(OperationalAlert), useValue: alertRepo },
        { provide: getRepositoryToken(SavedReportView), useValue: mockRepo },
        { provide: getRepositoryToken(ReportExportJob), useValue: exportJobRepo },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  it('should return report catalog definitions', async () => {
    const catalog = await service.getCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(23);
    expect(catalog.some((r) => r.code === 'sales-summary')).toBe(true);
  });

  it('should hide chain-only reports from a branch account', async () => {
    // The picker on the reports screen is built from this list, so anything it offers has
    // to be something queryReport will actually run. Offering branch-comparison to a
    // branch manager put a 403 behind a menu item.
    const branchCatalog = await service.getCatalog({ role: 'MANAGER', branchId: 'branch-1' });
    expect(branchCatalog.some((r) => r.code === 'branch-comparison')).toBe(false);
    expect(branchCatalog.some((r) => r.code === 'sales-summary')).toBe(true);

    const headOfficeCatalog = await service.getCatalog({ role: 'SUPER_ADMIN', branchId: null });
    expect(headOfficeCatalog.some((r) => r.code === 'branch-comparison')).toBe(true);
  });

  it('should query sales-summary report and compute exact summary totals', async () => {
    orderRepo.createQueryBuilder().getMany.mockResolvedValue([
      { order_number: 'ORD-1', subtotal_amount: '100.00', tax_amount: '9.00', total_amount: '109.00', paid_amount: '109.00', placed_at: new Date() },
      { order_number: 'ORD-2', subtotal_amount: '200.00', tax_amount: '18.00', total_amount: '218.00', paid_amount: '218.00', placed_at: new Date() },
    ]);

    const report = await service.queryReport('t-1', 'sales-summary');

    expect(report.rows.length).toBe(2);
    expect(report.summary_totals.order_count).toBe(2);
    expect(report.summary_totals.gross_subtotal).toBe('300.00');
    expect(report.summary_totals.tax_total).toBe('27.00');
    expect(report.summary_totals.net_sales).toBe('300.00');
  });

  it('should export CSV report with UTF-8 BOM prefix and totals row', async () => {
    orderRepo.createQueryBuilder().getMany.mockResolvedValue([
      { order_number: 'ORD-1', subtotal_amount: '100.00', tax_amount: '9.00', total_amount: '109.00', paid_amount: '109.00', placed_at: new Date() },
    ]);

    const result = await service.exportReport('t-1', 'sales-summary', {}, 'CSV');

    expect(result.filename).toContain('sales-summary-');
    expect(result.mime_type).toContain('text/csv');
    expect(result.content.startsWith('\uFEFF')).toBe(true);
    expect(result.content).toContain('SUMMARY TOTALS');
  });

  it('should retrieve audit logs with masked sensitive payload data', async () => {
    const logsRes = await service.getAuditLogs('t-1');

    expect(logsRes.data.length).toBe(1);
    expect(logsRes.data[0].after_data.password).toBe('***MASKED***');
    expect(logsRes.data[0].after_data.pin).toBe('***MASKED***');
  });

  it('should retrieve and acknowledge operational alerts', async () => {
    const alerts = await service.getAlerts('t-1');
    expect(alerts.length).toBeGreaterThan(0);

    const ack = await service.acknowledgeAlert('t-1', alerts[0].id);
    expect(ack.acknowledged).toBe(true);
  });
});
