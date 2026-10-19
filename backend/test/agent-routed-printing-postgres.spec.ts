import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { Printer } from '../src/entities/Printer.entity';
import { PrintRoute } from '../src/entities/PrintRoute.entity';
import { PrintJob } from '../src/entities/PrintJob.entity';
import { Agent } from '../src/entities/Agent.entity';
import { AgentCommand } from '../src/entities/AgentCommand.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { PrintQueueService } from '../src/modules/printing/print-queue.service';
import { AgentConfigService } from '../src/modules/agent-gateway/agent-config.service';
import { AgentMessageHandlers } from '../src/modules/agent-gateway/agent-message-handlers.service';
import { envelope } from '../src/modules/agent-gateway/agent-protocol';
import { deleteTenantData } from './utils/tenant-teardown';

// Kitchen chits routed by the branch agent (protocol §21): the cloud sends the order once, the
// agent's answer becomes one job per chit, and a void later goes where its line first printed.
describe('Kitchen chits routed by the agent (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let queue: PrintQueueService;
  let tenantId: string;
  let branchId: string;
  let agentId: string;
  let grill: Printer;
  let bar: Printer;
  let order: OrderHeader;
  let burger: OrderItem;
  let cola: OrderItem;

  const save = <T>(entity: any, data: Partial<T>) =>
    dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;

  const lastCommand = async () =>
    (await dataSource.getRepository(AgentCommand).find({ where: { tenant_id: tenantId, type: 'order.print' }, order: { created_at: 'DESC' } }))[0];

  /** Answers a command as the branch's agent would, through the gateway's own handler. */
  const answer = async (command: AgentCommand, payload: Record<string, any>) => {
    await dataSource.getRepository(AgentCommand).update({ id: command.id }, { status: 'ACKED' });
    const handler = moduleRef.get(AgentMessageHandlers).get('order.print.result')!;
    const connection: any = { agentId, tenantId, branchId, capabilities: ['print.route'] };
    return handler(envelope('order.print.result', payload, command.id), connection);
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    queue = moduleRef.get(PrintQueueService);

    tenantId = (await save(Tenant, { code: `ROUTE-${Date.now()}`, name: 'Routing fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'RTE', name: 'Routing branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const food = await save(Category, { tenant_id: tenantId, code: 'RT-FOOD', name: 'غذا', is_active: true });
    const drinks = await save(Category, { tenant_id: tenantId, code: 'RT-DRINK', name: 'نوشیدنی', is_active: true });
    const burgerProduct = await save(Product, { tenant_id: tenantId, category_id: food.id, code: 'RT-B', name: 'همبرگر', base_price: '100000.0000' });
    const colaProduct = await save(Product, { tenant_id: tenantId, category_id: drinks.id, code: 'RT-C', name: 'نوشابه', base_price: '30000.0000' });
    grill = await save(Printer, {
      tenant_id: tenantId, branch_id: branchId, code: 'RT-1', name: 'Grill', printer_type: 'KITCHEN_IMPACT', is_active: true,
      agent_connection: { kind: 'tcp', host: '10.0.0.5', port: 9100 },
    });
    // No connection: the simulator's, as before.
    bar = await save(Printer, { tenant_id: tenantId, branch_id: branchId, code: 'RT-2', name: 'Bar', printer_type: 'KITCHEN_IMPACT', is_active: true });
    await save(PrintRoute, { tenant_id: tenantId, branch_id: branchId, category_id: food.id, printer_id: grill.id });
    await save(PrintRoute, { tenant_id: tenantId, branch_id: branchId, category_id: drinks.id, printer_id: bar.id });
    agentId = (
      await save(Agent, { tenant_id: tenantId, branch_id: branchId, status: 'ACTIVE', key_hash: randomUUID(), capabilities: ['print.html', 'print.route'], enrolled_at: new Date() })
    ).id;

    order = await save(OrderHeader, {
      tenant_id: tenantId, branch_id: branchId, order_number: 'RTE-0042', call_number: 42, channel: 'POS', order_type: 'TAKEAWAY',
      state: 'SUBMITTED', status: 'SUBMITTED', currency_code: 'IRR', placed_at: new Date(),
    });
    burger = await save(OrderItem, { tenant_id: tenantId, order_id: order.id, line_number: 1, product_id: burgerProduct.id, product_name: 'همبرگر', quantity: '1', unit_price: '100000', state: 'ACTIVE' });
    cola = await save(OrderItem, { tenant_id: tenantId, order_id: order.id, line_number: 2, product_id: colaProduct.id, product_name: 'نوشابه', quantity: '2', unit_price: '30000', state: 'ACTIVE' });
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it("puts the routes in the agent's config", async () => {
    const config = await moduleRef.get(AgentConfigService).forBranch(tenantId, branchId);
    expect(config.printers.map((p) => p.code)).toEqual(['RT-1', 'RT-2']);
    expect(config.routing!.routes).toHaveLength(2);
    expect(config.routing!.routes).toContainEqual(expect.objectContaining({ printer_id: grill.id }));
  });

  it('sends the order once, with one job waiting for the agent', async () => {
    const jobs = await queue.enqueueOrderPrintJobs(tenantId, order.id, 'KITCHEN_TICKET');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'PROCESSING', printer_id: null });

    const command = await lastCommand();
    expect(command.payload.job_id).toBe(jobs[0].id);
    expect(command.payload.heading).toMatchObject({ display_number: '42', order_number: 'RTE-0042' });
    expect(command.payload.lines.map((l: any) => [l.line_id, l.name, l.quantity, l.sent_to])).toEqual([
      [burger.id, 'همبرگر', '1.0000', null],
      [cola.id, 'نوشابه', '2.0000', null],
    ]);
    expect(command.payload.lines[0].category_id).toBeTruthy();
  });

  it("turns the agent's answer into one job per chit, and remembers where each line went", async () => {
    const command = await lastCommand();
    expect(
      await answer(command, {
        job_id: command.payload.job_id,
        order_id: order.id,
        chits: [
          { printer_id: grill.id, label: 'Grill (1/3)', whole_order: false, line_ids: [burger.id], html: '<p>grill</p>', status: 'SUCCESS', error: null },
          { printer_id: bar.id, label: 'Bar (2/3)', whole_order: false, line_ids: [cola.id], html: '<p>bar</p>', status: 'FAILED', error: { code: 'DEVICE_NOT_CONFIGURED', message: 'not connected' } },
          { printer_id: '', label: 'آشپزخانه (3/3)', whole_order: false, line_ids: [], html: '<p>-</p>', status: 'FAILED', error: { code: 'UNROUTED', message: 'nowhere' } },
        ],
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        error: null,
      }),
    ).toEqual({ ok: true });

    const jobs = await dataSource.getRepository(PrintJob).find({ where: { tenant_id: tenantId, entity_id: order.id }, order: { created_at: 'ASC' } });
    expect(jobs.map((j) => [j.label, j.printer_id ?? null, j.status])).toEqual([
      ['Grill (1/3)', grill.id, 'SUCCESS'],
      // A printer with no connection prints in the simulator, as it did when the cloud routed.
      ['Bar (2/3)', bar.id, 'SUCCESS'],
      ['آشپزخانه (3/3)', null, 'FAILED'],
    ]);
    expect(jobs[0].rendered_html).toBe('<p>grill</p>');
    const items = await dataSource.getRepository(OrderItem).find({ where: { order_id: order.id }, order: { line_number: 'ASC' } });
    expect(items.map((i) => i.kitchen_printer_ids)).toEqual([[grill.id], [bar.id]]);
  });

  it('sends a void with where its line first printed', async () => {
    await queue.enqueueKitchenChangeTicket(tenantId, order.id, { kind: 'AMENDED', voidedItemIds: [burger.id], addedItemIds: [], reason: 'مشتری' });
    const command = await lastCommand();
    expect(command.payload).toMatchObject({ kitchen_change: 'AMENDED', change_reason: 'مشتری' });
    expect(command.payload.lines).toEqual([expect.objectContaining({ line_id: burger.id, change: 'VOID', sent_to: [grill.id] })]);
  });

  it('drops the job when every line is on the "not printed" list', async () => {
    const command = await lastCommand();
    await answer(command, { job_id: command.payload.job_id, order_id: order.id, chits: [], error: null });
    expect(await dataSource.getRepository(PrintJob).findOne({ where: { id: command.payload.job_id } })).toBeNull();
  });
});
