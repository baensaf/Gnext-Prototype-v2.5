import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import { Payment } from '../../entities/Payment.entity';
import { PaymentAttempt } from '../../entities/PaymentAttempt.entity';
import { PaymentDevice } from '../../entities/PaymentDevice.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OperationalAlert } from '../../entities/OperationalAlert.entity';
import { AgentCommand } from '../../entities/AgentCommand.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { AgentCommandsService, ResultOutcome } from '../agent-gateway/agent-commands.service';
import { AgentSessionsService } from '../agent-gateway/agent-sessions.service';
import { Envelope } from '../agent-gateway/agent-protocol';
import { AuditWriter } from '../audit/audit-writer.service';
import { OrderService } from '../order/order.service';
import { bookSucceededPayment, PaymentActor } from './payment-settlement';

/** Tender kinds a card terminal takes. Cash, credit and online tenders never reach the agent. */
export const AGENT_CARD_METHOD_KINDS = new Set(['CARD', 'POS', 'CARD_POS', 'NETWORK_POS']);
/** Terminal protocol drivers the agent ships (protocol §7.6). */
export const AGENT_TERMINAL_DRIVERS = ['sep', 'fake'];

const TERMINAL_KINDS = ['POS', 'NETWORK'];
const CHARGE_TIMEOUT_S = 90;
/** The first automatic look at the terminal after it could not say how a charge ended (§7.5). */
export const AUTO_QUERY_DELAY_MS = 30_000;

const IN_FLIGHT = ['PENDING', 'UNKNOWN'];
const CHARGE_STATUSES = new Set(['APPROVED', 'DECLINED', 'CANCELLED', 'FAILED', 'UNKNOWN']);
const PAN_MASK = /^\d{0,6}[*Xx]+\d{0,4}$/;

export type ManualResolution = 'APPROVED' | 'NOT_CHARGED';

/**
 * Card payments through the branch agent (protocol §7.3–7.6).
 *
 * The rule everything here serves: once an amount may have reached the terminal, a payment is
 * never marked failed without a definite answer. It stays PROCESSING with
 * `needs_terminal_check` until the terminal is queried or a manager resolves it.
 */
