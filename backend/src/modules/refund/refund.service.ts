import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BusinessDateUtil } from '../../common/utils/business-date.util';
import { loadBusinessClock } from '../../common/utils/business-clock';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { Refund } from '../../entities/Refund.entity';
import { RefundAllocation } from '../../entities/RefundAllocation.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderStateEvent } from '../../entities/OrderStateEvent.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { isAggregatorOrder } from '../../common/utils/snappfood-order.util';
import { ShiftService } from '../cashier/shift.service';
import { CreditService } from '../customer/credit.service';
import { AuditWriter } from '../audit/audit-writer.service';
import { RefundCreateDto, PaidOrderCancelDto } from './dtos/refund.dto';

/** What is left to give back of one payment, and the method it was taken by. */
interface PaymentShare {
  payment: Payment;
  method: PaymentMethod | null;
  remaining: string;
}

/** Who is doing it and who released the money, for the refund's audit events. */
interface RefundContext {
  userId?: string;
  correlationId?: string;
  /** The manager whose PIN was given, or the manager doing it. */
  approvedBy?: string | null;
}

@Injectable()
export class RefundService {
  constructor(
    @InjectRepository(Refund) private readonly refundRepo: Repository<Refund>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    private readonly shiftService: ShiftService,
    private readonly creditService: CreditService,
    private readonly auditWriter: AuditWriter,
    private readonly dataSource: DataSource,
  ) {}

  private async generateRefundNumber(tenantId: string, em: EntityManager): Promise<string> {
    const todayStr = BusinessDateUtil.today(new Date()).replace(/-/g, ''); // the till's day, not UTC's
    const prefix = `REF-${todayStr}-`;
    const count = await em
      .createQueryBuilder(Refund, 'r')
      .where('r.tenant_id = :tenantId', { tenantId })
      .andWhere('r.refund_number LIKE :prefix', { prefix: `${prefix}%` })
      .getCount();
    const seq = (count + 1).toString().padStart(4, '0');
    return `${prefix}${seq}`;
  }

  /**
   * Each payment on the order with what earlier refunds have not yet given back of it. An
   * order refunded before (an older partial refund) is paid back from where that stopped.
   */
  private async paymentShares(tenantId: string, orderId: string, em: EntityManager): Promise<PaymentShare[]> {
    const payments = (
      await em.find(Payment, {
        where: [
          { tenant_id: tenantId, order_id: orderId, status: 'SUCCEEDED' },
          { tenant_id: tenantId, order_id: orderId, status: 'COMPLETED' as any },
        ],
        order: { initiated_at: 'ASC' },
      })
    ).filter((p) => p.status === 'SUCCEEDED' || (p.status as any) === 'COMPLETED');

    const done = await em.find(Refund, { where: { tenant_id: tenantId, order_id: orderId, status: 'SUCCEEDED' } });
    const given = new Map<string, string>();
    if (done.length) {
      const allocations = await em.find(RefundAllocation, {
        where: { tenant_id: tenantId, refund_id: In(done.map((r) => r.id)) },
      });
      for (const a of allocations) {
        const key = a.payment_id || a.original_payment_id;
        if (key) given.set(key, MoneyUtil.add(given.get(key) || '0.0000', a.amount || a.amount_refunded || '0'));
      }
    }

    const methods = new Map<string, PaymentMethod | null>();
    const shares: PaymentShare[] = [];
    for (const payment of payments) {
      if (!methods.has(payment.method_id)) {
        methods.set(
          payment.method_id,
          await em.findOne(PaymentMethod, { where: { id: payment.method_id, tenant_id: tenantId } }),
        );
      }
      const left = MoneyUtil.subtract(payment.amount, given.get(payment.id) || '0.0000');
      shares.push({
        payment,
        method: methods.get(payment.method_id) ?? null,
        remaining: MoneyUtil.greaterThan(left, '0.0000') ? left : '0.0000',
      });
    }
    return shares;
  }

