import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BusinessDateUtil } from '../../common/utils/business-date.util';
import { loadBusinessClock } from '../../common/utils/business-clock';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { Refund } from '../../entities/Refund.entity';
import { RefundAllocation } from '../../entities/RefundAllocation.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { OrderStateEvent } from '../../entities/OrderStateEvent.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { CustomerCreditAccount } from '../../entities/CustomerCreditAccount.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { isAggregatorOrder } from '../../common/utils/snappfood-order.util';
import { ShiftService } from '../cashier/shift.service';
import { CreditService } from '../customer/credit.service';
import { AuditWriter } from '../audit/audit-writer.service';
import { ApprovalService } from '../approval/approval.service';
import { RefundCreateDto, RefundProcessOptions, PaidOrderCancelDto } from './dtos/refund.dto';

/** What is left to give back of one payment, and the method it was taken by. */
interface PaymentShare {
  payment: Payment;
  method: PaymentMethod | null;
  remaining: string;
}

@Injectable()
export class RefundService {
  constructor(
    @InjectRepository(Refund) private readonly refundRepo: Repository<Refund>,
    @InjectRepository(RefundAllocation) private readonly allocRepo: Repository<RefundAllocation>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(OrderItem) private readonly itemRepo: Repository<OrderItem>,
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentMethod) private readonly methodRepo: Repository<PaymentMethod>,
    private readonly shiftService: ShiftService,
    private readonly creditService: CreditService,
    private readonly auditWriter: AuditWriter,
    private readonly dataSource: DataSource,
    @Optional() private readonly approvalService?: ApprovalService,
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

  async calculateRefundableBalance(tenantId: string, orderId: string, em: EntityManager): Promise<string> {
    const payments = await em.find(Payment, {
      where: { tenant_id: tenantId, order_id: orderId },
    });

    let sumSucceededPayments = '0.0000';

    for (const p of payments) {
      if (p.status === 'SUCCEEDED' || (p.status as any) === 'COMPLETED') {
        sumSucceededPayments = MoneyUtil.add(sumSucceededPayments, p.amount);
      }
    }

    const refunds = await em.find(Refund, {
      where: { tenant_id: tenantId, order_id: orderId, status: 'SUCCEEDED' },
    });

    let sumSucceededRefunds = '0.0000';
    for (const r of refunds) {
      sumSucceededRefunds = MoneyUtil.add(sumSucceededRefunds, r.amount);
    }

    const refundable = MoneyUtil.subtract(sumSucceededPayments, sumSucceededRefunds);

    return MoneyUtil.greaterThan(refundable, '0.0000') ? refundable : '0.0000';
  }

  /**
   * Each payment on the order with what earlier refunds have not yet given back of it. A second
   * partial refund has to start where the first stopped, or it is checked against the policy of a
   * payment that is already paid back in full.
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
   * A refund from the register: created and settled in one transaction holding the order, so a
   * refusal anywhere (a closed drawer, a declined transfer) leaves nothing behind, and a second
   * refund of the same order waits for the first and then sees what it gave back.
   */
  async refundOrder(
    tenantId: string,
    orderId: string,
    dto: RefundCreateDto,
    ctx: { userId?: string; correlationId?: string; approvedBy?: string | null } = {},
  ) {
    return await this.dataSource.transaction(async (em) => {
      const intent = await this.createRefundIntent(
        tenantId,
        orderId,
        { ...dto, moneyOutAuthorized: true },
        ctx.userId,
        ctx.correlationId,
        false,
        em,
      );
      const done = await this.processRefund(
        tenantId,
        intent.id,
        { scenarioId: dto.scenarioId, approvedBy: ctx.approvedBy ?? ctx.userId ?? null },
        ctx.userId,
        ctx.correlationId,
        em,
      );
      if (done.status !== 'SUCCEEDED') {
        throw new ConflictException({
          code: 'REFUND_DECLINED',
          message: `Refund ${done.refund_number} was declined (${done.failure_code || done.status}); nothing was paid back`,
        });
      }
      return done;
    });
  }

