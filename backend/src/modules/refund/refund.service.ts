import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { Refund, RefundStatus } from '../../entities/Refund.entity';
import { RefundAllocation } from '../../entities/RefundAllocation.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { OrderStateEvent } from '../../entities/OrderStateEvent.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { ShiftService } from '../cashier/shift.service';
import { CreditService } from '../customer/credit.service';
import { AuditWriter } from '../audit/audit-writer.service';
import {
  RefundCreateDto,
  RefundProcessDto,
  PaidOrderCancelDto,
  RefundReversalDto,
} from './dtos/refund.dto';

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
  ) {}

  private async generateRefundNumber(tenantId: string, em: EntityManager): Promise<string> {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
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

  async getRefunds(tenantId: string, query: any) {
    const qb = this.refundRepo.createQueryBuilder('r').where('r.tenant_id = :tenantId', { tenantId });
    if (query.orderId) qb.andWhere('r.order_id = :orderId', { orderId: query.orderId });
    if (query.status) qb.andWhere('r.status = :status', { status: query.status });

    qb.orderBy('r.initiated_at', 'DESC');
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '50', 10);
    qb.skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();
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

      let requestedAmount = dto.full ? refundableBalance : MoneyUtil.format(dto.amount || '0.0000');
      if (MoneyUtil.lessThanOrEqual(requestedAmount, '0.0000')) {
        throw new BadRequestException('Refund amount must be greater than zero');
      }

      if (MoneyUtil.greaterThan(requestedAmount, refundableBalance)) {
        throw new BadRequestException(
          `Refund amount (${requestedAmount}) exceeds remaining refundable balance (${refundableBalance})`,
        );
      }

      // Succeeded payments allocation
      const payments = await em.find(Payment, {
        where: [
          { tenant_id: tenantId, order_id: orderId, status: 'SUCCEEDED' },
          { tenant_id: tenantId, order_id: orderId, status: 'COMPLETED' as any },
        ],
        order: { initiated_at: 'ASC' },
      });
      if (!payments || payments.length === 0) {
        throw new BadRequestException(`No succeeded payments found on order ${orderId} to refund`);
      }

      const primaryPayment = payments[0];
      let targetMethodId = dto.targetMethodId || primaryPayment.method_id;
      let targetMethod = await em.findOne(PaymentMethod, {
        where: { id: targetMethodId, tenant_id: tenantId },
      });
      if (!targetMethod || !targetMethod.is_active) {
        throw new BadRequestException(`Target payment method ${targetMethodId} is invalid or disabled`);
      }

      const isAlternative = targetMethod.id !== primaryPayment.method_id;
      if (isAlternative) {
        if (!dto.approvalRequestId) {
          throw new ForbiddenException('Alternative tender refund requires an approved approvalRequestId');
        }
        if (targetMethod.kind === 'BANK_TRANSFER' && !dto.reference) {
          throw new BadRequestException('Bank transfer refund requires a reference number');
        }
        if (targetMethod.kind === 'CASH') {
          // Checked before the refund row exists, so the till is known to be open by the
          // time there is anything to settle.
          await this.shiftService.requireDrawer(tenantId, order.branch_id, order.terminal_id);
        }
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
      });

      const savedRefund = await em.save(Refund, refund);

      // Create allocations across payments FIFO
      let remainingToAllocate = requestedAmount;
      for (const p of payments) {
        if (MoneyUtil.lessThanOrEqual(remainingToAllocate, '0.0000')) break;

        const allocAmount = MoneyUtil.greaterThan(remainingToAllocate, p.amount) ? p.amount : remainingToAllocate;
        const alloc = em.create(RefundAllocation, {
          tenant_id: tenantId,
          refund_id: savedRefund.id,
          refund_request_id: savedRefund.id,
          payment_id: p.id,
          payment_method_id: p.method_id,
          original_payment_id: p.id,
          amount: allocAmount,
          amount_refunded: allocAmount,
        });
        await em.save(RefundAllocation, alloc);
        remainingToAllocate = MoneyUtil.subtract(remainingToAllocate, allocAmount);
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
    dto: RefundProcessDto = {},
    userId?: string,
    correlationId?: string,
    externalEm?: EntityManager,
  ) {
    const runInEm = async (em: EntityManager) => {
      const refund = await em.findOne(Refund, {
        where: { id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!refund) throw new NotFoundException(`Refund ${id} not found`);

      const allocations = await em.find(RefundAllocation, {
        where: { refund_id: id, tenant_id: tenantId },
      });
      refund.allocations = allocations;

      if (refund.status === 'SUCCEEDED') return refund; // Idempotent success

      if (refund.status !== 'PENDING' && refund.status !== 'PROCESSING' && refund.status !== 'FAILED') {
        throw new BadRequestException(`Refund ${id} is in status ${refund.status} and cannot be processed`);
      }

      refund.status = 'PROCESSING';
      await em.save(Refund, refund);

      const order = await em.findOne(OrderHeader, {
        where: { id: refund.order_id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException(`Order ${refund.order_id} not found`);

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
        const acc = await this.creditService.getAccountByCustomer(tenantId, order.customer_id, refund.currency_code, em);
        if (!acc) throw new NotFoundException(`No credit account found for customer ${order.customer_id}`);

        // Post positive refund entry to customer credit subledger within active transaction
        await this.creditService.postRepayment(
          tenantId,
          acc.id,
          { amount: refund.amount, reason: `Refund #${refund.refund_number}` },
          userId,
          correlationId,
          em,
        );
        refund.status = 'SUCCEEDED';
      } else {
        // External simulated method adapter
        const scenario = dto.scenarioId || 'SUCCESS';
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

        if (dto.externalReference) refund.reference = dto.externalReference;
        refund.status = 'SUCCEEDED';
      }

      if (refund.status === 'SUCCEEDED') {
        await this.creditService.reverseLoyaltyCashback(
          tenantId,
          order.id,
          refund.amount,
          userId,
          correlationId,
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
        });

        return savedRefund;
      }

      return await em.save(Refund, refund);
    };

    if (externalEm) {
      return await runInEm(externalEm);
    }
    return await this.dataSource.transaction(runInEm);
  }

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

  async reverseRefund(tenantId: string, id: string, dto: RefundReversalDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const refund = await em.findOne(Refund, {
        where: { id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!refund) throw new NotFoundException(`Refund ${id} not found`);

      if (refund.status !== 'SUCCEEDED') {
        throw new BadRequestException(`Only SUCCEEDED refunds can be reversed. Current status: ${refund.status}`);
      }

      if (!dto.approvalRequestId) {
        throw new ForbiddenException('Refund reversal requires an approved approvalRequestId');
      }

      refund.status = 'REVERSED';
      await em.save(Refund, refund);

      const order = await em.findOne(OrderHeader, {
        where: { id: refund.order_id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (order) {
        order.refunded_total = MoneyUtil.subtract(order.refunded_total, refund.amount);
        if (MoneyUtil.lessThan(order.refunded_total, '0.0000')) order.refunded_total = '0.0000';
        await em.save(OrderHeader, order);
      }

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'REFUND_REVERSED',
        entityType: 'Refund',
        entityId: id,
        correlationId: correlationId || 'system',
      });

      return refund;
    });
  }
}
