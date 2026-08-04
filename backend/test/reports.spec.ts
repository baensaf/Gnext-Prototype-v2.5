import { Test, TestingModule } from '@nestjs/testing';
import { ReportsService } from '../src/modules/reports/reports.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { Payment } from '../src/entities/Payment.entity';
import { AuditEvent } from '../src/entities/AuditEvent.entity';
import { IntegrationLog } from '../src/entities/IntegrationLog.entity';
import { CashDrawerShift } from '../src/entities/CashDrawerShift.entity';
import { CourierSettlement } from '../src/entities/CourierSettlement.entity';

describe('ReportsService (Unit)', () => {
  let service: ReportsService;
  let orderRepo: any;
  let orderItemRepo: any;
  let paymentRepo: any;
  let auditRepo: any;
  let integrationLogRepo: any;
  let shiftRepo: any;
  let settlementRepo: any;

  beforeEach(async () => {
    orderRepo = { find: jest.fn() };
    orderItemRepo = { find: jest.fn() };
    paymentRepo = { find: jest.fn() };
    auditRepo = { find: jest.fn() };
    integrationLogRepo = { find: jest.fn() };
    shiftRepo = { find: jest.fn() };
    settlementRepo = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(AuditEvent), useValue: auditRepo },
        { provide: getRepositoryToken(IntegrationLog), useValue: integrationLogRepo },
        { provide: getRepositoryToken(CashDrawerShift), useValue: shiftRepo },
        { provide: getRepositoryToken(CourierSettlement), useValue: settlementRepo },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  it('should return report catalog definitions', async () => {
    const catalog = await service.getCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(8);
    expect(catalog.some((r) => r.code === 'sales-summary')).toBe(true);
  });

  it('should query sales-summary report and compute exact summary totals', async () => {
    orderRepo.find.mockResolvedValue([
      { order_number: 'ORD-1', subtotal_amount: '100.00', tax_amount: '9.00', total_amount: '109.00', paid_amount: '109.00', created_at: new Date() },
      { order_number: 'ORD-2', subtotal_amount: '200.00', tax_amount: '18.00', total_amount: '218.00', paid_amount: '218.00', created_at: new Date() },
    ]);

    const report = await service.queryReport('t-1', 'sales-summary');

    expect(report.rows.length).toBe(2);
    expect(report.summary_totals.order_count).toBe(2);
    expect(report.summary_totals.gross_subtotal).toBe('300.00');
    expect(report.summary_totals.tax_total).toBe('27.00');
    expect(report.summary_totals.net_sales).toBe('327.00');
  });

  it('should export CSV report with UTF-8 BOM prefix and totals row', async () => {
    orderRepo.find.mockResolvedValue([
      { order_number: 'ORD-1', subtotal_amount: '100.00', tax_amount: '9.00', total_amount: '109.00', paid_amount: '109.00', created_at: new Date() },
    ]);

    const result = await service.exportReport('t-1', 'sales-summary', {}, 'CSV');

    expect(result.filename).toContain('sales-summary-');
    expect(result.mime_type).toContain('text/csv');
    expect(result.content.startsWith('\uFEFF')).toBe(true);
    expect(result.content).toContain('TOTALS');
  });

  it('should retrieve audit logs with masked sensitive payload data', async () => {
    auditRepo.find.mockResolvedValue([
      {
        id: 'audit-1',
        action: 'USER_LOGIN',
        after_data: { username: 'admin@gnext.local', password: 'secretpassword', pin: '1234' },
      },
    ]);

    const logs = await service.getAuditLogs('t-1');

    expect(logs.length).toBe(1);
    expect(logs[0].after_data.password).toBe('***MASKED***');
    expect(logs[0].after_data.pin).toBe('***MASKED***');
  });

  it('should retrieve and acknowledge operational alerts', async () => {
    const alerts = await service.getAlerts('e8ae80c5-b667-4d58-899a-ce6ef7c3847e');
    expect(alerts.length).toBeGreaterThan(0);

    const ack = await service.acknowledgeAlert('e8ae80c5-b667-4d58-899a-ce6ef7c3847e', alerts[0].id);
    expect(ack.acknowledged).toBe(true);
  });
});