  async createRefundIntent(
    tenantId: string,
    orderId: string,
    dto: RefundCreateDto,
    userId?: string,
    correlationId?: string,
    isCancellationOrchestration: boolean = false,
    externalEm?: EntityManager,
  ) {
    const runInEm = async (em: EntityManager) => {
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

      // Ordinary refund rule: order must be COMPLETED unless cancellation orchestration
      if (!isCancellationOrchestration && order.state !== 'COMPLETED') {
        throw new BadRequestException(
          `Ordinary refunds are permitted only on COMPLETED orders. Current state: ${order.state}. To undo partial payments on open orders, use payment reversal/correction.`,
        );
      }

      if (!dto.reason) {
        throw new BadRequestException('Refund requires a mandatory reason');
      }

      const refundableBalance = await this.calculateRefundableBalance(tenantId, orderId, em);
      if (MoneyUtil.isZero(refundableBalance)) {
        throw new BadRequestException(`Order ${orderId} has no refundable balance available`);
      }

      const requestedAmount = dto.full ? refundableBalance : MoneyUtil.format(dto.amount || '0.0000');
      if (MoneyUtil.lessThanOrEqual(requestedAmount, '0.0000')) {
        throw new BadRequestException('Refund amount must be greater than zero');
      }

      if (MoneyUtil.greaterThan(requestedAmount, refundableBalance)) {
        throw new BadRequestException(
          `Refund amount (${requestedAmount}) exceeds remaining refundable balance (${refundableBalance})`,
        );
      }

      const shares = await this.paymentShares(tenantId, orderId, em);
      if (shares.length === 0) {
        throw new BadRequestException(`No succeeded payments found on order ${orderId} to refund`);
      }

      const targetMethodId = dto.targetMethodId || shares[0].payment.method_id;
      const targetMethod = await em.findOne(PaymentMethod, {
        where: { id: targetMethodId, tenant_id: tenantId },
      });
      if (!targetMethod || !targetMethod.is_active) {
        throw new BadRequestException(`Target payment method ${targetMethodId} is invalid or disabled`);
      }

      // Which payments the refund comes out of: those taken by the method it goes back through
      // first, then those whose method may be paid back another way, oldest first within each.
      const rank = (s: PaymentShare) =>
        s.payment.method_id === targetMethod.id ? 0 : s.method?.allows_alternative_refund === true ? 1 : 2;
      const ordered = shares
        .map((s, i) => ({ s, i }))
        .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
        .map(({ s }) => s);

      const legs: { share: PaymentShare; amount: string }[] = [];
      let toAllocate = requestedAmount;
      for (const share of ordered) {
        if (MoneyUtil.lessThanOrEqual(toAllocate, '0.0000')) break;
        if (MoneyUtil.lessThanOrEqual(share.remaining, '0.0000')) continue;
        const amount = MoneyUtil.greaterThan(toAllocate, share.remaining) ? share.remaining : toAllocate;
        legs.push({ share, amount });
        toAllocate = MoneyUtil.subtract(toAllocate, amount);
      }

      const isAlternative = legs.some((l) => l.share.payment.method_id !== targetMethod.id);
      if (isAlternative && !dto.moneyOutAuthorized) {
        // A card paid in Iran cannot be refunded on the terminal: it goes back in cash or by a
        // card-to-card transfer, released by the same PIN as the refund itself. Without that PIN,
        // only an approval given for this very order will do.
        if (!dto.approvalRequestId) {
          throw new ForbiddenException('Alternative tender refund requires an approved approvalRequestId');
        }
        if (!this.approvalService) {
          throw new ForbiddenException('Alternative tender refund cannot check its approval');
        }
        await this.approvalService.validateApprovedRequest(
          tenantId,
          dto.approvalRequestId,
          'REFUND_ALTERNATIVE_METHOD',
          undefined,
          order.id,
        );
      }

      // Head office's payment settings say which money may go back at all, and which may go
      // back another way than it came.
      for (const { share } of legs) {
        const name = share.method?.name || share.method?.kind || share.payment.method_id;
        if (share.payment.method_id === targetMethod.id) {
          if (share.method?.allows_refund === false) {
            throw new BadRequestException({
              code: 'REFUND_METHOD_NOT_ALLOWED',
              message: `${name} payments cannot be refunded. Settings › Payments & Refund Methods`,
            });
          }
        } else if (share.method?.allows_alternative_refund !== true) {
          throw new BadRequestException({
            code: 'REFUND_METHOD_NOT_ALLOWED',
            message: `${name} payments cannot be paid back as ${targetMethod.name || targetMethod.kind}. Settings › Payments & Refund Methods`,
          });
        }
      }

      if (targetMethod.kind === 'BANK_TRANSFER' && isAlternative && !dto.reference) {
        throw new BadRequestException('Bank transfer refund requires a reference number');
      }
      if (targetMethod.kind === 'CASH') {
        // Checked before the refund row exists, so the till is known to be open by the
        // time there is anything to settle.
        await this.shiftService.requireDrawer(tenantId, order.branch_id, order.terminal_id);
      }
      if (targetMethod.kind === 'CUSTOMER_CREDIT' && !order.customer_id) {
        throw new BadRequestException('Customer credit refund requires an assigned customer on the order');
      }

      const refundNumber = await this.generateRefundNumber(tenantId, em);

      const refund = em.create(Refund, {
        tenant_id: tenantId,
        order_id: order.id,
        refund_number: refundNumber,
        status: 'PENDING',
        method_id: targetMethod.id,
        method_kind: targetMethod.kind || 'CASH',
        amount: requestedAmount,
        currency_code: order.currency_code || 'IRR',
        reason_code_id: dto.reasonCodeId || null,
        reason_text: dto.reason,
        reference: dto.reference || null,
        is_alternative_method: isAlternative,
        approval_request_id: dto.approvalRequestId || null,
        device_id: dto.deviceId || null,
        shift_id: null,
        // The business day the money goes back on, by the branch's cutoff.
        business_date: (await loadBusinessClock(em, tenantId, order.branch_id)).today(),
      });

      const savedRefund = await em.save(Refund, refund);

      for (const { share, amount } of legs) {
        const alloc = em.create(RefundAllocation, {
          tenant_id: tenantId,
          refund_id: savedRefund.id,
          refund_request_id: savedRefund.id,
          payment_id: share.payment.id,
          payment_method_id: share.payment.method_id,
          original_payment_id: share.payment.id,
          amount,
          amount_refunded: amount,
        });
        await em.save(RefundAllocation, alloc);
      }

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'REFUND_INITIATED',
        entityType: 'Refund',
        entityId: savedRefund.id,
        correlationId: correlationId || 'system',
        afterData: savedRefund,
      });

