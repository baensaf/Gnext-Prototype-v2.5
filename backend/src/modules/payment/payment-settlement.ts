import { EntityManager } from 'typeorm';
import { Payment } from '../../entities/Payment.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { PaymentAllocation } from '../../entities/PaymentAllocation.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { AuditWriter } from '../audit/audit-writer.service';

export interface PaymentActor {
  userId?: string | null;
  correlationId?: string | null;
  actorType?: 'ADMIN' | 'SYSTEM';
}

/**
 * Books a payment the money has arrived for: allocates it to the order, moves the order's
 * paid and outstanding totals, and records the audit entry. The caller holds both rows locked
 * inside `em`. Shared by the till's own capture and by a card terminal's approval that comes
 * back from the branch agent later.
 */
export async function bookSucceededPayment(
  em: EntityManager,
  auditWriter: AuditWriter,
  payment: Payment,
  order: OrderHeader,
  actor: PaymentActor,
): Promise<Payment> {
  payment.status = 'SUCCEEDED';
  payment.posted_at = new Date();
  payment.failure_code = null as any;
  payment.failure_message = null as any;

  await em.save(
    PaymentAllocation,
    em.create(PaymentAllocation, {
      tenant_id: payment.tenant_id,
      payment_id: payment.id,
      order_id: order.id,
      amount: payment.amount,
      currency_code: payment.currency_code,
    }),
  );

  order.paid_total = MoneyUtil.add(order.paid_total, payment.amount);
  let newOutstanding = MoneyUtil.subtract(order.grand_total, order.paid_total);
  if (MoneyUtil.lessThan(newOutstanding, '0.0000')) newOutstanding = '0.0000';
  order.outstanding_total = newOutstanding;
  order.paid_amount = order.paid_total;
  order.due_amount = order.outstanding_total;
  await em.save(OrderHeader, order);

  const savedPayment = await em.save(Payment, payment);

  await auditWriter.write({
    tenantId: payment.tenant_id,
    actorType: actor.actorType ?? (actor.userId ? 'ADMIN' : 'SYSTEM'),
    actorId: actor.userId ?? undefined,
    action: 'PAYMENT_SUCCEEDED',
    entityType: 'Payment',
    entityId: savedPayment.id,
    correlationId: actor.correlationId || 'system',
    afterData: savedPayment,
  });

  return savedPayment;
}