@Injectable()
export class AgentPaymentsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AgentPayments');
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly commands: AgentCommandsService,
    private readonly sessions: AgentSessionsService,
    private readonly auditWriter: AuditWriter,
    private readonly orderService: OrderService,
  ) {}

  onApplicationBootstrap() {
    this.commands.registerResult('payment.result', ['payment.charge', 'payment.query'], (ctx) =>
      this.applyResult(ctx.command, ctx.message, ctx.em),
    );
    this.commands.onSettled((command) => this.onCommandSettled(command));
  }

  onApplicationShutdown() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /**
   * The terminal the agent should charge, or null when this payment stays on the simulator:
   * not a card tender, or no terminal at the branch the agent drives.
   */
  async terminalFor(em: EntityManager, payment: Payment, order: OrderHeader): Promise<PaymentDevice | null> {
    if (!AGENT_CARD_METHOD_KINDS.has(String(payment.method_kind || '').toUpperCase())) return null;
    if (payment.device_id) {
      const device = await em.findOne(PaymentDevice, { where: { id: payment.device_id, tenant_id: payment.tenant_id } });
      return device && isAgentTerminal(device) ? device : null;
    }
    // One terminal per branch in v1: the first the agent drives, by code.
    const devices = await em.find(PaymentDevice, {
      where: {
        tenant_id: payment.tenant_id,
        branch_id: order.branch_id,
        is_active: true,
        kind: In(TERMINAL_KINDS),
        agent_connection: Not(IsNull()),
      },
      order: { code: 'ASC' },
    });
    return devices.find(isAgentTerminal) ?? null;
  }

  /** A charge may be on the terminal right now; starting another could take the money twice. */
  async assertNoChargeInFlight(em: EntityManager, payment: Payment): Promise<void> {
    const latest = await em.findOne(PaymentAttempt, { where: { payment_id: payment.id }, order: { attempt_no: 'DESC' } });
    if (latest?.adapter === 'AGENT' && IN_FLIGHT.includes(latest.status)) {
      throw new ConflictException({
        code: 'TERMINAL_CHARGE_IN_PROGRESS',
        title: 'Card Charge In Progress',
        detail:
          latest.status === 'UNKNOWN'
            ? 'The card terminal has not confirmed the last charge. Check the terminal before charging again.'
            : 'The card terminal is still handling this payment.',
      });
    }
  }

  /** Sends the charge to the agent. The payment stays PROCESSING until the terminal answers. */
  async startCharge(em: EntityManager, payment: Payment, order: OrderHeader, device: PaymentDevice, actor: PaymentActor) {
    const amount = wholeRials(payment.amount);
    const attemptNo = (await em.count(PaymentAttempt, { where: { payment_id: payment.id } })) + 1;
    const attempt = await em.save(
      PaymentAttempt,
      em.create(PaymentAttempt, {
        tenant_id: payment.tenant_id,
        payment_id: payment.id,
        attempt_no: attemptNo,
        adapter: 'AGENT',
        status: 'PENDING',
        request_snapshot: { terminal_id: device.id, terminal_code: device.code, amount, currency: 'IRR' },
      }),
    );
    const command = await this.commands.enqueueInTransaction(
      em,
      payment.tenant_id,
      order.branch_id,
      'payment.charge',
      {
        payment_id: payment.id,
        attempt_id: attempt.id,
        attempt_no: attemptNo,
        terminal_id: device.id,
        amount,
        currency: 'IRR',
        order_number: order.order_number,
        payment_number: payment.payment_number,
        timeout_s: CHARGE_TIMEOUT_S,
      },
      { entityType: 'PaymentAttempt', entityId: attempt.id },
    );
    attempt.agent_command_id = command.id;
    await em.save(PaymentAttempt, attempt);

    payment.status = 'PROCESSING';
    payment.device_id = device.id;
    payment.needs_terminal_check = false;
    payment.failure_code = null as any;
    payment.failure_message = null as any;
    const saved = await em.save(Payment, payment);

    await this.auditWriter.writeInTransaction(em, {
      tenantId: payment.tenant_id,
      actorType: actor.userId ? 'ADMIN' : 'SYSTEM',
      actorId: actor.userId ?? undefined,
      action: 'PAYMENT_TERMINAL_CHARGE_SENT',
      entityType: 'Payment',
      entityId: payment.id,
      branchId: order.branch_id,
      correlationId: actor.correlationId ?? undefined,
      details: { attemptNo, terminalId: device.id, amount, commandId: command.id },
    });
    return saved;
  }

  async flush(tenantId: string, branchId: string) {
    await this.commands.flush(tenantId, branchId);
  }

  /** "Check with terminal": asks the agent how the last charge ended (§7.5). */
  async queryTerminal(tenantId: string, paymentId: string, actor: PaymentActor) {
    const { payment, attempt, order } = await this.loadUnresolved(tenantId, paymentId);
    const deviceId = attempt.request_snapshot?.terminal_id || payment.device_id;
    const connection = this.sessions.forBranch(tenantId, order.branch_id);
    if (connection && !connection.capabilities.includes('payment.query')) {
      throw new BadRequestException({
        code: 'QUERY_UNSUPPORTED',
        title: 'Terminal Cannot Be Queried',
        detail: "This branch's card terminal cannot report a past charge. Check the terminal's own report and resolve the payment by hand.",
      });
    }
    if (await this.commands.hasPending('payment.query', attempt.id)) {
      return { payment, queued: false };
    }
    await this.commands.enqueue(
      tenantId,
      order.branch_id,
      'payment.query',
      {
        payment_id: payment.id,
        attempt_id: attempt.id,
        terminal_id: deviceId,
        amount: wholeRials(payment.amount),
        sent_at: new Date(attempt.started_at).toISOString(),
      },
      { entityType: 'PaymentAttempt', entityId: attempt.id },
    );
    await this.auditWriter.write({
      tenantId,
      actorType: actor.userId ? 'ADMIN' : 'SYSTEM',
      actorId: actor.userId ?? undefined,
      action: 'PAYMENT_TERMINAL_QUERIED',
      entityType: 'Payment',
      entityId: payment.id,
      branchId: order.branch_id,
      correlationId: actor.correlationId ?? undefined,
    });
    return { payment, queued: true };
  }

  /**
   * A manager settles an unconfirmed charge from the terminal's own report: it went through
   * (with its reference number), or the customer was not charged.
   */
  async resolveByHand(
    tenantId: string,
    paymentId: string,
    input: { outcome: ManualResolution; rrn?: string; reason: string },
    actor: PaymentActor,
  ) {
    const reason = String(input.reason || '').trim();
    if (!reason) throw new BadRequestException('Say how you checked the terminal.');
    if (input.outcome === 'APPROVED' && !String(input.rrn || '').trim()) {
      throw new BadRequestException('Enter the reference number (RRN) from the terminal receipt.');
    }

    const saved = await this.dataSource.transaction(async (em) => {
      const { payment, attempt, order } = await this.loadUnresolved(tenantId, paymentId, em);
      const now = new Date();
      attempt.finished_at = now;
      attempt.response_snapshot = { resolved_by_hand: true, outcome: input.outcome, reason };
      if (input.outcome === 'APPROVED') {
        attempt.status = 'SUCCEEDED';
        attempt.external_reference = String(input.rrn).trim().slice(0, 160);
        await em.save(PaymentAttempt, attempt);
        payment.reference = attempt.external_reference;
        payment.needs_terminal_check = false;
        await this.assertCanBook(payment, order);
        await bookSucceededPayment(em, this.auditWriter, payment, order, actor);
      } else {
        attempt.status = 'FAILED';
        attempt.error_code = 'NOT_CHARGED';
        await em.save(PaymentAttempt, attempt);
        payment.status = 'FAILED';
        payment.needs_terminal_check = false;
        payment.failure_code = 'NOT_CHARGED';
        payment.failure_message = `Confirmed not charged: ${reason}`;
        await em.save(Payment, payment);
      }
      await this.auditWriter.writeInTransaction(em, {
        tenantId,
        actorType: 'ADMIN',
        actorId: actor.userId ?? undefined,
        action: 'PAYMENT_TERMINAL_RESOLVED',
        entityType: 'Payment',
        entityId: payment.id,
        branchId: order.branch_id,
        correlationId: actor.correlationId ?? undefined,
        details: { outcome: input.outcome, rrn: input.rrn ?? null, reason },
      });
      await this.closeAlerts(em, payment);
      return payment;
    });

    if (saved.status === 'SUCCEEDED') await this.completeOrder(saved, actor);
    return saved;
  }

  // ---------------------------------------------------------------------------------------

  private async applyResult(command: AgentCommand, message: Envelope, em: EntityManager): Promise<ResultOutcome> {
    const p = message.payload || {};
    const isQuery = command.type === 'payment.query';
    let status = String(p.status || '').toUpperCase();
    // Anything the cloud cannot read is treated as the one safe answer.
    if (!CHARGE_STATUSES.has(status) || (isQuery && status === 'FAILED')) status = 'UNKNOWN';

    const attempt = await em.findOne(PaymentAttempt, {
      where: { id: command.entity_id!, tenant_id: command.tenant_id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!attempt) return { status: 'FAILED', errorCode: 'NOT_FOUND', errorMessage: 'The payment attempt no longer exists.' };
    const payment = await em.findOne(Payment, {
      where: { id: attempt.payment_id, tenant_id: command.tenant_id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!payment) return { status: 'FAILED', errorCode: 'NOT_FOUND', errorMessage: 'The payment no longer exists.' };
    const order = await em.findOne(OrderHeader, {
      where: { id: payment.order_id, tenant_id: command.tenant_id },
      lock: { mode: 'pessimistic_write' },
    });

    const expected = wholeRials(payment.amount);
    const reported = typeof p.amount === 'string' || typeof p.amount === 'number' ? String(p.amount) : null;
    const rrn = typeof p.rrn === 'string' ? p.rrn.trim() : '';
    const error = p.error && typeof p.error === 'object' ? p.error : {};
    const errorCode = String(error.code || status).slice(0, 80);
    const errorMessage = typeof error.message === 'string' ? error.message.slice(0, 500) : null;

    const latest = await em.findOne(PaymentAttempt, { where: { payment_id: payment.id }, order: { attempt_no: 'DESC' } });
    const isLatest = latest?.id === attempt.id;

    attempt.response_snapshot = sanitiseResult(p);
    if (!isQuery || !['SUCCEEDED', 'FAILED'].includes(attempt.status)) attempt.finished_at = new Date();

    // --- the terminal took the money ------------------------------------------------------
    if (status === 'APPROVED') {
      attempt.external_reference = rrn ? rrn.slice(0, 160) : attempt.external_reference;
      if (!rrn || (reported !== null && reported !== expected)) {
        attempt.status = 'UNKNOWN';
        attempt.error_code = !rrn ? 'MISSING_RRN' : 'AMOUNT_MISMATCH';
        await em.save(PaymentAttempt, attempt);
        await this.flagUnresolved(
          em,
          payment,
          order,
          !rrn
            ? 'The terminal approved the charge but sent no reference number.'
            : `The terminal charged ${reported} rials; the payment was for ${expected}.`,
        );
        return { status: 'FAILED', errorCode: attempt.error_code };
      }
      attempt.status = 'SUCCEEDED';
      attempt.error_code = null as any;
      await em.save(PaymentAttempt, attempt);

      if (payment.status === 'SUCCEEDED') {
        if (!isLatest || payment.reference !== rrn) {
          await this.raiseAlert(em, payment, order, 'CRITICAL', `Check card charges on ${payment.payment_number}`,
            `The terminal reported an approved charge (RRN ${rrn}) that does not match the one recorded (RRN ${payment.reference || 'none'}). The card may have been charged twice; check the terminal and refund if so.`);
        }
        return { status: 'DONE' };
      }
      if (!isLatest || !['PROCESSING', 'FAILED', 'PENDING'].includes(payment.status) || !order) {
        payment.needs_terminal_check = true;
        await em.save(Payment, payment);
        await this.raiseAlert(em, payment, order, 'CRITICAL', `Card charged on closed payment ${payment.payment_number}`,
          `The terminal approved ${expected} rials (RRN ${rrn}) for a payment that is ${payment.status}. Check the order and refund on the terminal if needed.`);
        return { status: 'DONE' };
      }
      if (MoneyUtil.greaterThan(payment.amount, order.outstanding_total)) {
        payment.needs_terminal_check = true;
        await em.save(Payment, payment);
        await this.raiseAlert(em, payment, order, 'CRITICAL', `Card charged on settled order ${order.order_number}`,
          `The terminal approved ${expected} rials (RRN ${rrn}) after the order was paid some other way. Refund the card on the terminal.`);
        return { status: 'DONE' };
      }
      payment.reference = rrn;
      if (typeof p.stan === 'string' && p.stan) payment.receipt_number = p.stan.slice(0, 80);
      payment.needs_terminal_check = false;
      await bookSucceededPayment(em, this.auditWriter, payment, order, { actorType: 'SYSTEM', correlationId: command.id });
      await this.closeAlerts(em, payment);
      return { status: 'DONE' };
    }

    // --- the terminal cannot say ------------------------------------------------------------
    if (status === 'UNKNOWN') {
      if (!['SUCCEEDED', 'FAILED'].includes(attempt.status)) {
        attempt.status = 'UNKNOWN';
        attempt.error_code = errorCode;
        await em.save(PaymentAttempt, attempt);
        if (isLatest && payment.status === 'PROCESSING') {
          await this.flagUnresolved(em, payment, order, errorMessage || describeUnknown(errorCode));
          if (!isQuery) this.scheduleQuery(payment.tenant_id, payment.id);
        }
      }
      return { status: 'FAILED', errorCode };
    }

    // --- the charge did not happen ----------------------------------------------------------
    if (attempt.status === 'SUCCEEDED') return { status: 'DONE' };
    attempt.status = 'FAILED';
    attempt.error_code = errorCode;
    await em.save(PaymentAttempt, attempt);
    if (isLatest && payment.status === 'PROCESSING') {
      payment.status = 'FAILED';
      payment.needs_terminal_check = false;
      payment.failure_code = status === 'FAILED' ? errorCode : status;
      payment.failure_message = errorMessage || describeFailure(status, p.bank_response_code);
      await em.save(Payment, payment);
      await this.auditWriter.writeInTransaction(em, {
        tenantId: payment.tenant_id,
        actorType: 'SYSTEM',
        action: 'PAYMENT_FAILED',
        entityType: 'Payment',
        entityId: payment.id,
        branchId: order?.branch_id,
        correlationId: command.id,
        details: { terminalStatus: status, errorCode, bankResponseCode: p.bank_response_code ?? null },
      });
      await this.closeAlerts(em, payment);
    }
    return { status: 'FAILED', errorCode: payment.failure_code || errorCode };
  }

  /** Commands that ended without a result, and approvals that need the order completed. */
  private async onCommandSettled(command: AgentCommand) {
    if (command.type !== 'payment.charge' && command.type !== 'payment.query') return;

    if (command.result) {
      if (String(command.result.status || '').toUpperCase() !== 'APPROVED') return;
      const payment = await this.dataSource.getRepository(Payment).findOne({ where: { id: command.payload.payment_id } });
      if (payment?.status === 'SUCCEEDED') await this.completeOrder(payment, { correlationId: command.id });
      return;
    }
    if (command.type !== 'payment.charge') return;

    // Refused by the agent, or expired before the agent acked. Only a command that was never
    // written to the socket is known not to have reached the terminal.
    const neverReached = command.error_code !== 'EXPIRED' || command.send_count === 0;
    const unresolved = await this.dataSource.transaction(async (em): Promise<Payment | null> => {
      const attempt = await em.findOne(PaymentAttempt, {
        where: { id: command.entity_id!, tenant_id: command.tenant_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!attempt || attempt.status !== 'PENDING') return null;
      const payment = await em.findOne(Payment, {
        where: { id: attempt.payment_id, tenant_id: command.tenant_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) return null;
      const order = await em.findOne(OrderHeader, { where: { id: payment.order_id, tenant_id: command.tenant_id } });
      attempt.finished_at = new Date();

      if (neverReached) {
        const code = command.error_code === 'EXPIRED' ? 'AGENT_OFFLINE' : command.error_code || 'AGENT_REFUSED';
        attempt.status = 'FAILED';
        attempt.error_code = code;
        await em.save(PaymentAttempt, attempt);
        if (payment.status === 'PROCESSING') {
          payment.status = 'FAILED';
          payment.failure_code = code;
          payment.failure_message =
            code === 'AGENT_OFFLINE'
              ? 'The branch agent was offline, so the card terminal never got the charge. The customer was not charged.'
              : `The branch agent refused the charge (${code}): ${command.error_message || 'no detail'}. The customer was not charged.`;
          await em.save(Payment, payment);
        }
        return null;
      }

      attempt.status = 'UNKNOWN';
      attempt.error_code = 'NO_ANSWER';
      await em.save(PaymentAttempt, attempt);
      if (payment.status !== 'PROCESSING') return null;
      await this.flagUnresolved(em, payment, order, 'The charge was sent to the branch agent, which never confirmed it.');
      return payment;
    });
    if (unresolved) this.scheduleQuery(unresolved.tenant_id, unresolved.id);
  }

  private scheduleQuery(tenantId: string, paymentId: string, delayMs = AUTO_QUERY_DELAY_MS) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.queryTerminal(tenantId, paymentId, { actorType: 'SYSTEM' }).catch((err) =>
        this.logger.warn(`automatic terminal query for ${paymentId} not sent: ${err?.message || err}`),
      );
    }, delayMs);
    timer.unref?.();
    this.timers.add(timer);
  }

  private async loadUnresolved(tenantId: string, paymentId: string, em: EntityManager = this.dataSource.manager) {
    const lock = em.queryRunner?.isTransactionActive ? { mode: 'pessimistic_write' as const } : undefined;
    const payment = await em.findOne(Payment, { where: { id: paymentId, tenant_id: tenantId }, lock });
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);
    const attempt = await em.findOne(PaymentAttempt, { where: { payment_id: payment.id }, order: { attempt_no: 'DESC' } });
    if (payment.status !== 'PROCESSING' || !payment.needs_terminal_check || attempt?.adapter !== 'AGENT' || attempt.status !== 'UNKNOWN') {
      throw new BadRequestException({
        code: 'NOTHING_TO_CHECK',
        title: 'Nothing To Check',
        detail: 'Only a card charge the terminal has not confirmed can be checked or resolved.',
      });
    }
    const order = await em.findOne(OrderHeader, { where: { id: payment.order_id, tenant_id: tenantId }, lock });
    if (!order) throw new NotFoundException(`Order ${payment.order_id} not found`);
    return { payment, attempt, order };
  }

  private async assertCanBook(payment: Payment, order: OrderHeader) {
    if (MoneyUtil.greaterThan(payment.amount, order.outstanding_total)) {
      throw new ConflictException({
        code: 'ORDER_ALREADY_PAID',
        title: 'Order Already Paid',
        detail: 'The order has been paid another way since. Refund the card on the terminal, then mark this charge as not taken.',
      });
    }
  }

  private async flagUnresolved(em: EntityManager, payment: Payment, order: OrderHeader | null, why: string) {
    payment.needs_terminal_check = true;
    if (payment.status !== 'SUCCEEDED') payment.status = 'PROCESSING';
    await em.save(Payment, payment);
    await this.raiseAlert(
      em,
      payment,
      order,
      'CRITICAL',
      `Check card terminal: ${payment.payment_number}`,
      `${why} The customer may have been charged. Check the terminal, then use "Check with terminal" or resolve the payment by hand. Do not charge again until then.`,
    );
  }

  private async raiseAlert(
    em: EntityManager,
    payment: Payment,
    order: OrderHeader | null,
    severity: 'WARNING' | 'CRITICAL',
    title: string,
    message: string,
  ) {
    const trimmed = title.slice(0, 150);
    const open = await em.findOne(OperationalAlert, {
      where: { tenant_id: payment.tenant_id, type: 'PAYMENT_TERMINAL', title: trimmed, acknowledged: false },
    });
    if (open) return;
    await em.save(
      OperationalAlert,
      em.create(OperationalAlert, {
        tenant_id: payment.tenant_id,
        branch_id: order?.branch_id ?? null,
        type: 'PAYMENT_TERMINAL',
        severity,
        title: trimmed,
        message,
        acknowledged: false,
      }),
    );
    this.logger.warn(`${title}: ${message}`);
  }

  /** The "check terminal" alert for a payment is closed once the payment is settled either way. */
  private async closeAlerts(em: EntityManager, payment: Payment) {
    await em.update(
      OperationalAlert,
      { tenant_id: payment.tenant_id, type: 'PAYMENT_TERMINAL', title: `Check card terminal: ${payment.payment_number}`.slice(0, 150), acknowledged: false },
      { acknowledged: true, acknowledged_at: new Date(), acknowledged_by: 'SYSTEM' } as any,
    );
  }

  private async completeOrder(payment: Payment, actor: PaymentActor) {
    try {
      await this.orderService.afterPaymentSucceeded(payment.tenant_id, payment.order_id, actor.userId ?? undefined, actor.correlationId ?? undefined);
    } catch (err: any) {
      this.logger.error(`Could not complete order ${payment.order_id} after card payment: ${err?.message || err}`);
    }
  }
}

export function isAgentTerminal(device: PaymentDevice): boolean {
  return !!device.is_active && !!device.agent_connection && !!device.agent_driver;
}

/** Terminals charge whole rials; a fraction would be rounded somewhere nobody sees. */
export function wholeRials(amount: string): string {
  const s = String(amount ?? '').trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m || (m[2] && !/^0+$/.test(m[2]))) {
    throw new BadRequestException(`A card terminal charges whole rials; ${s} is not one.`);
  }
  return m[1].replace(/^0+(?=\d)/, '');
}

/** Only what the protocol allows, and never more of a card number than its mask. */
export function sanitiseResult(p: Record<string, any>) {
  const pick = (k: string, max = 64) => (typeof p[k] === 'string' || typeof p[k] === 'number' ? String(p[k]).slice(0, max) : undefined);
  const pan = typeof p.card_pan_masked === 'string' && PAN_MASK.test(p.card_pan_masked) ? p.card_pan_masked : undefined;
  const error = p.error && typeof p.error === 'object'
    ? { code: typeof p.error.code === 'string' ? p.error.code.slice(0, 80) : undefined, message: typeof p.error.message === 'string' ? p.error.message.slice(0, 500) : undefined }
    : undefined;
  return {
    status: pick('status', 16),
    amount: pick('amount', 32),
    rrn: pick('rrn'),
    stan: pick('stan'),
    auth_code: pick('auth_code'),
    terminal_serial: pick('terminal_serial'),
    card_pan_masked: pan,
    bank_response_code: pick('bank_response_code', 16),
    started_at: pick('started_at', 40),
    finished_at: pick('finished_at', 40),
    error,
  };
}

function describeUnknown(code: string): string {
  switch (code) {
    case 'TIMEOUT':
      return 'The terminal did not answer in time.';
    case 'CONNECTION_LOST':
      return 'The link to the terminal dropped during the charge.';
    case 'AGENT_RESTARTED':
      return 'The branch agent restarted during the charge.';
    case 'BAD_RESPONSE':
      return 'The terminal answered with something the agent could not read.';
    case 'QUERY_UNSUPPORTED':
      return 'The terminal cannot report a past charge.';
    default:
      return 'The terminal did not confirm the charge.';
  }
}

function describeFailure(status: string, bankCode?: unknown): string {
  switch (status) {
    case 'DECLINED':
      return `The card was declined${bankCode ? ` (bank code ${bankCode})` : ''}.`;
    case 'CANCELLED':
      return 'The charge was cancelled on the terminal.';
    default:
      return 'The terminal could not start the charge. The customer was not charged.';
  }
}
