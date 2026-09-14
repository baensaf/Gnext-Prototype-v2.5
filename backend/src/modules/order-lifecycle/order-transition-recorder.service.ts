import { Injectable, Optional } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderStateEvent } from '../../entities/OrderStateEvent.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { OutboxWriter } from '../outbox/outbox-writer.service';
import { CreditService } from '../customer/credit.service';
import { MoneyUtil } from '../../common/utils/money.util';
import { pickSettingValue } from '../../common/utils/setting-scope.util';

export interface OrderTransitionRecord {
  tenantId: string;
  /** Already carrying its new state, and saved through the same EntityManager. */
  order: OrderHeader;
  fromState: string | null;
  /** The order action that caused the change, e.g. COMPLETE or START_PREPARATION. */
  action: string;
  userId?: string;
  correlationId?: string;
  reasonCodeId?: string | null;
  reasonText?: string | null;
  approvalRequestId?: string | null;
}

/**
 * Everything an order state change leaves behind besides the new state on the header: the
 * state history row, the outbox event the branch sync replays, the audit entry and, when the
 * order completes, the customer-club cashback.
 *
 * Orders move through the order service, but also as a side effect of other work: a table
 * is released, a courier delivers, the kitchen starts or bumps a ticket. All of them record
 * the move here so none can skip a step. Call it inside the transaction that saved the order.
 */
@Injectable()
export class OrderTransitionRecorder {
  constructor(
    private readonly auditWriter: AuditWriter,
    private readonly outboxWriter: OutboxWriter,
    @Optional() private readonly creditService?: CreditService,
  ) {}

  async record(em: EntityManager, input: OrderTransitionRecord): Promise<void> {
    const { tenantId, order, fromState, action, userId, correlationId } = input;
    const toState = order.state;

    if (toState === 'COMPLETED') {
      await this.awardCashback(em, tenantId, order);
    }

    const stateEvt = em.create(OrderStateEvent, {
      tenant_id: tenantId,
      order_id: order.id,
      from_state: fromState,
      to_state: toState,
      action,
      reason_code_id: input.reasonCodeId || null,
      reason_text: input.reasonText || null,
      approval_request_id: input.approvalRequestId || null,
      occurred_by: userId || null,
    });
    await em.save(OrderStateEvent, stateEvt);

    await this.outboxWriter.enqueueInTransaction(em, {
      tenantId,
      eventType: toState === 'CANCELLED' ? 'ORDER_CANCELLED' : toState === 'REJECTED' ? 'ORDER_REJECTED' : 'ORDER_UPDATED',
      aggregateType: 'Order',
      aggregateId: order.id,
      payload: {
        orderId: order.id,
        orderNumber: order.order_number,
        fromState,
        toState,
        action,
      },
    });

    await this.auditWriter.write({
      tenantId,
      actorType: userId ? 'ADMIN' : 'SYSTEM',
      actorId: userId,
      action: `ORDER_${action.toUpperCase()}`,
      entityType: 'Order',
      entityId: order.id,
      correlationId,
    });
  }

  private async awardCashback(em: EntityManager, tenantId: string, order: OrderHeader) {
    if (!order.customer_id || !this.creditService) return;

    const eligiblePaidSubtotal = MoneyUtil.subtract(order.subtotal, order.discount_total);
    if (!MoneyUtil.greaterThan(eligiblePaidSubtotal, '0.0000')) return;

    // Loyalty economics stay chain-wide: CUSTOMER_CLUB is not branch-overridable,
    // so this deliberately reads the organization row.
    const settingRows = await em.getRepository(TenantSetting).find({ where: { tenant_id: tenantId, key: 'CUSTOMER_CLUB' } });
    const cashbackPct = (pickSettingValue(settingRows) as any)?.cashback_percentage ?? '5.00';
    await this.creditService.awardLoyaltyCashback(
      tenantId,
      order.customer_id,
      order.id,
      eligiblePaidSubtotal,
      cashbackPct,
      order.currency_code || 'IRR',
      em,
    );
  }
}
