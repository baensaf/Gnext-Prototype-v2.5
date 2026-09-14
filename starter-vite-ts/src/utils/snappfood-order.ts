import type { OrderHeader } from 'src/api/orderApi';

// What Snappfood's annex (4.3.0) lets a store do with one of its orders. Snappfood owns the
// lines and the money; after accepting, the store can only hand the order to Snappfood
// support, within an hour. The server enforces all of this; these mirror it for the screens.

/** Longest delivery time Snappfood takes from a store that delivers the order itself. */
export const SNAPPFOOD_MAX_DELIVERY_MINUTES = 70;

/** How long after accepting a store may still report an order to Snappfood support. */
export const SNAPPFOOD_REPORT_WINDOW_MINUTES = 60;

/** Decline reason 153, a delay in sending the order: how a store asks for more time. */
export const SNAPPFOOD_DELAY_REASON_ID = 153;

/** States in which the kitchen still has an accepted order. */
const KITCHEN_STATES = ['SUBMITTED', 'CONFIRMED', 'PREPARING', 'READY'];

export const isSnappfoodOrder = (order: Pick<OrderHeader, 'channel'>) => order.channel === 'AGGREGATOR';

/** Own delivery promises a delivery time; a Snapp Express rider or a pickup, a ready time. */
export const promisesDeliveryTime = (order: OrderHeader) =>
  !order.aggregator_expedition || order.aggregator_expedition === 'DELIVERY';

/** The most minutes the store may promise when accepting this Snappfood order. */
export function maxPromiseMinutes(order: OrderHeader): number {
  if (promisesDeliveryTime(order) || order.aggregator_prep_minutes == null) {
    return SNAPPFOOD_MAX_DELIVERY_MINUTES;
  }
  return order.aggregator_prep_minutes + (order.aggregator_max_extra_minutes ?? 0);
}

/** Whole minutes left to report this order to Snappfood; 0 when it cannot be reported. */
export function reportMinutesLeft(order: OrderHeader, now: number): number {
  if (!isSnappfoodOrder(order) || !order.accepted_at || order.aggregator_issue_at) return 0;
  if (!KITCHEN_STATES.includes(order.state)) return 0;
  const endsAt = new Date(order.accepted_at).getTime() + SNAPPFOOD_REPORT_WINDOW_MINUTES * 60000;
  return Math.max(0, Math.ceil((endsAt - now) / 60000));
}

/** When the store promised the order, counted from its accept; null if nothing was promised. */
export function promisedBy(order: OrderHeader): Date | null {
  if (!order.accepted_at || !order.promised_minutes) return null;
  return new Date(new Date(order.accepted_at).getTime() + order.promised_minutes * 60000);
}
