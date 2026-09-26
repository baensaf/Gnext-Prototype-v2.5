import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AddressInfo, createServer, Server } from 'net';
import { ChildProcess, spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { Printer } from '../src/entities/Printer.entity';
import { KitchenStation } from '../src/entities/KitchenStation.entity';
import { KdsRoutingRule } from '../src/entities/KdsRoutingRule.entity';
import { PrintJob } from '../src/entities/PrintJob.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { PaymentDevice } from '../src/entities/PaymentDevice.entity';
import { Payment } from '../src/entities/Payment.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { AgentRegistryService } from '../src/modules/agent-gateway/agent-registry.service';
import { OrderService } from '../src/modules/order/order.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { deleteTenantData } from './utils/tenant-teardown';

const until = async (check: () => Promise<boolean> | boolean, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 100));
  }
};

// The same journey as agent-journey-postgres.spec.ts, driven by the real Go agent binary
// (agent/). It needs a built gnext-agent and a browser to render tickets, so it only runs when
// GNEXT_AGENT_BIN points at the binary:
//   cd agent && go build -o gnext-agent.exe ./cmd/gnext-agent
//   GNEXT_AGENT_BIN=../agent/gnext-agent.exe npx jest test/agent-go-binary-postgres.spec.ts
const bin = process.env.GNEXT_AGENT_BIN;
(bin ? describe : describe.skip)('Go branch agent binary (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let registry: AgentRegistryService;
  let orders: OrderService;
  let payments: PaymentService;
  let server: string;
  let tenantId: string;
  let branchId: string;
  let cashierId: string;
  let productId: string;
  let cardMethodId: string;
  let printer: Server;
  let printed = 0;
  let home: string;
  let agentProc: ChildProcess | null = null;
  let agentLog = '';
  let agentId: string;

  const env = () => ({ ...process.env, GNEXT_AGENT_HOME: home });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.listen(0, '127.0.0.1');
    server = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    dataSource = moduleRef.get(DataSource);
    registry = moduleRef.get(AgentRegistryService);
    orders = moduleRef.get(OrderService);
    payments = moduleRef.get(PaymentService);
    home = mkdtempSync(join(tmpdir(), 'gnext-agent-'));

    // A port-9100 printer on "the LAN": counts the connections that carried a ticket image
    // (GS v 0). Status checks (DLE EOT, GS r) arrive on connections of their own.
    printer = createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on('data', (d) => chunks.push(d));
      socket.on('end', () => Buffer.concat(chunks).includes(Buffer.from([0x1d, 0x76, 0x30])) && printed++);
    });
    await new Promise<void>((resolve) => printer.listen(0, '127.0.0.1', resolve));
    const printerPort = (printer.address() as AddressInfo).port;

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (
      await save(Tenant, { code: `GOAGENT-${Date.now()}`, name: 'Go agent fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'GOA', name: 'Go agent branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    cashierId = (
      await save(AdminUser, {
        tenant_id: tenantId,
        username: `goa-cashier-${Date.now()}@fixture`,
        display_name: 'Go Agent Cashier',
        role: 'CASHIER',
        password_hash: 'x',
        // A PIN, so the offline till's staff list has someone on it (§13.3).
        pin_hash: '$argon2id$v=19$m=65536,t=3,p=4$Z29hLWZpeHR1cmU$Z29hLWhhc2g',
        is_active: true,
        branch_id: branchId,
      })
    ).id;
    const category = await save(Category, { tenant_id: tenantId, code: 'GOA-CAT', name: 'غذا', is_active: true });
    productId = (
      await save(Product, { tenant_id: tenantId, category_id: category.id, code: 'GOA-BURGER', name: 'همبرگر', base_price: '250000.0000', tax_rate: '0.0900' })
    ).id;
    const printerId = (
      await save(Printer, {
        tenant_id: tenantId,
        branch_id: branchId,
        code: 'GOA-PRN',
        name: 'Counter printer',
        printer_type: 'THERMAL_RECEIPT',
        is_active: true,
        agent_connection: { kind: 'tcp', host: '127.0.0.1', port: printerPort },
      })
    ).id;
    // Receipts find it as the branch's receipt printer; the food's station prints its chits on it too.
    const station = await save(KitchenStation, { tenant_id: tenantId, branch_id: branchId, code: 'GOA-ST', name: 'Counter', printer_ids: [printerId] });
    await save(KdsRoutingRule, { tenant_id: tenantId, branch_id: branchId, category_id: category.id, station_id: station.id });
    cardMethodId = (await save(PaymentMethod, { tenant_id: tenantId, code: 'CARD_POS', name: 'Bank card', kind: 'CARD_POS', is_active: true })).id;
    const terminalId = (await save(PaymentDevice, { tenant_id: tenantId, branch_id: branchId, code: 'GOA-POS', name: 'Counter terminal', kind: 'POS' })).id;
    await payments.setDeviceAgent(tenantId, terminalId, { agentConnection: { kind: 'tcp', host: '127.0.0.1', port: 8888 }, agentDriver: 'fake' });
  }, 60000);

  afterAll(async () => {
    if (agentProc && agentProc.exitCode === null) {
      const exited = new Promise((resolve) => agentProc!.once('exit', resolve));
      agentProc.kill();
      await exited;
    }
    printer?.close();
    await deleteTenantData(dataSource, tenantId);
    await app.close();
    // The agent's headless browser can hold its profile for a moment after the agent exits.
    rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });

  it('enrols from the command line', async () => {
    const { code } = await registry.createEnrolmentCode(tenantId, branchId, {});
    const formatted = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase();
    // spawnSync would block the event loop the backend answers on; run it async.
    const result = await new Promise<{ status: number | null; out: string }>((resolve) => {
      const p = spawn(bin!, ['enrol', '--server', server, '--code', formatted], { env: env() });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('close', (status) => resolve({ status, out }));
    });
    expect(result.out).toContain('Enrolled as agent');
    expect(result.status).toBe(0);
    const agents = await registry.listAgents(tenantId, { branchId });
    expect(agents).toHaveLength(1);
    agentId = agents[0].id;
  }, 60000);

  it('connects', async () => {
    agentProc = spawn(bin!, ['run'], { env: env() });
    agentProc.stderr!.on('data', (d) => (agentLog += d));
    await until(async () => (await registry.listAgents(tenantId, { branchId }))[0]?.connected === true);
  }, 60000);

  it('keeps the branch snapshot, and fetches it again when head office changes the menu', async () => {
    const file = join(home, 'branch-data', 'snapshot.json');
    const held = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
    await until(() => !!held()?.data_version).catch((e) => {
      throw new Error(`${e.message}
--- agent log ---
${agentLog}`);
    });
    const first = held();
    expect(first.products.map((p: any) => p.id)).toContain(productId);

    await dataSource.getRepository(Product).update({ id: productId }, { name: 'Renamed for the snapshot test' });
    await until(() => held()?.products?.some((p: any) => p.name === 'Renamed for the snapshot test'), 40000).catch((e) => {
      throw new Error(`${e.message}
--- agent log ---
${agentLog}`);
    });
    expect(held().data_version).not.toBe(first.data_version);
  }, 60000);

  it('keeps what the offline till needs: the staff list sealed, the devices and the call count (§13)', async () => {
    const staff = join(home, 'branch-data', 'staff.dat');
    const devices = join(home, 'devices.json');
    const calls = join(home, 'call-numbers.json');
    await until(() => existsSync(staff) && existsSync(devices) && existsSync(calls), 40000).catch((e) => {
      throw new Error(`${e.message}
--- agent log ---
${agentLog}`);
    });
    // Sealed with DPAPI: neither the hash nor the cashier's id is readable in the file.
    const sealed = readFileSync(staff);
    expect(sealed.includes('argon2id')).toBe(false);
    expect(sealed.includes(cashierId)).toBe(false);
    expect(JSON.parse(readFileSync(devices, 'utf8')).printers.map((p: any) => p.code)).toEqual(['GOA-PRN']);
    expect(JSON.parse(readFileSync(calls, 'utf8'))).toEqual({ business_date: expect.any(String), POS: 0 });
  }, 60000);

  let orderId: string;

  const printJobs = () => dataSource.getRepository(PrintJob).find({ where: { tenant_id: tenantId, entity_id: orderId } });

  // The receipt waits for payment (since #84); the kitchen ticket goes when the order is placed.
  it("prints a new order's kitchen ticket as ESC/POS on the network printer", async () => {
    const draft = await orders.createDraft(
      tenantId,
      { branch_id: branchId, order_type: 'PICKUP', items: [{ product_id: productId, quantity: 1 }] } as any,
      cashierId,
    );
    orderId = (await orders.submitOrder(tenantId, draft.id, {} as any, cashierId)).id;
    await until(async () => {
      const jobs = await printJobs();
      return jobs.length === 1 && jobs[0].status === 'SUCCESS';
    }, 60000).catch(async (e) => {
      throw new Error(`${e.message}\njobs: ${JSON.stringify((await printJobs()).map((j) => [j.document_type, j.status]))}\n--- agent log ---\n${agentLog}`);
    });
    expect(printed).toBe(1);
  }, 90000);

  it('takes the card payment on the fake terminal, and then prints the receipt', async () => {
    const order = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: orderId });
    const intent = await payments.createPaymentIntent(tenantId, { orderId, methodId: cardMethodId, amount: order.outstanding_total } as any);
    await payments.processPayment(tenantId, intent.id, {}, cashierId);
    await until(async () => (await dataSource.getRepository(Payment).findOneByOrFail({ id: intent.id })).status === 'SUCCEEDED').catch((e) => {
      throw new Error(`${e.message}\n--- agent log ---\n${agentLog}`);
    });
    await until(async () => {
      const jobs = await printJobs();
      return jobs.length === 2 && jobs.every((j) => j.status === 'SUCCESS');
    }, 60000).catch(async (e) => {
      throw new Error(`${e.message}\njobs: ${JSON.stringify((await printJobs()).map((j) => [j.document_type, j.status]))}\n--- agent log ---\n${agentLog}`);
    });
    expect(printed).toBe(2);
  }, 120000);

  it('stops for good when head office revokes it', async () => {
    await registry.revokeAgent(tenantId, agentId, 'test over', {});
    await until(() => /refused this agent's key/.test(agentLog));
  }, 60000);
});
