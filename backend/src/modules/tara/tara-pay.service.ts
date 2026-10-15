import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource, EntityManager, In, IsNull, LessThanOrEqual, Not } from 'typeorm';
import { Payment } from '../../entities/Payment.entity';
import { PaymentAttempt } from '../../entities/PaymentAttempt.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { TaraCall, TaraConnection, TaraPurchase, TaraTerminal } from '../../entities/Tara.entity';
import { loadBusinessClock } from '../../common/utils/business-clock';
import { MoneyUtil } from '../../common/utils/money.util';
import { AuditWriter } from '../audit/audit-writer.service';
import { OrderService } from '../order/order.service';
import { bookSucceededPayment, PaymentActor } from '../payment/payment-settlement';
import { TaraClientService, TaraInvoice, TaraNoReply } from './tara-client.service';
import { TaraService, TaraTillBlock } from './tara.service';

/** The first look after a call got no answer; Tara's document then asks every 30 s for 2 minutes. */
const FIRST_CHECK_MS = 5_000;
const CHECK_EVERY_MS = 30_000;
const ASK_FOR_MS = 2 * 60_000;
const SWEEP_MS = 5_000;
/** Tara's unit code for "piece" (عدد). */
const UNIT_PIECE = 5;

const whole = (amount: string | number | null | undefined) => Math.round(Number(amount || 0));

const BLOCKED: Record<TaraTillBlock, string> = {
  NOT_CONNECTED: 'Tara is not connected. Head office connects it under Settings → Tara.',
  NO_BRANCH_CODE: 'This branch has no Tara code yet. Head office adds it under Settings → Tara.',
  NO_TERMINAL: 'This till has no Tara terminal. Head office gives it one under Settings → Tara.',
};

/**
 * A sale paid with Tara, the way Tara's document lays it out: Trace (Tara checks the customer
 * may buy here), PurchaseRequest (the amount is held on their credit), then VerifyPurchase right
 * away, as the cashier takes it in one step. A call that gets no answer leaves the payment
 * PROCESSING and the sweep finds out what happened with InquiryPurchase, every 30 seconds for
 * two minutes, then repeats the same call once; a sale still unanswered is marked stuck for a
 * manager. PurchaseRequest is never sent twice for a sale Tara received.
 */
