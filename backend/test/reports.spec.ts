import { Test, TestingModule } from '@nestjs/testing';
import { ReportsService } from '../src/modules/reports/reports.service';
import { ReportsController } from '../src/modules/reports/reports.controller';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { Payment } from '../src/entities/Payment.entity';
import { Refund } from '../src/entities/Refund.entity';
import { IntegrationLog } from '../src/entities/IntegrationLog.entity';
import { CashierShift } from '../src/entities/CashierShift.entity';
import { CourierSettlement } from '../src/entities/CourierSettlement.entity';
import { CreditEntry } from '../src/entities/CreditEntry.entity';
import { OrderAdjustment } from '../src/entities/OrderAdjustment.entity';

describe('ReportsService (Unit)', () => {
  let service: ReportsService;
  let orderRepo: any;
  let refundQb: any;

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
    // Refunds are read with a join to their order, as raw rows.
    refundQb = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const refundRepo = { ...mockRepo, createQueryBuilder: jest.fn().mockReturnValue(refundQb) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: mockRepo },
        { provide: getRepositoryToken(Payment), useValue: mockRepo },
        { provide: getRepositoryToken(Refund), useValue: refundRepo },
        { provide: getRepositoryToken(IntegrationLog), useValue: mockRepo },
        { provide: getRepositoryToken(CashierShift), useValue: mockRepo },
        { provide: getRepositoryToken(CourierSettlement), useValue: mockRepo },
        { provide: getRepositoryToken(CreditEntry), useValue: mockRepo },
        { provide: getRepositoryToken(OrderAdjustment), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  it('should return report catalog definitions', async () => {
    const catalog = await service.getCatalog();
    expect(catalog).toHaveLength(15);
    expect(catalog.some((r) => r.code === 'sales-summary')).toBe(true);
  });

  it('should hide chain-only reports from a branch account', async () => {
    // The picker on the reports screen is built from this list, so anything it offers has
    // to be something queryReport will actually run. Offering snappfood-reconciliation to a
    // branch manager put a 403 behind a menu item.
    const branchCatalog = await service.getCatalog({ role: 'MANAGER', branchId: 'branch-1' });
    expect(branchCatalog.some((r) => r.code === 'snappfood-reconciliation')).toBe(false);
    expect(branchCatalog.some((r) => r.code === 'sales-summary')).toBe(true);

    const headOfficeCatalog = await service.getCatalog({ role: 'SUPER_ADMIN', branchId: null });
    expect(headOfficeCatalog.some((r) => r.code === 'snappfood-reconciliation')).toBe(true);
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

  it('shows the channel an order came in by, apart from its type', async () => {
    orderRepo.createQueryBuilder().getMany.mockResolvedValue([
      { order_number: 'ORD-1', channel: 'AGGREGATOR', order_type: 'DELIVERY', total_amount: '100.00', placed_at: new Date() },
    ]);

    const report = await service.queryReport('t-1', 'sales-summary');

    expect(report.rows[0]).toMatchObject({ channel: 'AGGREGATOR', type: 'DELIVERY' });
  });

  // A refund today must not rewrite the day the order was sold.
  it("takes a refund off the day it was given, with the refund's share of tax", async () => {
    orderRepo.createQueryBuilder().getMany.mockResolvedValue([
      { order_number: 'ORD-2', business_date: '2026-10-14', subtotal_amount: '200.00', tax_amount: '18.00', total_amount: '218.00', paid_amount: '218.00', refunded_total: '0' },
    ]);
    refundQb.getRawMany.mockResolvedValue([
      { refund_number: 'REF-20261014-0001', amount: '109.00', business_date: '2026-10-14', order_number: 'ORD-1', channel: 'POS', order_total: '109.00', order_tax: '9.00' },
    ]);

    const report = await service.queryReport('t-1', 'sales-summary', { startDate: '2026-10-14', endDate: '2026-10-14' });

    expect(report.rows).toHaveLength(2);
    expect(report.rows[1]).toMatchObject({ type: 'REFUND', refunded: '109.00', tax: '-9.00', net_sales: '-100.00' });
    expect(report.summary_totals.net_sales).toBe('100.00');
    expect(report.summary_totals.tax_total).toBe('9.00');
    expect(report.summary_totals.refunded).toBe('109.00');
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
});

describe('ReportsController scope', () => {
  // The GET route used to call the service with no actor, which skipped
  // both the chain-only refusal and the branch confinement: a branch login could read
  // snappfood-reconciliation just by typing its address.
  const service = {
    queryReport: jest.fn().mockResolvedValue({}),
    exportReport: jest.fn().mockResolvedValue({}),
    getDashboardSummary: jest.fn().mockResolvedValue({}),
  };
  const controller = new ReportsController(service as any);
  const branchReq = { tenantId: 't-1', userRole: 'MANAGER', userBranchId: 'branch-1' } as any;
  const headOfficeReq = { tenantId: 't-1', userRole: 'SUPER_ADMIN', userBranchId: null } as any;

  beforeEach(() => jest.clearAllMocks());

  it('should pass the caller on GET :reportCode', async () => {
    await controller.queryReportGet('snappfood-reconciliation', {}, branchReq);
    expect(service.queryReport).toHaveBeenCalledWith('t-1', 'snappfood-reconciliation', {}, {
      role: 'MANAGER',
      branchId: 'branch-1',
    });
  });

  it('should pass the caller on POST export', async () => {
    await controller.exportReportPost('sales-summary', {}, 'CSV', branchReq);
    expect(service.exportReport).toHaveBeenCalledWith('t-1', 'sales-summary', {}, 'CSV', {
      role: 'MANAGER',
      branchId: 'branch-1',
    });
  });

  it('should let head office see the branch it switched into on the dashboard, and hold a branch to its own', async () => {
    await controller.getDashboardSummary('branch-9', headOfficeReq);
    expect(service.getDashboardSummary).toHaveBeenLastCalledWith('t-1', 'branch-9');

    await controller.getDashboardSummary('branch-9', branchReq);
    expect(service.getDashboardSummary).toHaveBeenLastCalledWith('t-1', 'branch-1');

    await controller.getDashboardSummary(undefined as any, headOfficeReq);
    expect(service.getDashboardSummary).toHaveBeenLastCalledWith('t-1', undefined);
  });
});
