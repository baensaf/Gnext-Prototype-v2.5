import { EntityManager } from 'typeorm';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { BusinessDateUtil } from '../../common/utils/business-date.util';

/**
 * What counts as an order left open, and why it cannot simply be closed off. Shared by the
 * business day close, which settles the whole branch, and the shift close, which only looks at
 * the orders its own till rang up.
 */

/** Order states that are still open: anything not completed, cancelled or rejected. */
export const OPEN_ORDER_STATES = ['DRAFT', 'PENDING_ACCEPTANCE', 'SUBMITTED', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'];

/** Where an order has finished; rows written straight to the table may say so only in `status`. */
export const FINISHED_ORDER_STATES = ['COMPLETED', 'CANCELLED', 'REJECTED'];

/** Open states a paid order is simply completed from when its day closes. */
const COMPLETABLE_AT_DAY_CLOSE = ['SUBMITTED', 'CONFIRMED', 'PREPARING', 'READY'];

/** Why an open order cannot just be completed when the day closes. */
export type OpenOrderIssue = 'UNPAID' | 'NOT_SUBMITTED' | 'AWAITING_ACCEPTANCE' | 'DELIVERY_NOT_FINISHED';

export interface DayCloseOpenOrder {
  id: string;
  orderNumber: string;
  orderType: string;
  channel: string;
  state: string;
  businessDate: string | null;
  placedAt: Date;
  tableNumber: string | null;
  grandTotal: string;
  outstandingTotal: string;
  issue?: OpenOrderIssue;
}

/**
 * Open orders with a delivery still waiting for, or out with, a courier. Any kind of order can
 * have one: a Snappfood order our own couriers take, or one changed to a delivery after it was
 * sent. Completing it here would close the ride with nobody paid for it.
 */
export async function ordersAwaitingCourier(em: EntityManager, tenantId: string, orders: OrderHeader[]): Promise<Set<string>> {
  if (orders.length === 0) return new Set();
  const rows: Array<{ order_id: string }> = await em.query(
    `SELECT order_id FROM delivery
      WHERE tenant_id = $1 AND order_id = ANY($2::uuid[]) AND state NOT IN ('DELIVERED', 'CANCELLED')`,
    [tenantId, orders.map((o) => o.id)],
  );
  return new Set(rows.map((r) => r.order_id));
}

export function openOrderIssue(order: OrderHeader, awaitingCourier = false): OpenOrderIssue | null {
  if (order.state === 'DRAFT') return 'NOT_SUBMITTED';
  if (order.state === 'PENDING_ACCEPTANCE') return 'AWAITING_ACCEPTANCE';
  if (MoneyUtil.greaterThan(order.outstanding_total || '0.0000', '0.0000')) return 'UNPAID';
  // A delivery is finished by its courier, whose cash and settlement hang off that step.
  if (order.order_type === 'DELIVERY' || order.state === 'OUT_FOR_DELIVERY' || awaitingCourier) return 'DELIVERY_NOT_FINISHED';
  if (!COMPLETABLE_AT_DAY_CLOSE.includes(order.state)) return 'DELIVERY_NOT_FINISHED';
  return null;
}

export function openOrderView(order: OrderHeader, issue?: OpenOrderIssue): DayCloseOpenOrder {
  return {
    id: order.id,
    orderNumber: order.order_number,
    orderType: order.order_type,
    channel: order.channel,
    state: order.state,
    businessDate: order.business_date || BusinessDateUtil.fromDate(order.placed_at),
    placedAt: order.placed_at,
    tableNumber: order.table_number || null,
    grandTotal: order.grand_total,
    outstandingTotal: order.outstanding_total,
    ...(issue ? { issue } : {}),
  };
}