@Injectable()
export class TaraPayService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TaraPayService.name);
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly client: TaraClientService,
    private readonly tara: TaraService,
    private readonly auditWriter: AuditWriter,
    // Orders reach Tara through refunds, so the order service is looked up when a sale completes.
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Takes `payment` (PROCESSING, locked by the caller with its order) through Tara. Returns the
   * payment as it stands: SUCCEEDED (booked), FAILED, or still PROCESSING while the sweep asks.
   */
  async charge(em: EntityManager, payment: Payment, order: OrderHeader, barcodeIn: string | undefined, actor: PaymentActor) {
    const barcode = String(barcodeIn || '').replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/\D/g, '');
    // A sale already under way with Tara is never started again; a failed one makes way for a new try.
    const earlier = await em.findOne(TaraPurchase, { where: { payment_id: payment.id }, lock: { mode: 'pessimistic_write' } });
    if (earlier && earlier.step !== 'FAILED') {
      throw new ConflictException({ code: 'TARA_IN_PROGRESS', title: 'Tara', detail: 'This Tara payment is already with Tara.' });
    }
    if (earlier) await em.delete(TaraPurchase, { payment_id: payment.id });

    // Refusals end the payment as FAILED rather than throwing: a PENDING intent left behind would
    // block every other way of paying the order.
    if (!barcode) return await this.fail(em, payment, null, 'TARA_BARCODE_REQUIRED', 'Scan or type the barcode on the customer’s Tara app.');
    const found = await this.tara.terminalFor(em, payment.tenant_id, order.branch_id, order.terminal_id);
    if ('block' in found) return await this.fail(em, payment, null, `TARA_${found.block}`, BLOCKED[found.block]);

    const purchase = await em.save(
      TaraPurchase,
      em.create(TaraPurchase, {
        payment_id: payment.id,
        tenant_id: payment.tenant_id,
        branch_id: order.branch_id,
        terminal_code: found.terminal.terminal_code,
        barcode,
        step: 'TRACE',
      }),
    );
    await this.attempt(em, payment, 'PENDING');

    const amount = whole(payment.amount);
    let traced;
    try {
      traced = await this.client.trace(payment.tenant_id, found.terminal.access_code, found.terminal.terminal_code, [{ barcode, amount }]);
    } catch (err) {
      if (!(err instanceof TaraNoReply)) throw err;
      // Nothing is held before a purchase request, so a lost trace is simply taken again.
      return await this.fail(em, payment, purchase, 'TARA_NO_REPLY', 'Tara did not answer. Try again.');
    }
    if (!traced.ok) return await this.fail(em, payment, purchase, 'TARA_DECLINED', traced.message);
    purchase.trace_number = traced.body.traceNumber;
    purchase.mobile = traced.body.mobile || null;
    purchase.step = 'REQUEST';
    await em.save(TaraPurchase, purchase);
    payment.reference = traced.body.traceNumber;

    return await this.request(em, payment, order, purchase, found.terminal, actor);
  }

  /** Gives a same-day Tara sale back through ReversePurchase. Throws when Tara refuses or is silent. */
  async reverse(em: EntityManager, payment: Payment, actor: PaymentActor) {
    const purchase = await em.findOne(TaraPurchase, { where: { payment_id: payment.id }, lock: { mode: 'pessimistic_write' } });
    if (!purchase?.trace_number) throw new ConflictException({ code: 'TARA_PURCHASE_MISSING', title: 'Tara', detail: 'This Tara sale has no trace number to reverse.' });
    if (purchase.step === 'REVERSED') return purchase;
    const terminal = await this.terminalOf(em, purchase);
    let answer;
    try {
      answer = await this.client.reverse(payment.tenant_id, terminal.access_code, purchase.trace_number);
    } catch (err) {
      if (!(err instanceof TaraNoReply)) throw err;
      // Asking again is safe: Tara answers a repeated reverse the same way.
      throw new ConflictException({ code: 'TARA_NO_REPLY', title: 'Tara', detail: 'Tara did not answer the reversal. Try again.' });
    }
    if (!answer.ok) throw new ConflictException({ code: 'TARA_REVERSE_FAILED', title: 'Tara', detail: answer.message });
    purchase.step = 'REVERSED';
    purchase.reversed_at = new Date();
    await em.save(TaraPurchase, purchase);
    await this.auditWriter.writeInTransaction(em, {
      tenantId: payment.tenant_id,
      actorType: actor.userId ? 'ADMIN' : 'SYSTEM',
      actorId: actor.userId ?? undefined,
      action: 'TARA_REVERSED',
      entityType: 'Payment',
      entityId: payment.id,
      correlationId: actor.correlationId ?? undefined,
      details: { trace_number: purchase.trace_number, reference_number: purchase.reference_number },
    });
    return purchase;
  }

  /** Whether a Tara payment can still be reversed through Tara: only on the business day it was taken. */
  async reversibleToday(em: EntityManager, payment: Payment, branchId: string) {
    const today = (await loadBusinessClock(em, payment.tenant_id, branchId)).today();
    return payment.business_date === today;
  }

  /** The Tara side of each payment, for the till's pay panel and the Payments page. */
  async purchasesFor(tenantId: string, paymentIds: string[]) {
    if (!paymentIds.length) return new Map<string, TaraPurchase>();
    const rows = await this.dataSource.manager.find(TaraPurchase, { where: { tenant_id: tenantId, payment_id: In(paymentIds) } });
    return new Map(rows.map((r) => [r.payment_id, r]));
  }

  /** A manager's "Check with Tara" on a stuck sale: asks again now, and keeps asking if needed. */
  async checkNow(tenantId: string, paymentId: string, userId?: string) {
    const purchase = await this.dataSource.manager.findOne(TaraPurchase, { where: { tenant_id: tenantId, payment_id: paymentId } });
    if (!purchase) throw new NotFoundException(`No Tara sale for payment ${paymentId}`);
    if (purchase.awaiting) {
      await this.dataSource.manager.update(
        TaraPurchase,
        { payment_id: paymentId },
        { stuck: false, unanswered_since: new Date(), checks: 0, next_check_at: new Date() },
      );
      await this.followUp(tenantId, paymentId, new Date(), userId);
    }
    return await this.dataSource.manager.findOneOrFail(Payment, { where: { id: paymentId, tenant_id: tenantId } });
  }

  /** One pass of the sweep: every sale whose next look is due. Tests call it with their own clock. */
  async resolvePending(now: Date = new Date()) {
    const due = await this.dataSource.manager.find(TaraPurchase, {
      where: { awaiting: Not(IsNull()), stuck: false, next_check_at: LessThanOrEqual(now) },
      order: { next_check_at: 'ASC' },
      take: 50,
    });
    for (const p of due) {
      try {
        await this.followUp(p.tenant_id, p.payment_id, now);
      } catch (err) {
        this.logger.warn(`Tara follow-up of payment ${p.payment_id} failed: ${(err as Error)?.message}`);
      }
    }
    return due.length;
  }

  onApplicationBootstrap() {
    // Tests drive resolvePending themselves, and a live timer would keep Jest from exiting.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.resolvePending();
    } catch (err) {
      this.logger.error(`Tara sweep failed: ${(err as Error)?.message}`);
    } finally {
      this.sweeping = false;
    }
  }

  /** Finds out what happened to the call that got no answer, and carries the sale on from there. */
  private async followUp(tenantId: string, paymentId: string, now: Date, userId?: string) {
    let booked: Payment | null = null;
    await this.dataSource.transaction(async (em) => {
      const payment = await em.findOne(Payment, { where: { id: paymentId, tenant_id: tenantId }, lock: { mode: 'pessimistic_write' } });
      const purchase = await em.findOne(TaraPurchase, { where: { payment_id: paymentId }, lock: { mode: 'pessimistic_write' } });
      if (!payment || !purchase?.awaiting || payment.status !== 'PROCESSING') {
        if (purchase?.awaiting) await em.update(TaraPurchase, { payment_id: paymentId }, { awaiting: null, next_check_at: null });
        return;
      }
      const order = await em.findOneOrFail(OrderHeader, { where: { id: payment.order_id, tenant_id: tenantId }, lock: { mode: 'pessimistic_write' } });
      const terminal = await this.terminalOf(em, purchase);
      const actor: PaymentActor = { userId: userId ?? null, actorType: userId ? 'ADMIN' : 'SYSTEM', correlationId: `tara-${paymentId}` };

      let answer;
      try {
        answer = await this.client.inquiry(tenantId, terminal.access_code, purchase.trace_number!);
      } catch (err) {
        if (!(err instanceof TaraNoReply)) throw err;
        answer = null;
      }

      if (answer === null) {
        purchase.checks += 1;
        const since = purchase.unanswered_since ? new Date(purchase.unanswered_since).getTime() : now.getTime();
        if (now.getTime() - since < ASK_FOR_MS) {
          purchase.next_check_at = new Date(now.getTime() + CHECK_EVERY_MS);
          await em.save(TaraPurchase, purchase);
          return;
        }
        // Two minutes without an answer to the inquiry: the same call once more, as the document allows.
        const result = await this.repeat(em, payment, order, purchase, terminal, actor);
        if (purchase.awaiting) {
          purchase.stuck = true;
          purchase.next_check_at = null;
          await em.save(TaraPurchase, purchase);
        }
        if (result.status === 'SUCCEEDED') booked = result;
        return;
      }

      const track = answer.ok ? answer.body.purchaseTrack.map((t) => t.type) : [];
      const status = answer.ok ? answer.body.message : 'NOT_FOUND';
      const cancelled = status === 'REVERSED' || status === 'EXPIRED';
      let result: Payment;
      if (purchase.awaiting === 'REQUEST') {
        if (!track.includes('REQUEST')) {
          // The request never reached Tara: it is sent now, once.
          result = await this.request(em, payment, order, purchase, terminal, actor);
        } else if (cancelled) {
          result = await this.fail(em, payment, purchase, 'TARA_CANCELLED', 'Tara cancelled the hold before it was confirmed.');
        } else {
          if (answer.ok && answer.body.referenceNumber) purchase.reference_number = answer.body.referenceNumber;
          purchase.step = 'VERIFY';
          result = await this.verify(em, payment, order, purchase, terminal, actor);
        }
      } else if (track.includes('VERIFY')) {
        result = await this.succeed(em, payment, order, purchase, actor);
      } else if (cancelled) {
        result = await this.fail(em, payment, purchase, 'TARA_CANCELLED', 'Tara cancelled the hold before it was confirmed.');
      } else {
        result = await this.verify(em, payment, order, purchase, terminal, actor);
      }
      if (result.status === 'SUCCEEDED') booked = result;
    });
    if (booked) {
      try {
        await this.moduleRef.get(OrderService, { strict: false }).afterPaymentSucceeded(tenantId, (booked as Payment).order_id, userId, `tara-${paymentId}`);
      } catch (err) {
        this.logger.error(`Could not complete order after Tara payment ${paymentId}: ${(err as Error)?.message}`);
      }
    }
  }

  /** The call that got no answer, sent again without asking first. */
  private async repeat(em: EntityManager, payment: Payment, order: OrderHeader, purchase: TaraPurchase, terminal: TaraTerminal, actor: PaymentActor) {
    return purchase.awaiting === 'REQUEST'
      ? await this.request(em, payment, order, purchase, terminal, actor)
      : await this.verify(em, payment, order, purchase, terminal, actor);
  }

  private async request(em: EntityManager, payment: Payment, order: OrderHeader, purchase: TaraPurchase, terminal: TaraTerminal, actor: PaymentActor) {
    const invoice = await this.invoiceFor(em, order);
    let answer;
    try {
      answer = await this.client.request(payment.tenant_id, terminal.access_code, purchase.trace_number!, whole(payment.amount), invoice);
    } catch (err) {
      if (!(err instanceof TaraNoReply)) throw err;
      return await this.awaitAnswer(em, payment, purchase, 'REQUEST');
    }
    if (!answer.ok) return await this.fail(em, payment, purchase, 'TARA_DECLINED', answer.message);
    purchase.reference_number = answer.body.referenceNumber;
    purchase.step = 'VERIFY';
    return await this.verify(em, payment, order, purchase, terminal, actor);
  }

  private async verify(em: EntityManager, payment: Payment, order: OrderHeader, purchase: TaraPurchase, terminal: TaraTerminal, actor: PaymentActor) {
    let answer;
    try {
      answer = await this.client.verify(payment.tenant_id, terminal.access_code, purchase.trace_number!);
    } catch (err) {
      if (!(err instanceof TaraNoReply)) throw err;
      return await this.awaitAnswer(em, payment, purchase, 'VERIFY');
    }
    if (!answer.ok) {
      // Let go of the hold so the customer's credit is not tied up for 30 minutes.
      await this.client.reverse(payment.tenant_id, terminal.access_code, purchase.trace_number!).catch(() => undefined);
      return await this.fail(em, payment, purchase, 'TARA_DECLINED', answer.message);
    }
    if (answer.body.referenceNumber) purchase.reference_number = answer.body.referenceNumber;
    return await this.succeed(em, payment, order, purchase, actor);
  }

  private async succeed(em: EntityManager, payment: Payment, order: OrderHeader, purchase: TaraPurchase, actor: PaymentActor) {
    purchase.step = 'DONE';
    purchase.awaiting = null;
    purchase.next_check_at = null;
    purchase.stuck = false;
    await em.save(TaraPurchase, purchase);
    payment.reference = purchase.reference_number || purchase.trace_number || payment.reference;
    await this.finishAttempt(em, payment, 'SUCCEEDED', null, payment.reference);
    return await bookSucceededPayment(em, this.auditWriter, payment, order, actor);
  }

  private async fail(em: EntityManager, payment: Payment, purchase: TaraPurchase | null, code: string, message: string) {
    if (purchase) {
      purchase.step = 'FAILED';
      purchase.awaiting = null;
      purchase.next_check_at = null;
      purchase.stuck = false;
      await em.save(TaraPurchase, purchase);
    }
    payment.status = 'FAILED';
    payment.failure_code = code;
    payment.failure_message = message;
    await this.finishAttempt(em, payment, 'FAILED', code, null);
    return await em.save(Payment, payment);
  }

  /** No answer: the payment waits, PROCESSING, until the sweep finds out what Tara did. */
  private async awaitAnswer(em: EntityManager, payment: Payment, purchase: TaraPurchase, call: TaraCall) {
    const now = new Date();
    if (purchase.awaiting !== call) {
      purchase.unanswered_since = now;
      purchase.checks = 0;
    }
    purchase.awaiting = call;
    purchase.step = call;
    purchase.next_check_at = new Date(now.getTime() + (purchase.checks === 0 ? FIRST_CHECK_MS : CHECK_EVERY_MS));
    await em.save(TaraPurchase, purchase);
    payment.status = 'PROCESSING';
    return await em.save(Payment, payment);
  }

  /**
   * The invoice Tara asks for with the purchase request: every line with Tara's product group
   * for its category, the order's total and its VAT, in whole rials.
   */
  private async invoiceFor(em: EntityManager, order: OrderHeader): Promise<TaraInvoice> {
    const connection = await em.findOne(TaraConnection, { where: { tenant_id: order.tenant_id } });
    const lines = (await em.find(OrderItem, { where: { order_id: order.id, tenant_id: order.tenant_id }, order: { line_number: 'ASC' } })).filter(
      (l) => !l.state || l.state === 'ACTIVE',
    );
    const categories = await this.tara.categoriesOf(em, order.tenant_id, [...new Set(lines.map((l) => l.product_id).filter(Boolean))]);
    const groups = connection?.groups ?? [];
    const groupOf = (categoryId?: string) => {
      const id = (categoryId && connection?.category_groups?.[categoryId]) || Number(connection?.default_group_id) || groups[0]?.id;
      return groups.find((g) => Number(g.id) === Number(id)) ?? { id: Number(id) || 0, title: '' };
    };
    return {
      totalPrice: whole(order.grand_total),
      invoiceNumber: order.order_number,
      vat: whole(order.tax_total),
      items: lines.map((l) => {
        const count = Number(l.quantity) || 1;
        const group = groupOf(categories.get(l.product_id));
        return {
          name: [l.product_name, l.variant_name].filter(Boolean).join(' - '),
          code: l.product_code || l.product_id,
          count,
          unit: UNIT_PIECE,
          fee: whole(MoneyUtil.divide(l.line_total, String(count), 0)),
          group: String(group.id),
          groupTitle: group.title,
          made: 0,
        };
      }),
    };
  }

  private async terminalOf(em: EntityManager, purchase: TaraPurchase) {
    const terminal = await em.findOne(TaraTerminal, { where: { tenant_id: purchase.tenant_id, terminal_code: purchase.terminal_code } });
    if (!terminal) {
      throw new ConflictException({ code: 'TARA_TERMINAL_GONE', title: 'Tara', detail: `Tara terminal ${purchase.terminal_code} is no longer set up.` });
    }
    return terminal;
  }

  private async attempt(em: EntityManager, payment: Payment, status: string) {
    const attemptNo = (await em.count(PaymentAttempt, { where: { payment_id: payment.id } })) + 1;
    await em.save(
      PaymentAttempt,
      em.create(PaymentAttempt, { tenant_id: payment.tenant_id, payment_id: payment.id, attempt_no: attemptNo, adapter: 'TARA', status }),
    );
  }

  private async finishAttempt(em: EntityManager, payment: Payment, status: string, errorCode: string | null, reference: string | null) {
    const latest = await em.findOne(PaymentAttempt, { where: { payment_id: payment.id, adapter: 'TARA' }, order: { attempt_no: 'DESC' } });
    if (!latest) return;
    latest.status = status;
    if (errorCode) latest.error_code = errorCode;
    if (reference) latest.external_reference = reference;
    latest.finished_at = new Date();
    await em.save(PaymentAttempt, latest);
  }
}
