import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';
import { PrintRenderService } from '../src/modules/printing/print-render.service';
import { PrintRoutingService } from '../src/modules/printing/print-routing.service';
import { PrintQueueService } from '../src/modules/printing/print-queue.service';
import { Printer } from '../src/entities/Printer.entity';
import { PrintJob } from '../src/entities/PrintJob.entity';
import { PrintAttempt } from '../src/entities/PrintAttempt.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { Product } from '../src/entities/Product.entity';
import { KdsRoutingRule } from '../src/entities/KdsRoutingRule.entity';
import { KitchenStation } from '../src/entities/KitchenStation.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { stationIdFor } from '../src/modules/kds/prep-station';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { OperationalAlert } from '../src/entities/OperationalAlert.entity';
import { AgentPrintingService } from '../src/modules/printing/agent-printing.service';

/**
 * An in-memory repository good enough for the routing queries: equality and `In(...)` where
 * clauses, `take`, and a numeric `order`. Saving assigns an id.
 */
const fakeRepo = (rows: any[] = []) => {
  let seq = 0;
  const matches = (row: any, where: any = {}) =>
    Object.entries(where).every(([k, v]) =>
      v instanceof FindOperator && v.type === 'in' ? (v.value as any[]).includes(row[k]) : row[k] === v,
    );
  const find = async (opts: any = {}) => {
    let found = rows.filter((r) => matches(r, opts.where));
    if (opts.order) {
      const [[key, dir]] = Object.entries(opts.order) as [string, string][];
      found = [...found].sort((a, b) => (dir === 'DESC' ? b[key] - a[key] : a[key] - b[key]));
    }
    return opts.take ? found.slice(0, opts.take) : found;
  };
  return {
    rows,
    find: jest.fn(find),
    findOne: jest.fn(async (opts: any) => (await find(opts))[0] || null),
    findAndCount: jest.fn(async (opts: any) => {
      const found = await find(opts);
      return [found, found.length];
    }),
    count: jest.fn(async (opts: any = {}) => (await find(opts)).length),
    create: jest.fn((e: any) => ({ ...e })),
    save: jest.fn(async (e: any) => {
      if (!e.id) {
        e.id = `saved-${++seq}`;
        rows.push(e);
      }
      return e;
    }),
  };
};