  async getRefunds(tenantId: string, query: any, branchId?: string) {
    const qb = this.refundRepo.createQueryBuilder('r').where('r.tenant_id = :tenantId', { tenantId });
    // A refund has no branch of its own: it belongs to the branch of the order it pays back.
    if (branchId) {
      qb.innerJoin(OrderHeader, 'o', 'o.id = r.order_id AND o.branch_id = :branchId', { branchId });
    }
    if (query.orderId) qb.andWhere('r.order_id = :orderId', { orderId: query.orderId });
    if (query.status) qb.andWhere('r.status = :status', { status: query.status });

    qb.orderBy('r.initiated_at', 'DESC');
    const page = Math.max(parseInt(query.page || '1', 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 200);
    qb.skip((page - 1) * limit).take(limit);

    const [rows, total] = await qb.getManyAndCount();

    // The order number is what the receipt in the customer's hand shows, and its total says
    // whether a refund gave all of it back.
    const orderIds = [...new Set(rows.map((r) => r.order_id))];
    const orders = orderIds.length
      ? await this.orderRepo.find({
          where: { id: In(orderIds), tenant_id: tenantId },
          select: ['id', 'order_number', 'total_amount'],
        })
      : [];
    const byId = new Map(orders.map((o) => [o.id, o]));
    const data = rows.map((r) => ({
      ...r,
      order_number: byId.get(r.order_id)?.order_number ?? null,
      order_total: byId.get(r.order_id)?.total_amount ?? null,
    }));
    return { data, total, page, limit };
  }

  async getRefundById(tenantId: string, id: string) {
    const refund = await this.refundRepo.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['allocations'],
    });
    if (!refund) throw new NotFoundException(`Refund ${id} not found`);
    return refund;
  }

  /**
   * The one refund: all of a completed order's money goes back, each payment by the method it
   * was taken with and for its own amount (a split sale is several refunds). Done in one
   * transaction holding the order, so a refusal anywhere (a closed drawer) leaves nothing
   * behind, and a second refund of the same order waits and then finds nothing left to give.
   */
  async refundOrder(tenantId: string, orderId: string, dto: RefundCreateDto, ctx: RefundContext = {}): Promise<Refund[]> {
    return await this.dataSource.transaction(async (em) =>
      this.payBack(tenantId, orderId, { reason: dto.reason, reasonCodeId: dto.reasonCodeId }, ctx, em, false),
    );
  }

  /**
   * Gives every payment on the order back and records one refund per payment. `cancelling` is
   * the paid-order cancel, which refunds whatever state the order is in; the plain refund
   * takes a COMPLETED order only.
   */
  private async payBack(
    tenantId: string,
    orderId: string,
    input: { reason: string; reasonCodeId?: string; approvalRequestId?: string },
    ctx: RefundContext,
    em: EntityManager,
    cancelling: boolean,
  ): Promise<Refund[]> {
    const order = await em.findOne(OrderHeader, {
      where: { id: orderId, tenant_id: tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    // Snappfood took the customer's money and refunds it itself; the till never held it.
    if (isAggregatorOrder(order)) {
      throw new ConflictException({
        code: 'SNAPPFOOD_ORDER_LOCKED',
        message: `Order ${order.order_number} was paid through Snappfood, which refunds its customers itself`,
      });
    }

    if (!cancelling && order.state !== 'COMPLETED') {
      throw new BadRequestException(
        `Refunds are permitted only on COMPLETED orders. Current state: ${order.state}. To undo payments on open orders, use payment reversal/correction.`,
      );
    }

    if (!input.reason) {
      throw new BadRequestException('Refund requires a mandatory reason');
    }

    const shares = await this.paymentShares(tenantId, orderId, em);
    const legs = shares.filter((s) => MoneyUtil.greaterThan(s.remaining, '0.0000'));
    if (legs.length === 0) {
      throw new BadRequestException(`Order ${orderId} has no refundable balance available`);
    }

    const kindOf = (s: PaymentShare) => s.method?.kind || s.payment.method_kind || 'CASH';

    // Checked before any refund row exists, so the drawer is known to be open when the cash
    // goes back out of it.
    const drawer = legs.some((s) => kindOf(s) === 'CASH')
      ? await this.shiftService.requireDrawer(tenantId, order.branch_id, order.terminal_id)
      : null;
    // Money that does not come out of the drawer is still given at a register during its
    // shift: the shift's report lists it with the cash refunds, so the close shows every
    // refund the till made.
    const tillShift = drawer ?? (await this.shiftService.resolveDrawer(tenantId, order.branch_id, order.terminal_id));
    const businessDate = (await loadBusinessClock(em, tenantId, order.branch_id)).today();

    const refunds: Refund[] = [];
    let total = '0.0000';
    for (const share of legs) {
      const kind = kindOf(share);
      const refund = await em.save(
        Refund,
        em.create(Refund, {
          tenant_id: tenantId,
          order_id: order.id,
          refund_number: await this.generateRefundNumber(tenantId, em),
          status: 'SUCCEEDED',
          method_id: share.payment.method_id,
          method_kind: kind,
          amount: share.remaining,
          currency_code: order.currency_code || 'IRR',
          reason_code_id: input.reasonCodeId || null,
          reason_text: input.reason,
          approval_request_id: input.approvalRequestId || null,
          shift_id: tillShift?.id ?? null,
          // The business day the money goes back on, by the branch's cutoff.
          business_date: businessDate,
          posted_at: new Date(),
        }),
      );
      await em.save(
        RefundAllocation,
        em.create(RefundAllocation, {
          tenant_id: tenantId,
          refund_id: refund.id,
          payment_id: share.payment.id,
          payment_method_id: share.payment.method_id,
          original_payment_id: share.payment.id,
          amount: share.remaining,
          amount_refunded: share.remaining,
        }),
      );

      if (kind === 'CASH') {
        // Handed back from the drawer at the register doing the refund.
        await this.shiftService.recordCashRefundMovement(tenantId, drawer!.id, refund.id, refund.amount, ctx.userId, em);
      } else if (kind === 'CUSTOMER_CREDIT') {
        // The customer's credit was used for this sale: they get it back.
        await this.creditService.reversePurchase(
          tenantId,
          share.payment.id,
          `Refund #${refund.refund_number}`,
          ctx.userId,
          ctx.correlationId,
          em,
        );
      }

      await this.auditWriter.write({
        tenantId,
        actorType: ctx.userId ? 'ADMIN' : 'SYSTEM',
        actorId: ctx.userId,
        action: 'REFUND_SUCCEEDED',
        entityType: 'Refund',
        entityId: refund.id,
        correlationId: ctx.correlationId || 'system',
        afterData: refund,
        // Who released the money: the manager whose PIN was given, or the manager doing it.
        details: ctx.approvedBy ? { approvedBy: ctx.approvedBy } : undefined,
      });

      refunds.push(refund);
      total = MoneyUtil.add(total, refund.amount);
    }

    // The cashback comes back in proportion to what is refunded of the order.
    await this.creditService.reverseLoyaltyCashback(
      tenantId,
      order.id,
      total,
      order.total_amount,
      order.currency_code || 'IRR',
      em,
    );

    order.refunded_total = MoneyUtil.add(order.refunded_total, total);
    await em.save(OrderHeader, order);

    return refunds;
  }

  /**
   * Both ways in are gated before they get here: the order screen's cancel validates its
   * approval for this order, and the cancel route takes a manager or a manager's PIN. So the
   * refund this runs is released, whatever tender it goes back through.
   */
  async cancelPaidOrder(tenantId: string, orderId: string, dto: PaidOrderCancelDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const order = await em.findOne(OrderHeader, {
        where: { id: orderId, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException(`Order ${orderId} not found`);

      if (order.state === 'CANCELLED') {
        return order;
      }

      const shares = await this.paymentShares(tenantId, orderId, em);
      if (shares.some((s) => MoneyUtil.greaterThan(s.remaining, '0.0000'))) {
        // The money goes back in the same transaction as the cancellation.
        await this.payBack(
          tenantId,
          orderId,
          { reason: dto.reason, reasonCodeId: dto.reasonCodeId, approvalRequestId: dto.approvalRequestId },
          { userId, correlationId },
          em,
          true,
        );
      }

      // payBack raised refunded_total on its own instance of this row.
      // Saving the copy loaded before that call would write the pre-refund value
      // back over it, leaving a refunded order still reading as fully paid.
      const current = (await em.findOne(OrderHeader, { where: { id: orderId, tenant_id: tenantId } })) || order;

      const fromState = current.state;
      current.state = 'CANCELLED';
      current.status = 'CANCELLED';
      current.cancelled_at = new Date();
      current.cancellation_reason_code_id = dto.reasonCodeId || null;
      const savedOrder = await em.save(OrderHeader, current);

      // The order timeline is built from OrderStateEvent. Mutating state without one
      // leaves the history screen showing a completed order that is somehow cancelled,
      // with nothing recording who did it or why.
      await em.save(
        OrderStateEvent,
        em.create(OrderStateEvent, {
          tenant_id: tenantId,
          order_id: order.id,
          from_state: fromState,
          to_state: 'CANCELLED',
          action: 'CANCEL_PAID_ORDER',
          reason_code_id: dto.reasonCodeId || null,
          reason_text: dto.reason || null,
          approval_request_id: dto.approvalRequestId || null,
          occurred_by: userId || null,
        }),
      );

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'ORDER_CANCELLED',
        entityType: 'OrderHeader',
        entityId: order.id,
        correlationId: correlationId || 'system',
        afterData: savedOrder,
      });

      return savedOrder;
    });
  }
}
