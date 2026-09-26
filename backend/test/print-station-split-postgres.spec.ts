import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { OrderService } from '../src/modules/order/order.service';
import { KdsService } from '../src/modules/kds/kds.service';
import { PrintQueueService } from '../src/modules/printing/print-queue.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { Printer } from '../src/entities/Printer.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { PrintJob } from '../src/entities/PrintJob.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { ReasonCode } from '../src/entities/ReasonCode.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// Station printing end to end: the real order flow, the real routing queries, the real
// print_job rows. A burger shop with a grill, a fryer and a bar, a kitchen printer catching
// anything no station makes, and a till with its own receipt printer.
describe('kitchen tickets split by station (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: OrderService;
  let kds: KdsService;
  let printQueue: PrintQueueService;
  let tenantId: string;
  let branchId: string;
  let reasonCodeId: string;
  let tillId: string;
  const productIds: Record<string, string> = {};
  const printerIds: Record<string, string> = {};

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    orders = moduleRef.get(OrderService);
    kds = moduleRef.get(KdsService);
    printQueue = moduleRef.get(PrintQueueService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;

    tenantId = (
      await save(Tenant, { code: `PRSPLIT-${Date.now()}`, name: 'Station print fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    reasonCodeId = (await save(ReasonCode, { tenant_id: tenantId, code: 'PRS-CHANGE', name: 'Guest changed their mind', type: 'VOID' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'PRS', name: 'Print split branch', is_active: true, time_zone: 'Asia/Tehran' })).id;

    const category = async (code: string) => (await save(Category, { tenant_id: tenantId, code, name: code, is_active: true })).id;
    const burgers = await category('PRS-BURGERS');
    const sides = await category('PRS-SIDES');
    const drinks = await category('PRS-DRINKS');
    const desserts = await category('PRS-DESSERTS');

    const product = async (code: string, categoryId: string) => {
      productIds[code] = (
        await save(Product, { tenant_id: tenantId, category_id: categoryId, code, name: code, base_price: '100000.0000', tax_rate: '0.0900' })
      ).id;
    };
    await product('BURGER', burgers);
    await product('FRIES', sides);
    await product('COLA', drinks);
    await product('CAKE', desserts);

    // The kitchen printer sorts first by code, so it is the branch's fallback for kitchen chits.
    const printer = async (name: string, code: string, printer_type = 'KITCHEN_IMPACT') => {
      printerIds[name] = (await save(Printer, { tenant_id: tenantId, branch_id: branchId, code, name, printer_type, is_active: true })).id;
    };
    await printer('PRN-KITCHEN', 'K-00');
    await printer('PRN-GRILL', 'K-10');
    await printer('PRN-FRYER', 'K-20');
    await printer('PRN-BAR', 'K-30');
    await printer('PRN-PASS', 'K-40');
    await printer('PRN-TILL', 'R-10', 'THERMAL_RECEIPT');

    const station = async (code: string, printers: string[], copies = 1) =>
      (await kds.createStation(tenantId, { branch_id: branchId, code, name: code, printer_ids: printers.map((n) => printerIds[n]), copies })).id;
    const grill = await station('Grill', ['PRN-GRILL'], 2);
    const fryer = await station('Fryer', ['PRN-FRYER']);
    // The bar has a printer at the bar and one at the pass.
    const bar = await station('Bar', ['PRN-BAR', 'PRN-PASS']);

    await kds.createRoutingRule(tenantId, { branch_id: branchId, station_id: grill, category_id: burgers });
    await kds.createRoutingRule(tenantId, { branch_id: branchId, station_id: fryer, category_id: sides });
    await kds.createRoutingRule(tenantId, { branch_id: branchId, station_id: bar, category_id: drinks });

    tillId = (
      await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'PRS-T1', name: 'Till 1', terminal_type: 'CASHIER', receipt_printer_id: printerIds['PRN-TILL'] })
    ).id;
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const jobsFor = (orderId: string) =>
    dataSource.getRepository(PrintJob).find({ where: { tenant_id: tenantId, entity_id: orderId }, order: { created_at: 'ASC' } });
  const onPrinter = (jobs: PrintJob[], name: string) => jobs.filter((j) => j.printer_id === printerIds[name]);

  let orderId: string;

  it('prints a chit per station on submit, and no receipt before the order is paid', async () => {
    const draft = await orders.createDraft(tenantId, {
      branch_id: branchId,
      order_type: 'DINE_IN',
      items: [
        { product_id: productIds.BURGER, quantity: 2 },
        { product_id: productIds.FRIES, quantity: 1 },
        { product_id: productIds.COLA, quantity: 2 },
        { product_id: productIds.CAKE, quantity: 1 },
      ],
    } as any);
    await orders.submitOrder(tenantId, draft.id, {} as any);
    orderId = draft.id;

    const jobs = await jobsFor(orderId);
    const receipts = jobs.filter((j) => j.document_type === 'CUSTOMER_RECEIPT');
    const kitchen = jobs.filter((j) => j.document_type === 'KITCHEN_TICKET');

    expect(receipts).toHaveLength(0);

    // Grill, Fryer, Bar (two printers) and the kitchen printer for the cake.
    expect(kitchen).toHaveLength(5);
    expect(kitchen.every((j) => j.status === 'SUCCESS')).toBe(true);

    const [grill] = onPrinter(kitchen, 'PRN-GRILL');
    expect(grill.label).toBe('Grill (1/4)');
    expect(grill.copies).toBe(2);
    expect(grill.rendered_html).toContain('BURGER');
    expect(grill.rendered_html).not.toContain('COLA');

    const [fryer] = onPrinter(kitchen, 'PRN-FRYER');
    expect(fryer.rendered_html).toContain('FRIES');
    expect(fryer.rendered_html).not.toContain('BURGER');

    const barChits = [...onPrinter(kitchen, 'PRN-BAR'), ...onPrinter(kitchen, 'PRN-PASS')];
    expect(barChits).toHaveLength(2);
    expect(barChits.every((j) => j.rendered_html.includes('COLA') && !j.rendered_html.includes('FRIES'))).toBe(true);

    const [rest] = onPrinter(kitchen, 'PRN-KITCHEN');
    expect(rest.rendered_html).toContain('CAKE');
    expect(rest.rendered_html).not.toContain('BURGER');
  }, 60000);

  it('sends an edit only to the stations whose lines changed', async () => {
    const lines = await dataSource.getRepository(OrderItem).find({ where: { tenant_id: tenantId, order_id: orderId } });
    const fries = lines.find((l) => l.product_id === productIds.FRIES)!;
    const before = (await jobsFor(orderId)).length;

    await orders.editOrder(tenantId, orderId, {
      changes: { void: [{ orderItemId: fries.id, reasonCodeId, reason: 'Out of potatoes' }], add: [{ product_id: productIds.COLA, quantity: 1 }] },
      reason: 'Swap fries for a cola',
    } as any);

    const changes = (await jobsFor(orderId)).slice(before);
    expect(changes.map((j) => j.printer_id).sort()).toEqual(
      [printerIds['PRN-FRYER'], printerIds['PRN-BAR'], printerIds['PRN-PASS']].sort(),
    );
    expect(onPrinter(changes, 'PRN-FRYER')[0].rendered_html).toMatch(/حذف<\/span>.*FRIES/s);
    expect(onPrinter(changes, 'PRN-BAR')[0].rendered_html).toMatch(/اضافه<\/span>.*COLA/s);
    expect(changes.every((j) => j.rendered_html.includes('تغییر سفارش'))).toBe(true);
  }, 60000);

  it('reprints a single station chit without touching the others', async () => {
    const [grill] = onPrinter(await jobsFor(orderId), 'PRN-GRILL');
    const before = (await jobsFor(orderId)).length;

    const [reprint] = await printQueue.reprintJob(tenantId, grill.id, 'Paper jam');

    const after = await jobsFor(orderId);
    expect(after).toHaveLength(before + 1);
    expect(reprint.printer_id).toBe(printerIds['PRN-GRILL']);
    expect(reprint.is_reprint).toBe(true);
    expect(reprint.label).toBe('Grill (1/4)');
  }, 60000);

  // A courier needs the address and whether to collect; a Snappfood order the store delivers
  // itself is typed AGGREGATOR, so only its expedition says whose rider is coming.
  it.each([
    ['a delivery order', { order_type: 'DELIVERY' }],
    ['a Snappfood order the store delivers', { order_type: 'AGGREGATOR', channel: 'AGGREGATOR', aggregator_expedition: 'DELIVERY' }],
  ])('prints a courier slip and the paid receipt for %s', async (_name, overrides) => {
    const repo = dataSource.getRepository(OrderHeader);
    const order = (await repo.save(
      repo.create({
        tenant_id: tenantId,
        branch_id: branchId,
        order_number: `CS-${Date.now()}`,
        state: 'CONFIRMED',
        status: 'CONFIRMED',
        grand_total: '100000.0000',
        paid_total: '100000.0000',
        outstanding_total: '0.0000',
        terminal_id: tillId,
        ...overrides,
      } as any),
    )) as unknown as OrderHeader;

    await orders.afterPaymentSucceeded(tenantId, order.id);

    const printed = await jobsFor(order.id);
    expect(printed.map((j) => j.document_type).sort()).toEqual(['COURIER_SLIP', 'CUSTOMER_RECEIPT']);
    // Both at the till that took the order.
    expect(printed.every((j) => j.printer_id === printerIds['PRN-TILL'])).toBe(true);
  }, 60000);

  it('tells every station still holding food to stop on cancel', async () => {
    const before = (await jobsFor(orderId)).length;

    await orders.cancelOrder(tenantId, orderId, { reasonCodeId, reason: 'Guest left' } as any);

    const stops = (await jobsFor(orderId)).slice(before);
    // Burger (grill), colas (bar + pass) and cake (kitchen); the fries were already voided.
    expect(stops.map((j) => j.printer_id).sort()).toEqual(
      [printerIds['PRN-GRILL'], printerIds['PRN-BAR'], printerIds['PRN-PASS'], printerIds['PRN-KITCHEN']].sort(),
    );
    expect(stops.every((j) => j.rendered_html.includes('لغو سفارش — آماده نکنید'))).toBe(true);
    // The cook reads why, even when the till sent only a reason code.
    expect(stops.every((j) => j.reason === 'Order cancelled: Guest left')).toBe(true);
    expect(stops.some((j) => j.rendered_html.includes('FRIES'))).toBe(false);
  }, 60000);
});