describe('PrintingModule (Unit & Integration)', () => {
  let renderService: PrintRenderService;
  let routingService: PrintRoutingService;
  let queueService: PrintQueueService;

  let printerRepo: ReturnType<typeof fakeRepo>;
  let stationRepo: ReturnType<typeof fakeRepo>;
  let terminalRepo: ReturnType<typeof fakeRepo>;
  let jobRepo: ReturnType<typeof fakeRepo>;
  let attemptRepo: ReturnType<typeof fakeRepo>;
  let orderRepo: ReturnType<typeof fakeRepo>;
  let productRepo: ReturnType<typeof fakeRepo>;
  let kdsRuleRepo: ReturnType<typeof fakeRepo>;
  let alertRepo: ReturnType<typeof fakeRepo>;
  let auditWriter: { write: jest.Mock };
  let agentPrinting: { send: jest.Mock; pendingAttempt: jest.Mock; withdraw: jest.Mock };

  const T = 't-1';
  const BR = 'br-1';
  /** A printer the branch agent drives. */
  const TCP = { kind: 'tcp', host: '192.168.1.90', port: 9100 };

  beforeEach(async () => {
    printerRepo = fakeRepo();
    stationRepo = fakeRepo();
    terminalRepo = fakeRepo();
    jobRepo = fakeRepo();
    attemptRepo = fakeRepo();
    orderRepo = fakeRepo();
    productRepo = fakeRepo();
    kdsRuleRepo = fakeRepo();
    alertRepo = fakeRepo();
    auditWriter = { write: jest.fn() };
    agentPrinting = {
      send: jest.fn(async (_t: string, job: any, printer: any, attemptNo: number) => {
        job.status = 'PROCESSING';
        return { job, attempt: { job_id: job.id, printer_id: printer.id, attempt_no: attemptNo, status: 'PENDING' } };
      }),
      pendingAttempt: jest.fn().mockResolvedValue(null),
      withdraw: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrintRenderService,
        PrintRoutingService,
        PrintQueueService,
        { provide: getRepositoryToken(Printer), useValue: printerRepo },
        { provide: getRepositoryToken(KitchenStation), useValue: stationRepo },
        { provide: getRepositoryToken(Terminal), useValue: terminalRepo },
        { provide: getRepositoryToken(PrintJob), useValue: jobRepo },
        { provide: getRepositoryToken(PrintAttempt), useValue: attemptRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(KdsRoutingRule), useValue: kdsRuleRepo },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: getRepositoryToken(OperationalAlert), useValue: alertRepo },
        { provide: AgentPrintingService, useValue: agentPrinting },
      ],
    }).compile();

    renderService = module.get(PrintRenderService);
    routingService = module.get(PrintRoutingService);
    queueService = module.get(PrintQueueService);
  });

  // --- fixtures -------------------------------------------------------------------------

  const printer = (id: string, extra: any = {}) =>
    printerRepo.rows.push({ id, tenant_id: T, branch_id: BR, name: id, is_active: true, ...extra });
  const station = (id: string, name: string, printerIds: string[], extra: any = {}) =>
    stationRepo.rows.push({ id, tenant_id: T, branch_id: BR, name, printer_ids: printerIds, copies: 1, is_active: true, ...extra });
  const categoryRule = (categoryId: string, stationId: string) =>
    kdsRuleRepo.rows.push({ tenant_id: T, branch_id: BR, category_id: categoryId, station_id: stationId });
  const productRule = (productId: string, stationId: string) =>
    kdsRuleRepo.rows.push({ tenant_id: T, branch_id: BR, product_id: productId, station_id: stationId });
  const till = (id: string, extra: any = {}) =>
    terminalRepo.rows.push({ id, tenant_id: T, branch_id: BR, terminal_type: 'CASHIER', receipt_copies: 1, receipt_printer_id: null, ...extra });
  const product = (id: string, categoryId: string) => productRepo.rows.push({ id, tenant_id: T, category_id: categoryId });
  const line = (id: string, productId: string, name: string, state = 'ACTIVE') => ({
    id,
    product_id: productId,
    product_name: name,
    quantity: '1',
    unit_price: '100000.00',
    state,
  });
  const order = (id: string, items: any[], extra: any = {}) =>
    orderRepo.rows.push({
      id,
      tenant_id: T,
      branch_id: BR,
      order_number: id.toUpperCase(),
      order_type: 'DINE_IN',
      placed_at: new Date(),
      items,
      grand_total: '1.00',
      ...extra,
    });

  /**
   * A burger shop: a grill, a fryer and a bar, each with its printer; a pass printer in the
   * kitchen for anything no station makes; and a counter printer at the till.
   */
  const burgerShop = () => {
    printer('prn-counter', { printer_type: 'THERMAL_RECEIPT' });
    printer('prn-grill');
    printer('prn-fryer');
    printer('prn-bar');
    printer('prn-pass', { printer_type: 'KITCHEN_IMPACT' });
    station('st-grill', 'Grill', ['prn-grill']);
    station('st-fryer', 'Fryer', ['prn-fryer']);
    station('st-bar', 'Bar', ['prn-bar']);
    product('p-burger', 'cat-burgers');
    product('p-cheese', 'cat-burgers');
    product('p-fries', 'cat-sides');
    product('p-coke', 'cat-drinks');
    categoryRule('cat-burgers', 'st-grill');
    categoryRule('cat-sides', 'st-fryer');
    categoryRule('cat-drinks', 'st-bar');
    till('till-1', { receipt_printer_id: 'prn-counter' });
  };

  const jobsFor = (jobs: PrintJob[], printerId: string) => jobs.filter((j) => j.printer_id === printerId);

  // --- rendering ------------------------------------------------------------------------

  it('renders a Persian receipt a customer can read, with escaped HTML', () => {
    const html = renderService.renderDocument({
      documentType: 'CUSTOMER_RECEIPT',
      orderNumber: 'ORD-20260922-0012',
      brandName: 'Iran Burger',
      branchName: 'Main Branch <Script>',
      items: [{ product_name: 'Burger & Fries', quantity: 2, unit_price: '15000000.0000', total_price: '30000000.0000' }],
      grandTotal: '30000000.0000',
      outstandingTotal: '0.0000',
      payments: [{ method: 'CASH', amount: '30000000.0000' }],
    });

    expect(html).not.toContain('SIMULATED');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('فاکتور فروش');
    expect(html).toContain('ORD-20260922-0012');
    // Called out as order 12, amounts grouped in Persian digits, and paid.
    expect(html).toContain('<div class="big">۱۲</div>');
    expect(html).toContain('۳۰٬۰۰۰٬۰۰۰');
    expect(html).toContain('نقد');
    expect(html).toContain('پرداخت شد');
    expect(html).toContain('Burger &amp; Fries');
    expect(html).not.toContain('<Script>');
  });

  it('says what is still owed on a courier slip', () => {
    const html = renderService.renderDocument({
      documentType: 'COURIER_SLIP',
      orderNumber: 'ORD-20260922-0013',
      customerName: 'Sara',
      customerMobile: '09120000000',
      deliveryAddress: 'Vanak Sq.',
      items: [{ product_name: 'Burger', quantity: 1 }],
      grandTotal: '1000000.0000',
      outstandingTotal: '1000000.0000',
    });

    expect(html).toContain('برگه پیک');
    expect(html).toContain('Vanak Sq.');
    expect(html).toContain('دریافت از مشتری: ۱٬۰۰۰٬۰۰۰ ریال');
  });

  // --- where a line and a document go ---------------------------------------------------

  describe('finding where paper goes', () => {
    it("takes a product's own station before its category's", () => {
      const rules = [
        { category_id: 'cat-burgers', station_id: 'st-grill' },
        { product_id: 'p-egg-burger', station_id: 'st-fryer' },
      ] as any[];

      expect(stationIdFor(rules, 'p-egg-burger', 'cat-burgers')).toBe('st-fryer');
      expect(stationIdFor(rules, 'p-burger', 'cat-burgers')).toBe('st-grill');
      expect(stationIdFor(rules, 'p-tea', 'cat-hot')).toBeUndefined();
    });

    it('finds each product its station through the KDS routing rules', async () => {
      station('st-grill', 'Grill', []);
      station('st-fryer', 'Fryer', []);
      station('st-closed', 'Closed', [], { is_active: false });
      product('p-burger', 'cat-burgers');
      product('p-egg-burger', 'cat-burgers');
      product('p-tea', 'cat-hot');
      product('p-cake', 'cat-cakes');
      categoryRule('cat-burgers', 'st-grill');
      productRule('p-egg-burger', 'st-fryer');
      categoryRule('cat-cakes', 'st-closed');

      const stations = await routingService.stationsFor(T, BR, ['p-burger', 'p-egg-burger', 'p-tea', 'p-cake']);

      expect(stations.get('p-burger')!.id).toBe('st-grill');
      expect(stations.get('p-egg-burger')!.id).toBe('st-fryer');
      expect(stations.has('p-tea')).toBe(false);
      // A station out of service makes nothing; its lines go where unrouted lines go.
      expect(stations.has('p-cake')).toBe(false);
    });

    it('sends a chit to every active printer of the station, in order, the station copies each', async () => {
      printer('prn-a');
      printer('prn-b');
      printer('prn-off', { is_active: false });
      station('st-grill', 'Grill', ['prn-b', 'prn-off', 'prn-a'], { copies: 3 });

      const routed = await routingService.printersForStation(T, BR, stationRepo.rows[0]);

      expect(routed.map((r) => [r.printer.id, r.copies])).toEqual([
        ['prn-b', 3],
        ['prn-a', 3],
      ]);
    });

    it("falls back to the branch's kitchen printer when the station has none working", async () => {
      printer('prn-counter', { printer_type: 'THERMAL_RECEIPT' });
      printer('prn-kitchen', { printer_type: 'KITCHEN_IMPACT' });
      printer('prn-dead', { is_active: false });
      station('st-grill', 'Grill', ['prn-dead']);

      const routed = await routingService.printersForStation(T, BR, stationRepo.rows[0]);

      expect(routed.map((r) => r.printer.id)).toEqual(['prn-kitchen']);
    });

    it("prints a receipt on the till's own printer, with the till's copies and paper", async () => {
      printer('prn-counter-1', { printer_type: 'THERMAL_RECEIPT' });
      printer('prn-counter-2', { printer_type: 'THERMAL_RECEIPT' });
      till('till-1', { receipt_printer_id: 'prn-counter-1' });
      till('till-2', { receipt_printer_id: 'prn-counter-2', receipt_copies: 2, receipt_template: 'COMPACT' });

      const one = await routingService.printersForDocument(T, BR, 'till-1');
      const two = await routingService.printersForDocument(T, BR, 'till-2');

      expect(one.printers.map((r) => [r.printer.id, r.copies])).toEqual([['prn-counter-1', 1]]);
      expect(two.printers.map((r) => [r.printer.id, r.copies])).toEqual([['prn-counter-2', 2]]);
      expect(two.template).toBe('COMPACT');
    });

    it("prints on the branch's receipt printer for an order from no till, or a till with no printer working", async () => {
      printer('prn-kitchen', { printer_type: 'KITCHEN_IMPACT' });
      printer('prn-counter', { printer_type: 'THERMAL_RECEIPT' });
      printer('prn-dead', { printer_type: 'THERMAL_RECEIPT', is_active: false });
      till('till-1', { receipt_printer_id: 'prn-dead' });

      expect((await routingService.printersForDocument(T, BR, null)).printers.map((r) => r.printer.id)).toEqual(['prn-counter']);
      expect((await routingService.printersForDocument(T, BR, 'till-1')).printers.map((r) => r.printer.id)).toEqual(['prn-counter']);
    });
  });

  // --- the split ------------------------------------------------------------------------

  describe('splitting a kitchen ticket by station', () => {
    beforeEach(() => {
      burgerShop();
      order('ord-1', [
        line('l-burger', 'p-burger', 'Classic Burger'),
        line('l-cheese', 'p-cheese', 'Cheeseburger'),
        line('l-fries', 'p-fries', 'Fries'),
        line('l-coke', 'p-coke', 'Coke'),
        line('l-voided', 'p-coke', 'Fanta', 'VOID'),
      ], { terminal_id: 'till-1' });
    });

    it('prints one chit per station with only that station its lines', async () => {
      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');

      expect(jobs).toHaveLength(3);
      const [grill] = jobsFor(jobs, 'prn-grill');
      const [fryer] = jobsFor(jobs, 'prn-fryer');
      const [bar] = jobsFor(jobs, 'prn-bar');

      expect(grill.rendered_html).toContain('Classic Burger');
      expect(grill.rendered_html).toContain('Cheeseburger');
      expect(grill.rendered_html).not.toContain('Fries');
      expect(fryer.rendered_html).toContain('Fries');
      expect(fryer.rendered_html).not.toContain('Burger');
      expect(bar.rendered_html).toContain('Coke');
      expect(bar.rendered_html).not.toContain('Fanta');
      expect(jobsFor(jobs, 'prn-counter')).toHaveLength(0);
    });

    // What an Iranian kitchen works from: the number, very large, and the station's food.
    it('prints a compact chit by default: the big number and the station items, nothing else', async () => {
      orderRepo.rows.find((o) => o.id === 'ord-1').call_number = 123;
      const [grill] = jobsFor(await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET'), 'prn-grill');

      expect(grill.rendered_html).toContain('<div class="huge">۱۲۳</div>');
      expect(grill.rendered_html).toContain('Classic Burger');
      expect(grill.rendered_html).not.toContain('Grill (');
      expect(grill.rendered_html).not.toContain('ORD-1');
      expect(grill.rendered_html).not.toContain('سالن');
    });

    it('prints the station, order type and time when the station asks for a detailed chit', async () => {
      stationRepo.rows.find((st) => st.id === 'st-grill').ticket_template = 'DETAILED';
      const [grill] = jobsFor(await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET'), 'prn-grill');

      expect(grill.rendered_html).toContain('<div class="inv">Grill (۱/۳)</div>');
      expect(grill.rendered_html).toContain('سالن');
    });

    it('labels each chit with its station and its part of the order', async () => {
      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');

      expect(jobs.map((j) => j.label)).toEqual(['Grill (1/3)', 'Fryer (2/3)', 'Bar (3/3)']);
      expect(jobsFor(jobs, 'prn-grill')[0].station_id).toBe('st-grill');
      expect(jobs.every((j) => j.status === 'SUCCESS')).toBe(true);
      expect(attemptRepo.rows).toHaveLength(3);
    });

    it('lets a product rule pull one burger off the grill', async () => {
      productRule('p-cheese', 'st-fryer');

      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');

      expect(jobsFor(jobs, 'prn-grill')[0].rendered_html).not.toContain('Cheeseburger');
      expect(jobsFor(jobs, 'prn-fryer')[0].rendered_html).toContain('Cheeseburger');
      expect(jobsFor(jobs, 'prn-fryer')[0].rendered_html).toContain('Fries');
    });

    it('prints a station chit on each of its printers, the station copies each', async () => {
      printer('prn-expo');
      const grill = stationRepo.rows.find((st) => st.id === 'st-grill');
      grill.printer_ids = ['prn-grill', 'prn-expo'];
      grill.copies = 2;

      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');

      expect(jobs.filter((j) => j.station_id === 'st-grill').map((j) => [j.printer_id, j.copies])).toEqual([
        ['prn-grill', 2],
        ['prn-expo', 2],
      ]);
    });

    it('reprints one station only when asked', async () => {
      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET', true, 'Fell in the fryer', undefined, undefined, 'st-fryer');

      expect(jobs.map((j) => j.printer_id)).toEqual(['prn-fryer']);
    });

    it('sends lines no station makes to the kitchen printer, and keeps one chit when nothing splits', async () => {
      order('ord-2', [line('l-tea', 'p-tea', 'Tea'), line('l-cake', 'p-cake', 'Cake')]);

      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-2', 'KITCHEN_TICKET');

      expect(jobs).toHaveLength(1);
      expect(jobs[0].printer_id).toBe('prn-pass');
      expect(jobs[0].label).toBe('آشپزخانه');
      expect(jobs[0].station_id).toBeUndefined();
    });

    it('prints on the kitchen printer for a station whose printers are all out of service', async () => {
      printerRepo.rows.find((p) => p.id === 'prn-bar').is_active = false;

      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');

      expect(jobs.find((j) => j.station_id === 'st-bar')!.printer_id).toBe('prn-pass');
    });

    it('prints a single receipt for the whole order at the till it was taken on', async () => {
      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'CUSTOMER_RECEIPT');

      expect(jobs).toHaveLength(1);
      expect(jobs[0].printer_id).toBe('prn-counter');
      expect(jobs[0].label).toBeUndefined();
      expect(jobs[0].rendered_html).toContain('Classic Burger');
      expect(jobs[0].rendered_html).toContain('Coke');
    });

    it("prints each till's receipts at its own counter", async () => {
      printer('prn-counter-2', { printer_type: 'THERMAL_RECEIPT' });
      till('till-2', { receipt_printer_id: 'prn-counter-2', receipt_copies: 2 });
      order('ord-till-2', [line('l-x', 'p-burger', 'Classic Burger')], { terminal_id: 'till-2' });

      const [first] = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'GUEST_BILL');
      const [second] = await queueService.enqueueOrderPrintJobs(T, 'ord-till-2', 'CUSTOMER_RECEIPT');

      expect([first.printer_id, first.copies]).toEqual(['prn-counter', 1]);
      expect([second.printer_id, second.copies]).toEqual(['prn-counter-2', 2]);
    });

    it('prints nothing for a kitchen ticket with no live lines', async () => {
      order('ord-3', [line('l-x', 'p-burger', 'Burger', 'VOID')]);

      expect(await queueService.enqueueOrderPrintJobs(T, 'ord-3', 'KITCHEN_TICKET')).toEqual([]);
      expect(jobRepo.rows).toHaveLength(0);
    });

    it('reprints one job on its own printer, not the whole order', async () => {
      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');
      const [grill] = jobsFor(jobs, 'prn-grill');

      const [reprint] = await queueService.reprintJob(T, grill.id, 'Paper jam', 'user-1');

      expect(jobRepo.rows).toHaveLength(4);
      expect(reprint.is_reprint).toBe(true);
      expect(reprint.printer_id).toBe('prn-grill');
      expect(reprint.label).toBe('Grill (1/3)');
      // The same chit, marked as a copy so the grill does not cook it twice.
      expect(grill.rendered_html).not.toContain('چاپ مجدد');
      expect(reprint.rendered_html).toContain('چاپ مجدد — نسخه تکراری');
      expect(reprint.rendered_html.replace(/<div class="box">چاپ مجدد — نسخه تکراری<\/div>/, '')).toBe(
        grill.rendered_html.replace('<!--gnext:reprint-->', ''),
      );
      expect(reprint.status).toBe('SUCCESS');
      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PRINT_JOB_REPRINTED', entityId: reprint.id }),
      );
    });

    // Routing's fallback covers a printer that reports failure. It does not cover the
    // everyday case: the device is simply gone — unplugged, out of paper, cooked — and the
    // chit has to come out somewhere else now.
    describe('reprinting on a printer chosen by hand', () => {
      it('sends the copy to the named printer and says so on the job', async () => {
        const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');
        const [grill] = jobsFor(jobs, 'prn-grill');

        const [reprint] = await queueService.reprintJob(T, grill.id, 'Grill printer died', 'user-1', 'prn-counter');

        expect(reprint.printer_id).toBe('prn-counter');
        expect(reprint.is_reprint).toBe(true);
        expect(reprint.rendered_html).toContain('Classic Burger');
        expect(reprint.rendered_html).toContain('چاپ مجدد');
        expect(reprint.reason).toContain('prn-counter');
      });

      it('drops the station link, so a later retry cannot send it back to the dead printer', async () => {
        const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');
        const [grill] = jobsFor(jobs, 'prn-grill');
        expect(grill.station_id).toBe('st-grill');

        const [reprint] = await queueService.reprintJob(T, grill.id, 'Grill printer died', 'user-1', 'prn-counter');

        expect(reprint.station_id).toBeNull();
      });

      it('refuses a printer that belongs to another branch', async () => {
        printer('prn-other-site', { branch_id: 'br-2' });
        const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');
        const [grill] = jobsFor(jobs, 'prn-grill');

        await expect(
          queueService.reprintJob(T, grill.id, 'Wrong site', 'user-1', 'prn-other-site'),
        ).rejects.toThrow('different branch');
      });

      it('refuses a printer that does not exist', async () => {
        const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');
        const [grill] = jobsFor(jobs, 'prn-grill');

        await expect(
          queueService.reprintJob(T, grill.id, 'Typo', 'user-1', 'prn-nonexistent'),
        ).rejects.toThrow('not found');
      });
    });
  });

  // --- failure --------------------------------------------------------------------------

  it('should enqueue print job and execute simulation outcome with fallback printer', async () => {
    order('ord-100', [line('l-1', 'p-pizza', 'Pizza')]);
    printer('prn-main', { fallback_printer_id: 'prn-backup' });

    const [job] = await queueService.enqueueOrderPrintJobs(T, 'ord-100');
    expect(job.printer_id).toBe('prn-main');

    const outcomeRes = await queueService.processSimulationOutcome(T, {
      printJobId: job.id,
      outcome: 'FAILED',
      useFallback: true,
    });

    expect(outcomeRes.attempt.status).toBe('FAILED');
    expect(outcomeRes.attempt.printer_id).toBe('prn-backup');
  });

  // The Test button used to show "printed cleanly" without sending anything.
  describe('a test page', () => {
    it('goes to the printer through the branch agent, as a job the queue shows', async () => {
      printer('prn-counter', { name: 'Counter', agent_connection: { kind: 'tcp', host: '192.168.1.90', port: 9100 } });

      const job = await queueService.testPrint(T, 'prn-counter', 'user-1');

      expect(job).toMatchObject({ document_type: 'TEST_PRINT', printer_id: 'prn-counter', branch_id: BR, status: 'PROCESSING' });
      expect(job.rendered_html).toContain('Counter');
      expect(agentPrinting.send).toHaveBeenCalledWith(T, job, expect.objectContaining({ id: 'prn-counter' }), 1);
    });

    it('is refused for a printer the agent does not drive', async () => {
      printer('prn-sim', { name: 'Simulated' });

      await expect(queueService.testPrint(T, 'prn-sim')).rejects.toThrow(/not connected to the branch agent/);
      expect(jobRepo.rows).toHaveLength(0);
    });
  });

  describe('a real printer behind the branch agent', () => {
    beforeEach(() => {
      order('ord-400', [line('l-1', 'p-burger', 'Burger')]);
      printer('prn-kitchen', { printer_type: 'KITCHEN_IMPACT', agent_connection: { kind: 'tcp', host: '192.168.1.83', port: 9100 }, fallback_printer_id: 'prn-counter' });
      printer('prn-counter');
    });

    // Retry used to go to the fallback printer every time: a kitchen chit retried after the
    // kitchen printer was fixed came out at the counter instead.
    it('retries a failed job on its own printer', async () => {
      const [job] = await queueService.enqueueOrderPrintJobs(T, 'ord-400', 'KITCHEN_TICKET');
      expect(job.printer_id).toBe('prn-kitchen');
      job.status = 'FAILED';

      await queueService.retryJob(T, job.id, {});

      expect(agentPrinting.send).toHaveBeenLastCalledWith(T, expect.objectContaining({ id: job.id }), expect.objectContaining({ id: 'prn-kitchen' }), expect.any(Number));
    });

    it('refuses to simulate the outcome of a job a real printer is handling', async () => {
      const [job] = await queueService.enqueueOrderPrintJobs(T, 'ord-400', 'KITCHEN_TICKET');

      await expect(queueService.processSimulationOutcome(T, { printJobId: job.id, outcome: 'SUCCESS' })).rejects.toThrow(
        /cannot be simulated/,
      );
    });
  });

  // The 2026-09-16 audit found every print job in the demo still QUEUED with no printer and
  // no attempt: the branch had no printers, and a kitchen ticket that went nowhere looked
  // exactly like one that printed.
  describe('a document with no printer to go to', () => {
    beforeEach(() => {
      order('ord-300', [line('l-1', 'p-burger', 'Burger')]);
    });

    it('fails the job, records why, and raises a critical alert for a kitchen ticket', async () => {
      const [job] = await queueService.enqueueOrderPrintJobs(T, 'ord-300', 'KITCHEN_TICKET');

      expect(job.status).toBe('FAILED');
      expect(attemptRepo.save).not.toHaveBeenCalled();
      expect(alertRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ branch_id: BR, type: 'PRINT_UNROUTED', severity: 'CRITICAL', acknowledged: false }),
      );
      expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'PRINT_JOB_UNROUTED' }));
      expect(auditWriter.write).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'PRINT_JOB_ENQUEUED' }));
    });

    it('raises one open alert per branch and document, not one per order', async () => {
      alertRepo.rows.push({
        id: 'alert-open',
        tenant_id: T,
        branch_id: BR,
        type: 'PRINT_UNROUTED',
        title: 'No printer for CUSTOMER_RECEIPT',
        acknowledged: false,
      });

      const [job] = await queueService.enqueueOrderPrintJobs(T, 'ord-300', 'CUSTOMER_RECEIPT');

      expect(job.status).toBe('FAILED');
      expect(alertRepo.save).not.toHaveBeenCalled();
    });

    it('says what is missing when retried before a printer exists', async () => {
      const [job] = await queueService.enqueueOrderPrintJobs(T, 'ord-300', 'KITCHEN_TICKET');

      await expect(queueService.retryJob(T, job.id, {})).rejects.toThrow(/No printer is in service for KITCHEN_TICKET/);
    });

    it('prints on retry once the branch has a printer', async () => {
      const [job] = await queueService.enqueueOrderPrintJobs(T, 'ord-300', 'KITCHEN_TICKET');
      printer('prn-kitchen', { printer_type: 'KITCHEN_IMPACT', agent_connection: TCP });

      const res = await queueService.retryJob(T, job.id, {});

      expect(res.job.printer_id).toBe('prn-kitchen');
      expect(res.attempt.printer_id).toBe('prn-kitchen');
      expect(res.job.status).toBe('PROCESSING');
    });

    // The audit of 2026-09-24: a failed grill chit, retried, was routed as though it were a
    // receipt and went to whichever kitchen printer came first — the bar's.
    it('sends a failed station chit to its own station, on every printer the station has now', async () => {
      product('p-burger', 'cat-burgers');
      station('st-grill', 'Grill', []);
      categoryRule('cat-burgers', 'st-grill');
      const [job] = await queueService.enqueueOrderPrintJobs(T, 'ord-300', 'KITCHEN_TICKET');
      expect(job.status).toBe('FAILED');
      expect(job.station_id).toBe('st-grill');

      printer('prn-bar', { code: 'A', printer_type: 'KITCHEN_IMPACT', agent_connection: TCP });
      printer('prn-grill-1', { code: 'B', printer_type: 'KITCHEN_IMPACT', agent_connection: TCP });
      printer('prn-grill-2', { code: 'C', printer_type: 'KITCHEN_IMPACT', agent_connection: TCP });
      stationRepo.rows[0].printer_ids = ['prn-grill-1', 'prn-grill-2'];

      const res = await queueService.retryJob(T, job.id, {});

      expect(res.jobs.map((j) => j.printer_id)).toEqual(['prn-grill-1', 'prn-grill-2']);
      expect(res.jobs[0].id).toBe(job.id);
      expect(res.jobs[1].rendered_html).toBe(job.rendered_html);
      expect(agentPrinting.send).toHaveBeenCalledTimes(2);
    });
  });

  // A retry used to fall through to the simulator for any printer the agent does not drive,
  // and mark the job printed: a chit nobody saw, reported as on the rail.
  describe('retrying where nothing can print', () => {
    beforeEach(() => {
      order('ord-500', [line('l-1', 'p-burger', 'Burger')]);
    });

    it('refuses a printer the branch agent does not drive, and leaves the job failed', async () => {
      printer('prn-sim');
      const [job] = await queueService.enqueueOrderPrintJobs(T, 'ord-500');
      job.status = 'FAILED';
      const attempts = attemptRepo.rows.length;

      await expect(queueService.retryJob(T, job.id, {})).rejects.toThrow(/not connected to the branch agent/);
      expect(job.status).toBe('FAILED');
      expect(attemptRepo.rows).toHaveLength(attempts);
    });

    it('refuses a job whose printer has been removed', async () => {
      printer('prn-gone', { agent_connection: TCP });
      const [job] = await queueService.enqueueOrderPrintJobs(T, 'ord-500');
      job.status = 'FAILED';
      printerRepo.rows.splice(printerRepo.rows.findIndex((p) => p.id === 'prn-gone'), 1);

      await expect(queueService.retryJob(T, job.id, {})).rejects.toThrow(/has been removed/);
      expect(job.status).toBe('FAILED');
    });
  });

  // --- changes after the kitchen has the order ------------------------------------------

  describe('kitchen change tickets', () => {
    beforeEach(() => {
      burgerShop();
      order('ord-200', [
        line('l-1', 'p-burger', 'Kebab Burger', 'VOID'),
        line('l-2', 'p-coke', 'Doogh'),
        line('l-3', 'p-fries', 'Baklava Fries'),
        line('l-4', 'p-cheese', 'Cheeseburger'),
      ]);
    });

    it('prints only the delta, each station getting its own lines', async () => {
      const jobs = await queueService.enqueueKitchenChangeTicket(T, 'ord-200', {
        kind: 'AMENDED',
        voidedItemIds: ['l-1'],
        addedItemIds: ['l-3'],
        reason: 'Swapped main for dessert',
      });

      expect(jobs).toHaveLength(2);
      const [grill] = jobsFor(jobs, 'prn-grill');
      const [fryer] = jobsFor(jobs, 'prn-fryer');
      expect(grill.document_type).toBe('KITCHEN_TICKET');
      expect(grill.rendered_html).toContain('تغییر سفارش');
      expect(grill.rendered_html).toMatch(/حذف<\/span><span class="void">۱ × Kebab Burger/);
      expect(grill.rendered_html).not.toContain('Baklava');
      expect(fryer.rendered_html).toMatch(/اضافه<\/span><span>۱ × Baklava Fries/);
      expect(jobs.some((j) => j.rendered_html.includes('Doogh'))).toBe(false);
      expect(jobsFor(jobs, 'prn-bar')).toHaveLength(0);
      expect(grill.reason).toBe('Order amended: Swapped main for dessert');
    });

    it('tells every station holding live lines to stop when the order is cancelled', async () => {
      const jobs = await queueService.enqueueKitchenChangeTicket(T, 'ord-200', { kind: 'CANCELLED' });

      expect(jobs.map((j) => j.printer_id).sort()).toEqual(['prn-bar', 'prn-fryer', 'prn-grill']);
      expect(jobs.every((j) => j.rendered_html.includes('لغو سفارش — آماده نکنید'))).toBe(true);
      expect(jobsFor(jobs, 'prn-grill')[0].rendered_html).toContain('Cheeseburger');
      // Already struck off by an earlier edit, and already told to the kitchen then.
      expect(jobs.some((j) => j.rendered_html.includes('Kebab'))).toBe(false);
    });

    it('prints nothing when the change touches no line on the order', async () => {
      const jobs = await queueService.enqueueKitchenChangeTicket(T, 'ord-200', {
        kind: 'AMENDED',
        voidedItemIds: ['not-on-this-order'],
        addedItemIds: [],
      });

      expect(jobs).toEqual([]);
      expect(jobRepo.save).not.toHaveBeenCalled();
    });

    it('leaves voided lines off a kitchen reprint of the order', async () => {
      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-200', 'KITCHEN_TICKET', true, 'Paper jam');

      expect(jobs.some((j) => j.rendered_html.includes('Kebab'))).toBe(false);
      expect(jobsFor(jobs, 'prn-bar')[0].rendered_html).toContain('Doogh');
      expect(jobs.every((j) => j.is_reprint && j.rendered_html.includes('چاپ مجدد — نسخه تکراری'))).toBe(true);
    });
  });
});
