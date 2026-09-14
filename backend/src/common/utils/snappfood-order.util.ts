import { OrderHeader } from '../../entities/OrderHeader.entity';

/**
 * What Snappfood's annex (4.3.0) lets a store do with one of its orders. Snappfood owns the
 * lines and the money, so after accepting, the only thing a store can send back is a reject
 * ("needs a call"), and only within an hour. Support then cancels the order (54) or sends it
 * back (56), and the store accepts it again with a new time.
 */

/** Longest delivery time Snappfood takes from a store that delivers the order itself. */
export const SNAPPFOOD_MAX_DELIVERY_MINUTES = 70;

/** How long after accepting a store may still hand the order to Snappfood support. */
export const SNAPPFOOD_REPORT_WINDOW_MINUTES = 60;

/** Decline reason 153, a delay in sending the order: how a store asks for more time. */
export const SNAPPFOOD_DELAY_REASON_ID = 153;

type TimedOrder = Pick<OrderHeader, 'aggregator_expedition' | 'aggregator_prep_minutes' | 'aggregator_max_extra_minutes'>;

export function isAggregatorOrder(order: Pick<OrderHeader, 'channel'>): boolean {
  return order.channel === 'AGGREGATOR';
}

/**
 * The store's own courier (DELIVERY) promises a delivery time. Every other way the order
 * travels, a Snapp Express rider or the customer collects it, so the store promises when it
 * is ready. An order from before the expedition type was kept is treated as own delivery.
 */
export function promisesDeliveryTime(order: TimedOrder): boolean {
  return !order.aggregator_expedition || order.aggregator_expedition === 'DELIVERY';
}

/**
 * The most minutes a store may promise when accepting. Own delivery is capped at 70. A rider
 * pickup is capped at Snappfood's preparation time plus the minutes it lets this vendor add
 * (vendorMaxPreparationTime).
 */
export function maxPromiseMinutes(order: TimedOrder): number {
  if (promisesDeliveryTime(order) || order.aggregator_prep_minutes == null) {
    return SNAPPFOOD_MAX_DELIVERY_MINUTES;
  }
  return order.aggregator_prep_minutes + (order.aggregator_max_extra_minutes ?? 0);
}

/** The body of Snappfood's accept call: deliveryTime for own delivery, riderPickupTime otherwise. */
export function acceptNotice(order: TimedOrder, minutes: number): Record<string, number> {
  return promisesDeliveryTime(order) ? { deliveryTime: minutes } : { riderPickupTime: minutes };
}

/** When Snappfood stops taking a reject for an accepted order; null if it was never accepted. */
export function reportWindowEndsAt(order: Pick<OrderHeader, 'accepted_at'>): Date | null {
  if (!order.accepted_at) return null;
  return new Date(new Date(order.accepted_at).getTime() + SNAPPFOOD_REPORT_WINDOW_MINUTES * 60000);
}