      return savedRefund;
    };

    if (externalEm) {
      return await runInEm(externalEm);
    }
    return await this.dataSource.transaction(runInEm);
  }

  async processRefund(
    tenantId: string,
    id: string,
    options: RefundProcessOptions = {},
    userId?: string,
    correlationId?: string,
    externalEm?: EntityManager,
  ) {
    const runInEm = async (em: EntityManager) => {
      const found = await em.findOne(Refund, { where: { id, tenant_id: tenantId } });
      if (!found) throw new NotFoundException(`Refund ${id} not found`);

      // The order is locked before the refund, the same order creating a refund takes them in,
      // so two refunds of one order settle one after the other.
      const order = await em.findOne(OrderHeader, {
        where: { id: found.order_id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException(`Order ${found.order_id} not found`);

      const refund =
        (await em.findOne(Refund, {
          where: { id, tenant_id: tenantId },
          lock: { mode: 'pessimistic_write' },
        })) || found;

      const allocations = await em.find(RefundAllocation, {
        where: { refund_id: id, tenant_id: tenantId },
      });
      refund.allocations = allocations;

      if (refund.status === 'SUCCEEDED') return refund; // Idempotent success

      if (refund.status !== 'PENDING' && refund.status !== 'PROCESSING') {
        throw new BadRequestException(`Refund ${id} is in status ${refund.status} and cannot be processed`);
      }

      // What other refunds gave back since this one was made counts against it: a refund
      // made against the whole order is not paid out again once another has paid it.
      const refundable = await this.calculateRefundableBalance(tenantId, order.id, em);
      if (MoneyUtil.greaterThan(refund.amount, refundable)) {
        throw new ConflictException({
          code: 'REFUND_EXCEEDS_BALANCE',
          message: `Refund ${refund.refund_number} (${refund.amount}) exceeds what is left to give back on the order (${refundable})`,
        });
      }

      refund.status = 'PROCESSING';
      await em.save(Refund, refund);

      const methodKind = refund.method_kind;

      if (methodKind === 'CASH') {
        // Handed back from the drawer at the register doing the refund.
        const shift = await this.shiftService.requireDrawer(tenantId, order.branch_id, order.terminal_id);
        refund.shift_id = shift.id;
        await this.shiftService.recordCashRefundMovement(tenantId, shift.id, refund.id, refund.amount, userId, em);
        refund.status = 'SUCCEEDED';
      } else if (methodKind === 'CUSTOMER_CREDIT') {
        if (!order.customer_id) {
          throw new BadRequestException('Customer credit refund requires an assigned customer on the order');
        }
        const acc =
          (await this.creditService.getAccountByCustomer(tenantId, order.customer_id, refund.currency_code, em)) ||
          // A customer with no account yet gets one to hold the refund, with no credit to buy on.
          (await em.save(
            CustomerCreditAccount,
            em.create(CustomerCreditAccount, {
              tenant_id: tenantId,
              customer_id: order.customer_id,
              currency_code: refund.currency_code,
              mode: 'FINITE',
              credit_limit: '0.0000',
              current_balance: '0.0000',
              status: 'ACTIVE',
            }),
          ));

        // Post positive refund entry to customer credit subledger within active transaction.
        // The refund's own release covers a balance that ends up in the customer's favour.
        await this.creditService.postRepayment(
          tenantId,
          acc.id,
          { amount: refund.amount, reason: `Refund #${refund.refund_number}`, preApproved: true },
          userId,
          correlationId,
          em,
        );
        // Not from the drawer, but given at a register during its shift, so its report lists it.
        const drawer = await this.shiftService.resolveDrawer(tenantId, order.branch_id, order.terminal_id);
        refund.shift_id = drawer?.id ?? null;
        refund.status = 'SUCCEEDED';
      } else {
        // Not from the drawer, but given back at a register during its shift: the shift's report
        // lists it with the cash refunds, so the close shows every refund the till made.
        const drawer = await this.shiftService.resolveDrawer(tenantId, order.branch_id, order.terminal_id);
        refund.shift_id = drawer?.id ?? null;

        // External simulated method adapter
        const scenario = options.scenarioId || 'SUCCESS';
        if (scenario === 'FAIL' || scenario === 'DECLINED') {
          refund.status = 'FAILED';
          refund.failure_code = scenario;
          refund.failure_message = `Refund processing failed with scenario ${scenario}`;

          const savedFailed = await em.save(Refund, refund);

          await this.auditWriter.write({
            tenantId,
            actorType: userId ? 'ADMIN' : 'SYSTEM',
            actorId: userId,
            action: 'REFUND_FAILED',
            entityType: 'Refund',
            entityId: refund.id,
            correlationId: correlationId || 'system',
          });

          return savedFailed;
        }

        if (options.externalReference) refund.reference = options.externalReference;
        refund.status = 'SUCCEEDED';
      }

      // The cashback comes back in proportion to what is refunded of the order. The call
      // used to pass the user id and correlation id where the order total and currency go,
      // so refunding any order that had earned cashback failed with a DecimalError.
      await this.creditService.reverseLoyaltyCashback(
        tenantId,
        order.id,
        refund.amount,
        order.total_amount,
        order.currency_code || 'IRR',
        em,
      );

      // Update Order refunded_total
      order.refunded_total = MoneyUtil.add(order.refunded_total, refund.amount);
      await em.save(OrderHeader, order);

      refund.posted_at = new Date();
      const savedRefund = await em.save(Refund, refund);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'REFUND_SUCCEEDED',
        entityType: 'Refund',
        entityId: savedRefund.id,
        correlationId: correlationId || 'system',
        afterData: savedRefund,
        // Who released the money: the manager whose PIN was given, or the manager doing it.
        details: options.approvedBy ? { approvedBy: options.approvedBy } : undefined,
      });

      return savedRefund;
    };

    if (externalEm) {
      return await runInEm(externalEm);
    }
    return await this.dataSource.transaction(runInEm);
  }

  /**
   * Both ways in are gated before they get here: the order screen's cancel validates its
   * approval for this order, and the refunds route takes a manager or a manager's PIN. So the
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

      const refundable = await this.calculateRefundableBalance(tenantId, orderId, em);

      if (MoneyUtil.greaterThan(refundable, '0.0000')) {
        // Create and process refund intent as part of cancellation orchestration inside current transaction
        const refundIntent = await this.createRefundIntent(
          tenantId,
          orderId,
          {
            amount: refundable,
            reason: dto.reason,
            reasonCodeId: dto.reasonCodeId,
            targetMethodId: dto.targetMethodId,
            approvalRequestId: dto.approvalRequestId,
            reference: dto.reference,
            moneyOutAuthorized: true,
          },
          userId,
          correlationId,
          true, // isCancellationOrchestration
          em,
        );

        const processedRefund = await this.processRefund(tenantId, refundIntent.id, {}, userId, correlationId, em);
        if (processedRefund.status !== 'SUCCEEDED') {
          throw new BadRequestException(
            `Paid order cancellation failed because refund ${processedRefund.refund_number} could not be processed (${processedRefund.status})`,
          );
        }
      }

      // processRefund raised refunded_total on its own instance of this row.
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
