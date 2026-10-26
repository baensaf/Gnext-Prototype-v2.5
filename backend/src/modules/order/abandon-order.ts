import { EntityManager } from 'typeorm';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderStateEvent } from '../../entities/OrderStateEvent.entity';

/**
 * Closes an order that went back to the cart and was never sent again (O-37): the cart was
 * discarded, or its shift ended with it still on the till or held. Not a sale and in no Orders
 * tab or report; its failed card attempts stay with it, so the Payments page still opens it.
 */
export async function abandonOrder(
  em: EntityManager,
  order: OrderHeader,
  occurredBy: string | null,
  action: 'DISCARD_CART' | 'SHIFT_ENDED',
): Promise<OrderHeader> {
  const fromState = order.state;
  order.state = 'ABANDONED';
  order.status = 'ABANDONED';
  const saved = await em.save(OrderHeader, order);
  await em.save(
    OrderStateEvent,
    em.create(OrderStateEvent, {
      tenant_id: order.tenant_id,
      order_id: order.id,
      from_state: fromState,
      to_state: 'ABANDONED',
      action,
      occurred_by: occurredBy,
    }),
  );
  return saved;
}
