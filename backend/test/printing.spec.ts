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
import { PrintRoute } from '../src/entities/PrintRoute.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
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
  let terminalRepo: ReturnType<typeof fakeRepo>;
  let jobRepo: ReturnType<typeof fakeRepo>;
  let attemptRepo: ReturnType<typeof fakeRepo>;
  let orderRepo: ReturnType<typeof fakeRepo>;
  let productRepo: ReturnType<typeof fakeRepo>;
  let routeRepo: ReturnType<typeof fakeRepo>;
  let auditWriter: { write: jest.Mock };
  let agentPrinting: { send: jest.Mock };

  const T = 't-1';
  const BR = 'br-1';
  /** A printer the branch agent drives. */
  const TCP = { kind: 'tcp', host: '192.168.1.90', port: 9100 };

  beforeEach(async () => {
    printerRepo = fakeRepo();
    terminalRepo = fakeRepo();
    jobRepo = fakeRepo();
    attemptRepo = fakeRepo();
    orderRepo = fakeRepo();
    productRepo = fakeRepo();
    routeRepo = fakeRepo();
    auditWriter = { write: jest.fn() };
    agentPrinting = {
      send: jest.fn(async (_t: string, job: any, printer: any, attemptNo: number) => {
        job.status = 'PROCESSING';
        return { job, attempt: { job_id: job.id, printer_id: printer.id, attempt_no: attemptNo, status: 'PENDING' } };
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrintRenderService,
        PrintRoutingService,
        PrintQueueService,
        { provide: getRepositoryToken(Printer), useValue: printerRepo },
        { provide: getRepositoryToken(Terminal), useValue: terminalRepo },
        { provide: getRepositoryToken(PrintJob), useValue: jobRepo },
        { provide: getRepositoryToken(PrintAttempt), useValue: attemptRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(PrintRoute), useValue: routeRepo },
        { provide: AuditWriter, useValue: auditWriter },
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
  const categoryRoute = (categoryId: string, printerId: string) =>
    routeRepo.rows.push({ tenant_id: T, branch_id: BR, category_id: categoryId, printer_id: printerId });
  const productRoute = (productId: string, printerId: string | null) =>
    routeRepo.rows.push({ tenant_id: T, branch_id: BR, product_id: productId, printer_id: printerId });
  /** On the branch's "not printed" list: no kitchen chit. */
  const notPrintedCategory = (categoryId: string) =>
    routeRepo.rows.push({ tenant_id: T, branch_id: BR, category_id: categoryId, printer_id: null });
  const till = (id: string, extra: any = {}) =>
    terminalRepo.rows.push({ id, tenant_id: T, branch_id: BR, terminal_type: 'CASHIER', receipt_printer_id: null, ...extra });
  const product = (id: string, categoryId: string, name = id) => productRepo.rows.push({ id, tenant_id: T, category_id: categoryId, name });
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
   * A burger shop: a grill, a fryer and a bar printer; a pass printer in the kitchen for
   * anything nothing routes; and a counter printer at the till.
   */
  const burgerShop = () => {
    printer('prn-counter', { printer_type: 'THERMAL_RECEIPT', receipt_default: true });
    printer('prn-grill', { name: 'Grill' });
    printer('prn-fryer', { name: 'Fryer' });
    printer('prn-bar', { name: 'Bar' });
    printer('prn-pass', { name: 'pass', kitchen_default: true, printer_type: 'KITCHEN_IMPACT' });
    product('p-burger', 'cat-burgers');
    product('p-cheese', 'cat-burgers');
    product('p-fries', 'cat-sides');
    product('p-coke', 'cat-drinks');
    categoryRoute('cat-burgers', 'prn-grill');
    categoryRoute('cat-sides', 'prn-fryer');
    categoryRoute('cat-drinks', 'prn-bar');
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
    expect(html).toContain('۳٬۰۰۰٬۰۰۰');
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
    expect(html).toContain('دریافت از مشتری: ۱۰۰٬۰۰۰ تومان');
  });

  // --- where a line and a document go ---------------------------------------------------

  describe('finding where paper goes', () => {
    it("sends a product to its own printers before its category's, and anything else to the default", async () => {
      printer('prn-grill');
      printer('prn-fryer');
      printer('prn-expo');
      printer('prn-pass', { kitchen_default: true, printer_type: 'KITCHEN_IMPACT' });
      product('p-burger', 'cat-burgers');
      product('p-egg-burger', 'cat-burgers');
      product('p-tea', 'cat-hot');
      categoryRoute('cat-burgers', 'prn-grill');
      categoryRoute('cat-burgers', 'prn-expo');
      productRoute('p-egg-burger', 'prn-fryer');

      const printers = await routingService.routeProducts(T, BR, ['p-burger', 'p-egg-burger', 'p-tea']);

      expect(printers.get('p-burger')!.printers.map((p) => p.id)).toEqual(['prn-grill', 'prn-expo']);
      expect(printers.get('p-egg-burger')!.printers.map((p) => p.id)).toEqual(['prn-fryer']);
      expect(printers.get('p-tea')!.printers.map((p) => p.id)).toEqual(['prn-pass']);
      expect([...printers.values()].map((r) => r.source)).toEqual(['CATEGORY', 'PRODUCT', 'DEFAULT']);
    });

    it('keeps a category on the "not printed" list off every kitchen printer, unless a product is sent somewhere', async () => {
      printer('prn-pass', { kitchen_default: true, printer_type: 'KITCHEN_IMPACT' });
      printer('prn-bar');
      product('p-coke', 'cat-drinks');
      product('p-lemonade', 'cat-drinks');
      notPrintedCategory('cat-drinks');
      productRoute('p-lemonade', 'prn-bar');

      const printers = await routingService.routeProducts(T, BR, ['p-coke', 'p-lemonade']);

      expect(printers.get('p-coke')).toEqual({ printers: [], source: 'NOT_PRINTED' });
      expect(printers.get('p-lemonade')!.printers.map((p) => p.id)).toEqual(['prn-bar']);
    });

    it('says a product has nowhere to print when the branch has no kitchen printer', async () => {
      printer('prn-counter', { printer_type: 'THERMAL_RECEIPT' });
      product('p-tea', 'cat-hot');

      expect((await routingService.routeProducts(T, BR, ['p-tea'])).get('p-tea')).toEqual({ printers: [], source: 'NOWHERE' });
    });

    it('prints on the printer the branch marked as its default kitchen printer', async () => {
      printer('prn-a', { printer_type: 'KITCHEN_IMPACT' });
      printer('prn-b', { printer_type: 'KITCHEN_IMPACT', kitchen_default: true });
      product('p-tea', 'cat-hot');

      const printers = await routingService.routeProducts(T, BR, ['p-tea']);

      expect(printers.get('p-tea')!.printers.map((p) => p.id)).toEqual(['prn-b']);
    });

    it('keeps a routed printer that is out of service, so its chit fails visibly, and never picks a default nobody chose', async () => {
      printer('prn-kitchen', { kitchen_default: true, printer_type: 'KITCHEN_IMPACT' });
      printer('prn-dead', { is_active: false });
      product('p-burger', 'cat-burgers');
      categoryRoute('cat-burgers', 'prn-dead');

      printer('prn-other', { printer_type: 'KITCHEN_IMPACT' });
      product('p-tea', 'cat-drinks');

      const printers = await routingService.routeProducts(T, BR, ['p-burger', 'p-tea']);

      expect(printers.get('p-burger')!.printers.map((p) => p.id)).toEqual(['prn-dead']);
      expect(printers.get('p-tea')).toMatchObject({ source: 'DEFAULT' });
      expect(printers.get('p-tea')!.printers.map((p) => p.id)).toEqual(['prn-kitchen']);

      printerRepo.rows.find((p) => p.id === 'prn-kitchen').kitchen_default = false;
      const none = await routingService.routeProducts(T, BR, ['p-tea']);
      expect(none.get('p-tea')).toMatchObject({ source: 'NOWHERE', printers: [] });
    });

    it("prints a receipt on the till's own printer, one copy, on the till's paper", async () => {
      printer('prn-counter-1', { printer_type: 'THERMAL_RECEIPT' });
      printer('prn-counter-2', { printer_type: 'THERMAL_RECEIPT' });
      till('till-1', { receipt_printer_id: 'prn-counter-1' });
      till('till-2', { receipt_printer_id: 'prn-counter-2', receipt_template: 'COMPACT' });

      const one = await routingService.printersForDocument(T, BR, 'till-1');
      const two = await routingService.printersForDocument(T, BR, 'till-2');

      expect(one.printers.map((r) => [r.printer.id, r.copies])).toEqual([['prn-counter-1', 1]]);
      expect(two.printers.map((r) => [r.printer.id, r.copies])).toEqual([['prn-counter-2', 1]]);
      expect(two.template).toBe('COMPACT');
    });

    it("prints a kiosk guest's receipt on the kiosk's own printer", async () => {
      printer('prn-counter', { printer_type: 'THERMAL_RECEIPT' });
      printer('prn-kiosk', { printer_type: 'THERMAL_RECEIPT' });
      till('kiosk-1', { terminal_type: 'KIOSK', receipt_printer_id: 'prn-kiosk' });

      const routed = await routingService.printersForDocument(T, BR, 'kiosk-1');

      expect(routed.printers.map((r) => r.printer.id)).toEqual(['prn-kiosk']);
    });

    it("prints on the branch's default receipt printer for an order from no till, or a till with no printer", async () => {
      printer('prn-kitchen', { kitchen_default: true, printer_type: 'KITCHEN_IMPACT' });
      printer('prn-counter', { printer_type: 'THERMAL_RECEIPT' });
      printer('prn-front', { printer_type: 'THERMAL_RECEIPT', receipt_default: true });
      till('till-1');

      expect((await routingService.printersForDocument(T, BR, null)).printers.map((r) => r.printer.id)).toEqual(['prn-front']);
      expect((await routingService.printersForDocument(T, BR, 'till-1')).printers.map((r) => r.printer.id)).toEqual(['prn-front']);
    });

    it('never guesses a receipt printer: with no default chosen there is none, and the job fails', async () => {
      printer('prn-counter', { printer_type: 'THERMAL_RECEIPT' });

      expect((await routingService.printersForDocument(T, BR, null)).printers).toEqual([]);
    });

    it("keeps a till's own printer taken out of service, so its receipt fails where it can be seen", async () => {
      printer('prn-counter', { printer_type: 'THERMAL_RECEIPT', receipt_default: true });
      printer('prn-dead', { printer_type: 'THERMAL_RECEIPT', is_active: false });
      till('till-1', { receipt_printer_id: 'prn-dead' });

      expect((await routingService.printersForDocument(T, BR, 'till-1')).printers.map((r) => r.printer.id)).toEqual(['prn-dead']);
    });
  });

  // --- the split ------------------------------------------------------------------------

  describe('splitting a kitchen ticket by printer', () => {
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

    it('prints one chit per printer with only that printer its lines', async () => {
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

    // What an Iranian kitchen works from: the number, very large, and the printer's food; with
    // how the order leaves, its note, and which other stations are making the rest of it.
    it('prints a compact chit: the big number, how it leaves, the items, the note and the other stations', async () => {
      const ord = orderRepo.rows.find((o) => o.id === 'ord-1');
      ord.call_number = 123;
      ord.notes = 'Allergic to nuts';
      const [grill] = jobsFor(await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET'), 'prn-grill');

      expect(grill.rendered_html).toContain('<div class="huge">۱۲۳</div>');
      expect(grill.rendered_html).toMatch(/<div class="c title">سالن · [۰-۹]{2}:[۰-۹]{2}<\/div>/);
      expect(grill.rendered_html).toContain('Classic Burger');
      expect(grill.rendered_html).toContain('توضیحات سفارش: Allergic to nuts');
      expect(grill.rendered_html).toContain('بخش‌های دیگر: Fryer، Bar');
      expect(grill.rendered_html).not.toContain('ORD-1');
    });

    it('prints nothing in the kitchen for a category on the "not printed" list', async () => {
      routeRepo.rows.splice(routeRepo.rows.findIndex((r) => r.category_id === 'cat-drinks'), 1);
      notPrintedCategory('cat-drinks');

      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');

      expect(jobs.map((j) => j.label)).toEqual(['Grill (1/2)', 'Fryer (2/2)']);
      expect(jobs.some((j) => j.rendered_html.includes('Coke'))).toBe(false);
    });

    it('prints no job, and logs nothing unrouted, for an order of nothing but unprinted items', async () => {
      notPrintedCategory('cat-drinks');
      routeRepo.rows.splice(routeRepo.rows.findIndex((r) => r.category_id === 'cat-drinks' && r.printer_id), 1);
      order('ord-cola', [line('l-coke', 'p-coke', 'Coke')]);

      expect(await queueService.enqueueOrderPrintJobs(T, 'ord-cola', 'KITCHEN_TICKET')).toEqual([]);
      expect(auditWriter.write).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'PRINT_JOB_UNROUTED' }));
    });

    it('prints the whole order once more at the pass, unprinted items included', async () => {
      printerRepo.rows.find((p) => p.id === 'prn-pass').prints_whole_order = true;
      routeRepo.rows.splice(routeRepo.rows.findIndex((r) => r.category_id === 'cat-drinks'), 1);
      notPrintedCategory('cat-drinks');

      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');

      expect(jobs.map((j) => j.label)).toEqual(['Grill (1/2)', 'Fryer (2/2)', 'pass']);
      const [pass] = jobsFor(jobs, 'prn-pass');
      expect(pass.rendered_html).toContain('کل سفارش');
      for (const name of ['Classic Burger', 'Cheeseburger', 'Fries', 'Coke']) expect(pass.rendered_html).toContain(name);
      expect(pass.rendered_html).not.toContain('Fanta');
      expect(pass.rendered_html).not.toContain('بخش‌های دیگر');
    });

    it('previews the chits a made-up order would print, and queues nothing', async () => {
      product('p-burger', 'cat-burgers', 'Classic Burger');
      product('p-fries', 'cat-sides', 'Fries');
      product('p-coke', 'cat-drinks', 'Coke');
      routeRepo.rows.splice(routeRepo.rows.findIndex((r) => r.category_id === 'cat-drinks'), 1);
      notPrintedCategory('cat-drinks');
      jobRepo.save.mockClear();

      const preview = await queueService.previewKitchenChits(T, BR, {
        product_ids: ['p-burger', 'p-fries', 'p-coke'],
        order_type: 'AGGREGATOR',
        notes: 'No onion',
      });

      expect(preview.chits.map((c) => [c.printer_id, c.label])).toEqual([
        ['prn-grill', 'Grill (1/2)'],
        ['prn-fryer', 'Fryer (2/2)'],
      ]);
      expect(preview.chits[0].html).toContain('Classic Burger');
      expect(preview.chits[0].html).toContain('اسنپ‌فود');
      expect(preview.chits[0].html).toContain('No onion');
      expect(preview.not_printed).toEqual(['Coke']);
      expect(jobRepo.save).not.toHaveBeenCalled();
    });

    it('labels each chit with its printer and its part of the order', async () => {
      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');

      expect(jobs.map((j) => j.label)).toEqual(['Grill (1/3)', 'Fryer (2/3)', 'Bar (3/3)']);
      expect(jobs.every((j) => j.status === 'SUCCESS')).toBe(true);
      expect(attemptRepo.rows).toHaveLength(3);
    });

    it('lets a product route pull one burger off the grill', async () => {
      productRoute('p-cheese', 'prn-fryer');

      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');

      expect(jobsFor(jobs, 'prn-grill')[0].rendered_html).not.toContain('Cheeseburger');
      expect(jobsFor(jobs, 'prn-fryer')[0].rendered_html).toContain('Cheeseburger');
      expect(jobsFor(jobs, 'prn-fryer')[0].rendered_html).toContain('Fries');
    });

    it('prints a line on every printer its category goes to', async () => {
      printer('prn-expo', { name: 'Expo' });
      categoryRoute('cat-burgers', 'prn-expo');

      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');

      expect(jobsFor(jobs, 'prn-grill')[0].rendered_html).toContain('Classic Burger');
      expect(jobsFor(jobs, 'prn-expo')[0].rendered_html).toContain('Classic Burger');
      expect(jobsFor(jobs, 'prn-expo')[0].rendered_html).not.toContain('Fries');
    });

    it("reprints one printer's chit only when asked", async () => {
      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET', true, 'Fell in the fryer', undefined, undefined, 'prn-fryer');

      expect(jobs.map((j) => j.printer_id)).toEqual(['prn-fryer']);
    });

    it('sends lines nothing routes to the default kitchen printer, and keeps one chit when nothing splits', async () => {
      order('ord-2', [line('l-tea', 'p-tea', 'Tea'), line('l-cake', 'p-cake', 'Cake')]);

      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-2', 'KITCHEN_TICKET');

      expect(jobs).toHaveLength(1);
      expect(jobs[0].printer_id).toBe('prn-pass');
      expect(jobs[0].label).toBe('pass');
    });

    it('fails the chit of a routed printer that is out of service, and still prints the others', async () => {
      printerRepo.rows.find((p) => p.id === 'prn-bar').is_active = false;

      const jobs = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'KITCHEN_TICKET');

      const [bar] = jobsFor(jobs, 'prn-bar');
      expect(bar.status).toBe('FAILED');
      expect(bar.rendered_html).toContain('Coke');
      expect(jobsFor(jobs, 'prn-grill')[0].status).toBe('SUCCESS');
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
      till('till-2', { receipt_printer_id: 'prn-counter-2' });
      order('ord-till-2', [line('l-x', 'p-burger', 'Classic Burger')], { terminal_id: 'till-2' });

      const [first] = await queueService.enqueueOrderPrintJobs(T, 'ord-1', 'GUEST_BILL');
      const [second] = await queueService.enqueueOrderPrintJobs(T, 'ord-till-2', 'CUSTOMER_RECEIPT');

      expect([first.printer_id, first.copies]).toEqual(['prn-counter', 1]);
      expect([second.printer_id, second.copies]).toEqual(['prn-counter-2', 1]);
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
      printer('prn-kitchen', { kitchen_default: true, printer_type: 'KITCHEN_IMPACT', agent_connection: { kind: 'tcp', host: '192.168.1.83', port: 9100 } });
      printer('prn-counter');
    });

    // A failed kitchen chit is reprinted by a person, on its own printer once fixed (K-20).
    it('reprints a failed job on its own printer', async () => {
      const [job] = await queueService.enqueueOrderPrintJobs(T, 'ord-400', 'KITCHEN_TICKET');
      expect(job.printer_id).toBe('prn-kitchen');
      job.status = 'FAILED';

      const [copy] = await queueService.reprintJob(T, job.id, 'Printer fixed', 'user-1');

      expect(copy).toMatchObject({ printer_id: 'prn-kitchen', is_reprint: true });
      expect(agentPrinting.send).toHaveBeenLastCalledWith(T, expect.objectContaining({ id: copy.id }), expect.objectContaining({ id: 'prn-kitchen' }), expect.any(Number));
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

    it('fails the job and records why', async () => {
      const [job] = await queueService.enqueueOrderPrintJobs(T, 'ord-300', 'KITCHEN_TICKET');

      expect(job.status).toBe('FAILED');
      expect(attemptRepo.save).not.toHaveBeenCalled();
      expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'PRINT_JOB_UNROUTED' }));
      expect(auditWriter.write).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'PRINT_JOB_ENQUEUED' }));
    });

    it('prints on a reprint once the branch has a default kitchen printer', async () => {
      const [job] = await queueService.enqueueOrderPrintJobs(T, 'ord-300', 'KITCHEN_TICKET');
      expect(job.status).toBe('FAILED');
      printer('prn-pass', { code: 'B', printer_type: 'KITCHEN_IMPACT', agent_connection: TCP, kitchen_default: true });

      const [copy] = await queueService.reprintJob(T, job.id, 'Printer added', 'user-1');

      expect(copy.printer_id).toBe('prn-pass');
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

    it('prints only the delta, each printer getting its own lines', async () => {
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
      expect(grill.rendered_html).toContain('علت: Swapped main for dessert');
    });

    it('sends a void to the printer the line first went to, even after the routing changed', async () => {
      const kebab = orderRepo.rows.find((o: any) => o.id === 'ord-200').items.find((i: any) => i.id === 'l-1');
      kebab.kitchen_printer_ids = ['prn-bar'];

      const jobs = await queueService.enqueueKitchenChangeTicket(T, 'ord-200', { kind: 'AMENDED', voidedItemIds: ['l-1'], addedItemIds: [] });

      expect(jobs.map((j) => j.printer_id)).toEqual(['prn-bar']);
      expect(jobs[0].rendered_html).toContain('Kebab Burger');
    });

    it('tells every printer holding live lines to stop when the order is cancelled', async () => {
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
