import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PrintRenderService } from '../src/modules/printing/print-render.service';
import { PrintRoutingService } from '../src/modules/printing/print-routing.service';
import { PrintQueueService } from '../src/modules/printing/print-queue.service';
import { Printer } from '../src/entities/Printer.entity';
import { PrinterGroup } from '../src/entities/PrinterGroup.entity';
import { PrinterGroupMember } from '../src/entities/PrinterGroupMember.entity';
import { PrintRoute } from '../src/entities/PrintRoute.entity';
import { PrintJob } from '../src/entities/PrintJob.entity';
import { PrintAttempt } from '../src/entities/PrintAttempt.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';

describe('PrintingModule (Unit & Integration)', () => {
  let renderService: PrintRenderService;
  let routingService: PrintRoutingService;
  let queueService: PrintQueueService;

  let printerRepo: any;
  let groupRepo: any;
  let memberRepo: any;
  let routeRepo: any;
  let jobRepo: any;
  let attemptRepo: any;
  let orderRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    printerRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    groupRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    memberRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    routeRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    jobRepo = { findOne: jest.fn(), findAndCount: jest.fn(), create: jest.fn(), save: jest.fn() };
    attemptRepo = { findOne: jest.fn(), find: jest.fn(), count: jest.fn().mockResolvedValue(0), create: jest.fn(), save: jest.fn() };
    orderRepo = { findOne: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrintRenderService,
        PrintRoutingService,
        PrintQueueService,
        { provide: getRepositoryToken(Printer), useValue: printerRepo },
        { provide: getRepositoryToken(PrinterGroup), useValue: groupRepo },
        { provide: getRepositoryToken(PrinterGroupMember), useValue: memberRepo },
        { provide: getRepositoryToken(PrintRoute), useValue: routeRepo },
        { provide: getRepositoryToken(PrintJob), useValue: jobRepo },
        { provide: getRepositoryToken(PrintAttempt), useValue: attemptRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    renderService = module.get<PrintRenderService>(PrintRenderService);
    routingService = module.get<PrintRoutingService>(PrintRoutingService);
    queueService = module.get<PrintQueueService>(PrintQueueService);
  });

  it('should render document with SIMULATED banner and escaped HTML', () => {
    const html = renderService.renderDocument({
      documentType: 'CUSTOMER_RECEIPT',
      orderNumber: 'ORD-101',
      branchName: 'Main Branch <Script>',
      items: [
        { product_name: 'Burger & Fries', quantity: 2, total_price: '30.00' },
      ],
      grandTotal: '30.00',
    });

    expect(html).toContain('SIMULATED HARDWARE OUTPUT');
    expect(html).toContain('CUSTOMER RECEIPT');
    expect(html).toContain('ORD-101');
    expect(html).toContain('Burger &amp; Fries');
    expect(html).not.toContain('<Script>');
  });

  it('should resolve print route by product > category > station specificity', async () => {
    routeRepo.find.mockResolvedValue([
      { id: 'rt-prod', document_type: 'CUSTOMER_RECEIPT', product_id: 'prod-burger', printer_group_id: 'grp-1', priority: 10, copies: 2 },
      { id: 'rt-default', document_type: 'CUSTOMER_RECEIPT', printer_group_id: 'grp-2', priority: 1, copies: 1 },
    ]);

    memberRepo.find.mockResolvedValue([
      { group_id: 'grp-1', printer_id: 'prn-1', priority: 1, copies: 2 },
    ]);

    printerRepo.findOne.mockResolvedValue({ id: 'prn-1', tenant_id: 't-1', name: 'Front Printer', is_active: true });

    const resolved = await routingService.resolvePrintersForRoute({
      tenantId: 't-1',
      branchId: 'br-1',
      documentType: 'CUSTOMER_RECEIPT',
      productId: 'prod-burger',
    });

    expect(resolved.copies).toBe(2);
    expect(resolved.printers.length).toBe(1);
    expect(resolved.printers[0].name).toBe('Front Printer');
  });

  it('should enqueue print job and execute simulation outcome with fallback printer', async () => {
    orderRepo.findOne.mockResolvedValue({
      id: 'ord-100',
      branch_id: 'br-1',
      order_number: 'ORD-100',
      order_type: 'DINE_IN',
      placed_at: new Date(),
      items: [{ product_name: 'Pizza', quantity: 1, unit_price: '15.00' }],
      grand_total: '15.00',
    });

    routeRepo.find.mockResolvedValue([]);
    printerRepo.find.mockResolvedValue([{ id: 'prn-main', name: 'Main Thermal', fallback_printer_id: 'prn-backup', is_active: true }]);
    jobRepo.create.mockImplementation((j) => j);
    jobRepo.save.mockImplementation((j) => Promise.resolve({ ...j, id: 'job-100' }));
    attemptRepo.create.mockImplementation((a) => a);

    const job = await queueService.enqueueOrderPrintJobs('t-1', 'ord-100');

    expect(job).toBeDefined();
    expect(jobRepo.save).toHaveBeenCalled();

    // Simulate failure with fallback
    jobRepo.findOne.mockResolvedValue({ id: 'job-100', tenant_id: 't-1', printer_id: 'prn-main', status: 'QUEUED' });
    printerRepo.findOne.mockResolvedValue({ id: 'prn-main', tenant_id: 't-1', fallback_printer_id: 'prn-backup' });

    const outcomeRes = await queueService.processSimulationOutcome('t-1', {
      printJobId: 'job-100',
      outcome: 'FAILED',
      useFallback: true,
    });

    expect(outcomeRes.attempt.status).toBe('FAILED');
    expect(outcomeRes.attempt.printer_id).toBe('prn-backup');
  });

  describe('kitchen change tickets', () => {
    const editedOrder = () => ({
      id: 'ord-200',
      branch_id: 'br-1',
      order_number: 'ORD-200',
      order_type: 'DINE_IN',
      placed_at: new Date(),
      items: [
        { id: 'l-1', product_name: 'Kebab', quantity: '1', unit_price: '50.00', state: 'VOID' },
        { id: 'l-2', product_name: 'Doogh', quantity: '2', unit_price: '5.00', state: 'ACTIVE' },
        { id: 'l-3', product_name: 'Baklava', quantity: '1', unit_price: '8.00', state: 'ACTIVE' },
      ],
      grand_total: '18.00',
    });

    beforeEach(() => {
      orderRepo.findOne.mockResolvedValue(editedOrder());
      routeRepo.find.mockResolvedValue([]);
      printerRepo.find.mockResolvedValue([{ id: 'prn-kitchen', name: 'Kitchen', is_active: true }]);
      jobRepo.create.mockImplementation((j: any) => j);
      jobRepo.save.mockImplementation((j: any) => Promise.resolve({ ...j, id: 'job-200' }));
      attemptRepo.create.mockImplementation((a: any) => a);
    });

    it('prints only the delta, marking struck lines VOID and new lines ADD', async () => {
      const job = await queueService.enqueueKitchenChangeTicket('t-1', 'ord-200', {
        kind: 'AMENDED',
        voidedItemIds: ['l-1'],
        addedItemIds: ['l-3'],
        reason: 'Swapped main for dessert',
      });

      expect(job!.document_type).toBe('KITCHEN_TICKET');
      expect(job!.rendered_html).toContain('KITCHEN CHANGE - ORDER AMENDED');
      expect(job!.rendered_html).toMatch(/VOID<\/strong> <span[^>]*line-through[^>]*><strong>1x<\/strong> Kebab/);
      expect(job!.rendered_html).toMatch(/ADD<\/strong> <span><strong>1x<\/strong> Baklava/);
      expect(job!.rendered_html).not.toContain('Doogh');
      expect(job!.rendered_html).toContain('Swapped main for dessert');
      expect(job!.reason).toBe('Order amended: Swapped main for dessert');
    });

    it('prints every live line under a STOP heading when the order is cancelled', async () => {
      const job = await queueService.enqueueKitchenChangeTicket('t-1', 'ord-200', { kind: 'CANCELLED' });

      expect(job!.rendered_html).toContain('ORDER CANCELLED - STOP');
      expect(job!.rendered_html).toContain('Doogh');
      expect(job!.rendered_html).toContain('Baklava');
      // Already struck off by an earlier edit, and already told to the kitchen then.
      expect(job!.rendered_html).not.toContain('Kebab');
    });

    it('prints nothing when the change touches no line on the order', async () => {
      const job = await queueService.enqueueKitchenChangeTicket('t-1', 'ord-200', {
        kind: 'AMENDED',
        voidedItemIds: ['not-on-this-order'],
        addedItemIds: [],
      });

      expect(job).toBeNull();
      expect(jobRepo.save).not.toHaveBeenCalled();
    });

    it('leaves voided lines off a kitchen reprint', async () => {
      const job = await queueService.enqueueOrderPrintJobs('t-1', 'ord-200', 'KITCHEN_TICKET', true, 'Paper jam');

      expect(job!.rendered_html).not.toContain('Kebab');
      expect(job!.rendered_html).toContain('Doogh');
      expect(job!.rendered_html).toContain('KITCHEN DISPATCH CHIT');
    });
  });
});
