/**
 * Which Phase 1 version ships each page and feature of the prototype.
 *
 * The product manager decides these page by page; the source of truth is the "Feature labels"
 * tab of the Phase 1 decision register. This file mirrors it so that anyone exploring the
 * prototype sees what belongs to which version. A page or feature missing here has not been
 * labelled yet, and shows nothing.
 *
 * A feature with no label of its own ships with its page. Only the features that ship later
 * than their page get an entry in FEATURE_LABELS.
 */

/** V1–V4 are the four Phase 1 versions; F is after Phase 1. */
export type PhaseLabel = 'V1' | 'V2' | 'V3' | 'V4' | 'F';

export const PHASE_LABELS: PhaseLabel[] = ['V1', 'V2', 'V3', 'V4', 'F'];

/** The version a page first ships in, by path prefix. The longest matching prefix wins. */
const PAGE_LABELS: Record<string, PhaseLabel> = {
  '/app/pos': 'V1',
  '/app/orders': 'V1',
  // V2 only sets up sections and tables; the POS assigns a table to an order.
  '/app/dine-in': 'V2',
  // Only Snappfood (and later the website) sends orders that wait to be accepted.
  '/app/orders/incoming': 'V3',
  // No restaurant in Iran runs a kitchen screen; tickets are printed.
  '/app/kds': 'F',
  // Shifts, their statements and business days
  '/app/cashier': 'V1',
  // Head office's view of every branch's drawers
  '/app/cashier/rollup': 'V4',
  // In V1 money goes back only by cancelling a paid order from the Orders page.
  '/app/refunds': 'V2',
  '/app/payments': 'V1',
  '/app/operations/card-terminals': 'V1',
  // Full delivery is V1; head office's fleet roll-up is not.
  '/app/delivery': 'V1',
  '/app/delivery/rollup': 'V4',
  '/app/moadian': 'F',
};

/** Features that ship later than the page they sit on. */
export const FEATURE_LABELS = {
  // POS register
  'pos.stop.reason': 'F',
  'pos.stop.duration': 'F',
  'pos.stop.approverPin': 'F',
  'pos.tableAssignment': 'V2',
  'pos.coupon': 'V3',
  'pos.customerCredit': 'V3',
  'pos.offlineTill': 'F',
  // Orders list and the order drawer
  'orders.snappfood': 'V3',
  'orders.table': 'V2',
  'orders.kitchenProgress': 'F',
  'orders.takenOffline': 'F',
  'orders.headOfficeView': 'V4',
  'orders.auditSnapshot': 'F',
  // Dine-in floor: running service from the floor (occupancy, seating, move, merge, split,
  // guest bill, pay, release) comes after Phase 1.
  'dineIn.liveFloor': 'F',
  // Shifts: in V1 the cashier enters the counted cash and closes the shift, nothing more.
  'shift.safeDrop': 'V4',
  'shift.blindCount': 'V4',
  'shift.differenceSignoff': 'V4',
  'shift.openOrdersPin': 'V4',
  // Business days
  'businessDay.reopen': 'V2',
  'businessDay.dateReview': 'F',
  // Card terminals and the bank accounts they settle into
  'payments.onlineGateway': 'F',
  'payments.bankTransfer': 'V4',
  'payments.settlementAccounts': 'V4',
  // Delivery. V1 couriers belong to one branch and are paid the zone's delivery fee.
  'delivery.payModes': 'V4',
  'delivery.availability': 'V4',
  'delivery.moveCourier': 'V4',
  'delivery.courierDetail': 'V4',
  'delivery.settlementReview': 'V4',
  'delivery.settlementReverse': 'V2',
  'delivery.audit': 'F',
  // Kitchen screen settings; the stations and routing rules also drive the printers.
  'kds.screens': 'F',
  'kds.targetMinutes': 'F',
  // Moadian e-invoices on an order
  moadian: 'F',
} satisfies Record<string, PhaseLabel>;

export type LabelledFeature = keyof typeof FEATURE_LABELS;

export function pageLabel(pathname: string): PhaseLabel | undefined {
  let best: string | undefined;
  for (const prefix of Object.keys(PAGE_LABELS)) {
    const matches = pathname === prefix || pathname.startsWith(`${prefix}/`);
    if (matches && (!best || prefix.length > best.length)) best = prefix;
  }
  return best ? PAGE_LABELS[best] : undefined;
}
