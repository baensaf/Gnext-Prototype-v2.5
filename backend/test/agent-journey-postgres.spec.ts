import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { Printer } from '../src/entities/Printer.entity';
import { PrinterGroup } from '../src/entities/PrinterGroup.entity';
import { PrinterGroupMember } from '../src/entities/PrinterGroupMember.entity';
import { PrintRoute } from '../src/entities/PrintRoute.entity';
import { PrintJob } from '../src/entities/PrintJob.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { PaymentDevice } from '../src/entities/PaymentDevice.entity';
import { Payment } from '../src/entities/Payment.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OperationalAlert } from '../src/entities/OperationalAlert.entity';
import { AgentRegistryService } from '../src/modules/agent-gateway/agent-registry.service';
import { AgentHealthService, OFFLINE_ALERT_AFTER_MS } from '../src/modules/agent-gateway/agent-health.service';
import { AgentSessionsService } from '../src/modules/agent-gateway/agent-sessions.service';
import { OrderService } from '../src/modules/order/order.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { deleteTenantData } from './utils/tenant-teardown';
import { FakeAgent } from './utils/fake-agent';

const until = async (check: () => Promise<boolean> | boolean, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 50));
  }
};

// Task 9's harness: a fake branch agent walks the whole v1 journey against the real backend -
// enrol, connect, print an order's tickets, take its card payment, go away, come back, and be
// revoked. The Go agent has to behave the way FakeAgent does.
describe('branch agent journey (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let registry: AgentRegistryService;
  let orders: OrderService;
  let payments: PaymentService;
  let baseWs: string;
  let tenantId: string;
  let branchId: string;
  let cashierId: string;
  let productId: string;
  let cardMethodId: string;
  let printerId: string;
  let terminalId: string;
  let agent: FakeAgent;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.listen(0, '127.0.0.1');
    baseWs = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    dataSource = moduleRef.get(DataSource);
    registry = moduleRef.get(AgentRegistryService);
    orders = moduleRef.get(OrderService);
    payments = moduleRef.get(PaymentService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (
      await save(Tenant, { code: `JOURNEY-${Date.now()}`, name: 'Agent journey fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'JRN', name: 'Journey branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    cashierId = (
      await save(AdminUser, {
        tenant_id: tenantId,
        username: `jrn-cashier-${Date.now()}@fixture`,
        display_name: 'Journey Cashier',
        role: 'CASHIER',
        password_hash: 'x',
        is_active: true,
        branch_id: branchId,
      })
    ).id;
    const category = await save(Category, { tenant_id: tenantId, code: 'JRN-CAT', name: 'Food', is_active: true });
    productId = (
      await save(Product, { tenant_id: tenantId, category_id: category.id, code: 'JRN-BURGER', name: 'Burger', base_price: '250000.0000', tax_rate: '0.0900' })
    ).id;

    // One network printer, routed for receipts and kitchen tickets, driven by the agent.
    printerId = (
      await save(Printer, {
        tenant_id: tenantId,
        branch_id: branchId,
        code: 'JRN-PRN',
        name: 'Counter printer',
        printer_type: 'THERMAL_RECEIPT',
        is_active: true,
        agent_connection: { kind: 'tcp', host: '192.168.1.50', port: 9100 },
      })
    ).id;
    const group = await save(PrinterGroup, { tenant_id: tenantId, branch_id: branchId, code: 'JRN-GRP', name: 'Counter' });
    await save(PrinterGroupMember, { group_id: group.id, printer_id: printerId, priority: 1, copies: 1 });
    for (const document_type of ['CUSTOMER_RECEIPT', 'KITCHEN_TICKET']) {
      await save(PrintRoute, { tenant_id: tenantId, branch_id: branchId, document_type, printer_group_id: group.id, priority: 0, copies: 1 });
    }

    // One Saman terminal, driven by the agent.
    cardMethodId = (await save(PaymentMethod, { tenant_id: tenantId, code: 'CARD_POS', name: 'Bank card', kind: 'CARD_POS', is_active: true })).id;
    terminalId = (await save(PaymentDevice, { tenant_id: tenantId, branch_id: branchId, code: 'JRN-POS', name: 'Counter terminal', kind: 'POS' })).id;
    await payments.setDeviceAgent(tenantId, terminalId, { agentConnection: { kind: 'tcp', host: '192.168.1.60', port: 8888 }, agentDriver: 'sep' });

    agent = new FakeAgent(app.getHttpServer(), baseWs);
  }, 60000);

  afterAll(async () => {
    await agent?.disconnect();
    await dataSource.query(
      `DELETE FROM printer_group_member WHERE group_id IN (SELECT id FROM printer_group WHERE tenant_id = $1)`,
      [tenantId],
    );
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('1. enrols with the code head office handed out', async () => {
    const { code } = await registry.createEnrolmentCode(tenantId, branchId, {});
    const identity = await agent.enrol(code);
    expect(identity).toMatchObject({ tenant_id: tenantId, branch_id: branchId, branch_name: 'Journey branch' });
    expect(identity.ws_url).toMatch(/\/api\/v1\/agent\/ws$/);
  });

  it('2. connects and learns its printer and terminal', async () => {
    const welcome = await agent.connect();
    expect(welcome.payload.config.printers).toEqual([expect.objectContaining({ id: printerId, connection: expect.objectContaining({ kind: 'tcp' }) })]);
    expect(welcome.payload.config.terminals).toEqual([expect.objectContaining({ id: terminalId, driver: 'sep' })]);
    expect((await registry.listAgents(tenantId, { branchId }))[0]).toMatchObject({ connected: true, hostname: 'FAKE-BRANCH-PC' });
  });

  let orderId: string;

  it("3. prints a new order's receipt and kitchen ticket on the real printer", async () => {
    const draft = await orders.createDraft(
      tenantId,
      { branch_id: branchId, order_type: 'PICKUP', items: [{ product_id: productId, quantity: 1 }] } as any,
      cashierId,
    );
    const order = await orders.submitOrder(tenantId, draft.id, {} as any, cashierId);
    orderId = order.id;

    const jobs = () => dataSource.getRepository(PrintJob).find({ where: { tenant_id: tenantId, entity_id: orderId } });
    await until(async () => {
      const all = await jobs();
      return all.length === 2 && all.every((j) => j.status === 'SUCCESS');
    });
    const printed = [...agent.journal.values()].filter((e) => e.command.type === 'print.job').map((e) => e.command.payload.document_type);
    expect(printed.sort()).toEqual(['CUSTOMER_RECEIPT', 'KITCHEN_TICKET']);
  });

  it('4. takes the card payment on the real terminal', async () => {
    const order = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: orderId });
    const intent = await payments.createPaymentIntent(tenantId, { orderId, methodId: cardMethodId, amount: order.outstanding_total } as any);
    const sent = await payments.processPayment(tenantId, intent.id, {}, cashierId);
    expect(sent.status).toBe('PROCESSING');

    await until(async () => (await dataSource.getRepository(Payment).findOneByOrFail({ id: intent.id })).status === 'SUCCEEDED');
    const charge = [...agent.journal.values()].find((e) => e.command.type === 'payment.charge')!.command;
    expect(charge.payload).toMatchObject({ amount: '272500', terminal_id: terminalId, currency: 'IRR' });
    expect((await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: orderId })).outstanding_total).toBe('0.0000');
  });

  it('5. can ask for the latest build', async () => {
    const latest = await agent.checkForUpdate();
    expect(latest === null || typeof latest.version === 'string').toBe(true);
  });

  it('6. is reported missing when it goes away, and cleared when it is back', async () => {
    const health = moduleRef.get(AgentHealthService);
    const alerts = () =>
      dataSource.getRepository(OperationalAlert).find({ where: { tenant_id: tenantId, type: 'AGENT_OFFLINE', acknowledged: false } });

    // The client sees its socket close before the server's close handler drops the session;
    // sweeping in between would still find the agent connected.
    const sessions = moduleRef.get(AgentSessionsService);
    await agent.disconnect();
    await until(() => !sessions.isConnected(agent.agentId));
    await health.sweep(new Date(Date.now() + OFFLINE_ALERT_AFTER_MS + 1000), tenantId);
    expect(await alerts()).toHaveLength(1);

    await agent.connect();
    await health.sweep(new Date(), tenantId);
    expect(await alerts()).toHaveLength(0);
  });

  it('7. is cut off the moment head office revokes it', async () => {
    if (!agent.connection) await agent.connect();
    const socket = agent.connection!;
    await registry.revokeAgent(tenantId, agent.agentId, 'PC replaced', {});
    await expect(socket.closed).resolves.toMatchObject({ code: 4003 });
    await expect(agent.connect()).rejects.toThrow(/403/);
  });
});
