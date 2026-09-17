import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, INestApplication } from '@nestjs/common';
import { AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { PaymentDevice } from '../src/entities/PaymentDevice.entity';
import { Payment } from '../src/entities/Payment.entity';
import { PaymentAttempt } from '../src/entities/PaymentAttempt.entity';
import { PaymentAllocation } from '../src/entities/PaymentAllocation.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { AgentCommand } from '../src/entities/AgentCommand.entity';
import { OperationalAlert } from '../src/entities/OperationalAlert.entity';
import { AgentEnrolmentService } from '../src/modules/agent-gateway/agent-enrolment.service';
import { AgentRegistryService } from '../src/modules/agent-gateway/agent-registry.service';
import { AgentCommandsService } from '../src/modules/agent-gateway/agent-commands.service';
import { OrderService } from '../src/modules/order/order.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { sanitiseResult, wholeRials } from '../src/modules/payment/agent-payments.service';
import { deleteTenantData } from './utils/tenant-teardown';
import { TestAgent } from './utils/agent-client';

const until = async (check: () => Promise<boolean> | boolean, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
};

const AMOUNT = '272500'; // one burger at 250 000 rials plus 9% tax

// Card payments through a (test) branch agent: the till asks, the terminal answers, and a
// charge nobody can vouch for is never booked as failed.
describe('card payments via the branch agent (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let payments: PaymentService;
  let orders: OrderService;
  let commands: AgentCommandsService;
  let wsUrl: string;
  let tenantId: string;
  let branchId: string;
  let productId: string;
  let cashierId: string;
  let cardMethodId: string;
  let terminalId: string;
  let deviceKey: string;
  const open: TestAgent[] = [];

  const paymentRow = (id: string) => dataSource.getRepository(Payment).findOneByOrFail({ id });
  const attemptsOf = (paymentId: string) =>
    dataSource.getRepository(PaymentAttempt).find({ where: { payment_id: paymentId }, order: { attempt_no: 'ASC' } });
  const alertsFor = (paymentNumber: string) =>
    dataSource.getRepository(OperationalAlert).find({ where: { tenant_id: tenantId, title: `Check card terminal: ${paymentNumber}` } });

  const connect = async (capabilities = ['print.html', 'payment.charge', 'payment.query']) => {
    const agent = new TestAgent(wsUrl, deviceKey);
    open.push(agent);
    await agent.opened;
    const id = agent.send('hello', { agent_version: '1.0.0', protocol_versions: [1], capabilities, devices: [] });
    const welcome = await agent.next((m) => m.type === 'welcome' && m.ref === id);
    return { agent, welcome };
  };

  /** A submitted order and a card intent for all of it. */
  const cardIntent = async () => {
    const draft = await orders.createDraft(
      tenantId,
      { branch_id: branchId, order_type: 'PICKUP', items: [{ product_id: productId, quantity: 1 }] } as any,
      cashierId,
    );
    const order = await orders.submitOrder(tenantId, draft.id, {} as any, cashierId);
    const intent = await payments.createPaymentIntent(tenantId, {
      orderId: order.id,
      methodId: cardMethodId,
      amount: order.outstanding_total,
    } as any);
    return { order, intent };
  };

  const charge = async (agent: TestAgent) => {
    const { order, intent } = await cardIntent();
    const processing = await payments.processPayment(tenantId, intent.id, {}, cashierId);
    const command = await agent.next((m) => m.type === 'payment.charge' && m.payload.payment_id === intent.id);
    return { order, intent, processing, command };
  };

  const answer = (agent: TestAgent, command: any, payload: Record<string, any>, ack = true) => {
    if (ack) agent.send('ack', { ok: true }, undefined, command.id);
    const id = agent.send(
      'payment.result',
      {
        payment_id: command.payload.payment_id,
        attempt_id: command.payload.attempt_id,
        terminal_id: command.payload.terminal_id,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        error: null,
        ...payload,
      },
      undefined,
      command.id,
    );
    return agent.next((m) => m.type === 'ack' && m.ref === id);
  };
  const approve = (agent: TestAgent, command: any, extra: Record<string, any> = {}) =>
    answer(agent, command, {
      status: 'APPROVED',
      amount: command.payload.amount,
      rrn: '123456789012',
      stan: '004512',
      auth_code: 'A1B2C3',
      card_pan_masked: '603799******1234',
      bank_response_code: '00',
      ...extra,
    });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    wsUrl = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/agent/ws`;
    dataSource = moduleRef.get(DataSource);
    payments = moduleRef.get(PaymentService);
    orders = moduleRef.get(OrderService);
    commands = moduleRef.get(AgentCommandsService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (
      await save(Tenant, { code: `AGENTPAY-${Date.now()}`, name: 'Agent payment fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'APY', name: 'Card branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    cashierId = (
      await save(AdminUser, {
        tenant_id: tenantId,
        username: `apy-cashier-${Date.now()}@fixture`,
        display_name: 'Card Cashier',
        role: 'CASHIER',
        password_hash: 'x',
        is_active: true,
        branch_id: branchId,
      })
    ).id;
    const category = await save(Category, { tenant_id: tenantId, code: 'APY-CAT', name: 'Food', is_active: true });
    productId = (
      await save(Product, { tenant_id: tenantId, category_id: category.id, code: 'APY-BURGER', name: 'Burger', base_price: '250000.0000', tax_rate: '0.0900' })
    ).id;
    cardMethodId = (await save(PaymentMethod, { tenant_id: tenantId, code: 'CARD_POS', name: 'Bank card', kind: 'CARD_POS', is_active: true })).id;
    const terminal = await save(PaymentDevice, { tenant_id: tenantId, branch_id: branchId, code: 'POS1', name: 'Till 1 terminal', kind: 'POS' });
    terminalId = terminal.id;
    await payments.setDeviceAgent(tenantId, terminalId, {
      agentConnection: { kind: 'tcp', host: '192.168.1.60', port: 8888 },
      agentDriver: 'SEP',
    });

    const { code } = await moduleRef.get(AgentRegistryService).createEnrolmentCode(tenantId, branchId, {});
    deviceKey = (await moduleRef.get(AgentEnrolmentService).enrol({ code }, { clientKey: 'test', wsUrl: '' })).device_key;
  }, 60000);

  afterEach(async () => {
    for (const a of open.splice(0)) {
      a.ws.terminate();
      await a.closed;
    }
    await dataSource.getRepository(AgentCommand).update({ tenant_id: tenantId, status: 'QUEUED' }, { status: 'DONE' });
    await dataSource.getRepository(AgentCommand).update({ tenant_id: tenantId, status: 'SENT' }, { status: 'DONE' });
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('tells the agent about its terminal and driver', async () => {
    const { welcome } = await connect();
    expect(welcome.payload.config.terminals).toEqual([
      expect.objectContaining({
        id: terminalId,
        code: 'POS1',
        driver: 'sep',
        connection: { kind: 'tcp', host: '192.168.1.60', port: 8888 },
        charge_timeout_s: 90,
      }),
    ]);
  });

  it('charges the real terminal and books the payment on approval, once', async () => {
    const { agent } = await connect();
    const { order, intent, processing, command } = await charge(agent);

    expect(processing.status).toBe('PROCESSING');
    expect(command.payload).toMatchObject({
      amount: AMOUNT,
      currency: 'IRR',
      terminal_id: terminalId,
      order_number: order.order_number,
      payment_number: intent.payment_number,
      attempt_no: 1,
      timeout_s: 90,
    });
    expect(Date.parse(command.payload.expires_at) - Date.now()).toBeLessThanOrEqual(60_000);

    // A second press while the terminal is busy starts nothing.
    await expect(payments.processPayment(tenantId, intent.id, {}, cashierId)).rejects.toBeInstanceOf(ConflictException);

    await approve(agent, command);
    const paid = await paymentRow(intent.id);
    expect(paid).toMatchObject({ status: 'SUCCEEDED', reference: '123456789012', receipt_number: '004512', needs_terminal_check: false });
    const [attempt] = await attemptsOf(intent.id);
    expect(attempt).toMatchObject({ adapter: 'AGENT', status: 'SUCCEEDED', external_reference: '123456789012' });
    expect(attempt.response_snapshot).toMatchObject({ card_pan_masked: '603799******1234', bank_response_code: '00' });
    const booked = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: order.id });
    expect(booked.outstanding_total).toBe('0.0000');

    // The agent resends the result: acked, never booked twice.
    await approve(agent, command);
    expect(await dataSource.getRepository(PaymentAllocation).count({ where: { payment_id: intent.id } })).toBe(1);
    expect((await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: order.id })).paid_total).toBe(`${AMOUNT}.0000`);
  });

  it('fails a declined card, and lets the cashier try again', async () => {
    const { agent } = await connect();
    const { intent, command } = await charge(agent);

    await answer(agent, command, { status: 'DECLINED', bank_response_code: '51', error: { code: 'DECLINED', message: 'Insufficient funds' } });
    expect(await paymentRow(intent.id)).toMatchObject({
      status: 'FAILED',
      failure_code: 'DECLINED',
      failure_message: 'Insufficient funds',
      needs_terminal_check: false,
    });

    await payments.processPayment(tenantId, intent.id, {}, cashierId);
    const second = await agent.next((m) => m.type === 'payment.charge' && m.payload.payment_id === intent.id && m.payload.attempt_no === 2);
    await approve(agent, second, { rrn: '999999999999' });
    expect(await paymentRow(intent.id)).toMatchObject({ status: 'SUCCEEDED', reference: '999999999999', failure_code: null });
  });

  it('never fails a charge the terminal could not confirm, and settles it by asking the terminal', async () => {
    const { agent } = await connect();
    const { order, intent, command } = await charge(agent);

    await answer(agent, command, { status: 'UNKNOWN', error: { code: 'TIMEOUT', message: 'No answer from terminal' } });

    const unknown = await paymentRow(intent.id);
    expect(unknown).toMatchObject({ status: 'PROCESSING', needs_terminal_check: true });
    expect((await attemptsOf(intent.id))[0]).toMatchObject({ status: 'UNKNOWN', error_code: 'TIMEOUT' });
    const [alert] = await alertsFor(intent.payment_number);
    expect(alert).toMatchObject({ type: 'PAYMENT_TERMINAL', severity: 'CRITICAL', acknowledged: false, branch_id: branchId });

    // Nothing may charge again or wipe it away until someone checks.
    await expect(payments.processPayment(tenantId, intent.id, {}, cashierId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TERMINAL_CHARGE_IN_PROGRESS' }),
    });
    await expect(payments.voidPayment(tenantId, intent.id)).rejects.toBeInstanceOf(BadRequestException);

    const asked = await payments.checkTerminal(tenantId, intent.id, cashierId);
    expect(asked.queued).toBe(true);
    const query = await agent.next((m) => m.type === 'payment.query' && m.payload.payment_id === intent.id);
    expect(query.payload).toMatchObject({ attempt_id: command.payload.attempt_id, terminal_id: terminalId, amount: AMOUNT });
    // Asking twice while the first question is open sends nothing new.
    expect((await payments.checkTerminal(tenantId, intent.id, cashierId)).queued).toBe(false);

    await approve(agent, query);
    expect(await paymentRow(intent.id)).toMatchObject({ status: 'SUCCEEDED', needs_terminal_check: false });
    expect((await alertsFor(intent.payment_number))[0].acknowledged).toBe(true);
    expect((await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: order.id })).outstanding_total).toBe('0.0000');
  });

  it('fails an unconfirmed charge only when the terminal says it did not happen', async () => {
    const { agent } = await connect();
    const { intent, command } = await charge(agent);
    await answer(agent, command, { status: 'UNKNOWN', error: { code: 'CONNECTION_LOST' } });

    await payments.checkTerminal(tenantId, intent.id, cashierId);
    const query = await agent.next((m) => m.type === 'payment.query' && m.payload.payment_id === intent.id);
    // A query that still cannot tell changes nothing; FAILED is not a query answer.
    await answer(agent, query, { status: 'FAILED', error: { code: 'TERMINAL_UNREACHABLE' } });
    expect(await paymentRow(intent.id)).toMatchObject({ status: 'PROCESSING', needs_terminal_check: true });

    await payments.checkTerminal(tenantId, intent.id, cashierId);
    const again = await agent.next((m) => m.type === 'payment.query' && m.payload.payment_id === intent.id && m.id !== query.id);
    await answer(agent, again, { status: 'DECLINED' });
    expect(await paymentRow(intent.id)).toMatchObject({ status: 'FAILED', failure_code: 'DECLINED', needs_terminal_check: false });
  });

  it('leaves a terminal that cannot be queried to a manager', async () => {
    const { agent } = await connect(['payment.charge']);
    const { intent, command } = await charge(agent);
    await answer(agent, command, { status: 'UNKNOWN', error: { code: 'AGENT_RESTARTED' } });

    await expect(payments.checkTerminal(tenantId, intent.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'QUERY_UNSUPPORTED' }),
    });
    await expect(
      payments.resolveTerminal(tenantId, intent.id, { outcome: 'APPROVED', reason: 'terminal report' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const resolved = await payments.resolveTerminal(tenantId, intent.id, {
      outcome: 'NOT_CHARGED',
      reason: 'Not on the terminal end-of-day report',
    });
    expect(resolved).toMatchObject({ status: 'FAILED', failure_code: 'NOT_CHARGED', needs_terminal_check: false });
    expect((await attemptsOf(intent.id))[0]).toMatchObject({ status: 'FAILED', error_code: 'NOT_CHARGED' });
    // Settled: nothing left to resolve.
    await expect(payments.resolveTerminal(tenantId, intent.id, { outcome: 'NOT_CHARGED', reason: 'again' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('books a charge a manager confirms from the terminal receipt', async () => {
    const { agent } = await connect(['payment.charge']);
    const { intent, command } = await charge(agent);
    await answer(agent, command, { status: 'UNKNOWN', error: { code: 'TIMEOUT' } });

    const resolved = await payments.resolveTerminal(tenantId, intent.id, {
      outcome: 'APPROVED',
      rrn: '555555555555',
      reason: 'Receipt printed by the terminal',
    });
    expect(resolved).toMatchObject({ status: 'SUCCEEDED', reference: '555555555555' });
  });

  it('holds a charge whose amount or reference is not right', async () => {
    const { agent } = await connect();
    const { intent, command } = await charge(agent);
    await approve(agent, command, { amount: '2725000' });
    expect(await paymentRow(intent.id)).toMatchObject({ status: 'PROCESSING', needs_terminal_check: true });
    expect((await attemptsOf(intent.id))[0]).toMatchObject({ status: 'UNKNOWN', error_code: 'AMOUNT_MISMATCH' });

    const second = await charge(agent);
    await approve(agent, second.command, { rrn: '' });
    expect(await paymentRow(second.intent.id)).toMatchObject({ status: 'PROCESSING', needs_terminal_check: true });
  });

  it('fails a charge the agent never received, without asking anyone', async () => {
    const { order, intent } = await cardIntent();
    const processing = await payments.processPayment(tenantId, intent.id, {}, cashierId);
    expect(processing.status).toBe('PROCESSING');

    await commands.tick(new Date(Date.now() + 61_000), tenantId);
    await until(async () => (await paymentRow(intent.id)).status === 'FAILED');
    expect(await paymentRow(intent.id)).toMatchObject({ failure_code: 'AGENT_OFFLINE', needs_terminal_check: false });
    expect(order.id).toBeTruthy();
  });

  it('treats a charge that went out but was never acknowledged as unknown', async () => {
    const { agent } = await connect();
    const { intent } = await charge(agent);
    await until(async () => (await commands.get((await attemptsOf(intent.id))[0].agent_command_id!))!.status === 'SENT');

    agent.ws.terminate();
    await agent.closed;
    await commands.tick(new Date(Date.now() + 61_000), tenantId);

    await until(async () => (await paymentRow(intent.id)).needs_terminal_check);
    expect(await paymentRow(intent.id)).toMatchObject({ status: 'PROCESSING' });
    expect((await attemptsOf(intent.id))[0]).toMatchObject({ status: 'UNKNOWN', error_code: 'NO_ANSWER' });
  });

  it('refuses a charge the agent does not take, as not charged', async () => {
    const { agent } = await connect();
    const { intent, command } = await charge(agent);
    agent.send('ack', { ok: false, error: { code: 'DEVICE_NOT_CONFIGURED', message: 'no driver' } }, undefined, command.id);
    await until(async () => (await paymentRow(intent.id)).status === 'FAILED');
    expect(await paymentRow(intent.id)).toMatchObject({ failure_code: 'DEVICE_NOT_CONFIGURED', needs_terminal_check: false });
  });

  it('keeps a terminal the agent does not drive on the simulator', async () => {
    await payments.setDeviceAgent(tenantId, terminalId, { agentConnection: null });
    try {
      const { agent } = await connect();
      const { intent } = await cardIntent();
      const paid = await payments.processPayment(tenantId, intent.id, {}, cashierId);
      expect(paid.status).toBe('SUCCEEDED');
      await new Promise((r) => setTimeout(r, 150));
      expect(agent.frames.some((m) => m.type === 'payment.charge')).toBe(false);
    } finally {
      await payments.setDeviceAgent(tenantId, terminalId, {
        agentConnection: { kind: 'tcp', host: '192.168.1.60', port: 8888 },
        agentDriver: 'sep',
      });
    }
  });

  it('checks terminal settings and money before anything reaches the agent', async () => {
    await expect(
      payments.setDeviceAgent(tenantId, terminalId, { agentConnection: { kind: 'tcp', host: '192.168.1.60', port: 8888 }, agentDriver: 'pec' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      payments.setDeviceAgent(tenantId, terminalId, { agentConnection: { kind: 'windows', printer_name: 'x' }, agentDriver: 'sep' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(wholeRials('272500.0000')).toBe('272500');
    expect(wholeRials('0012')).toBe('12');
    expect(() => wholeRials('10.5000')).toThrow(BadRequestException);
    expect(() => wholeRials('-5')).toThrow(BadRequestException);

    const clean = sanitiseResult({ status: 'APPROVED', card_pan_masked: '6037991234561234', track2: 'secret', pin_block: 'x' });
    expect(clean.card_pan_masked).toBeUndefined();
    expect(JSON.stringify(clean)).not.toContain('secret');
    expect(sanitiseResult({ card_pan_masked: '603799******1234' }).card_pan_masked).toBe('603799******1234');
  });
});
