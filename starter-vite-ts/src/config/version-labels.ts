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
  // Today's sales, open orders and open shifts: V1's one basic report
  '/app/dashboard': 'V1',
  // Prototype tools: the Snappfood simulator, payment and printer mocks, integration logs
  '/app/simulation': 'F',
  '/app/pos': 'V1',
  '/app/orders': 'V1',
  // Only Snappfood (and later the website) sends orders that wait to be accepted.
  '/app/orders/incoming': 'V3',
  // Shifts, their statements and business days
  '/app/cashier': 'V1',
  // Head office's view of every branch's drawers
  '/app/cashier/rollup': 'V4',
  // In V1 money goes back only by cancelling a paid order from the Orders page.
  '/app/refunds': 'V2',
  '/app/payments': 'V1',
  '/app/operations/card-terminals': 'V1',
  // Branches, tills, kitchen stations and routing, printers, the print queue, branch agents
  '/app/operations': 'V1',
  // Chain-wide health and alerts for head office
  '/app/operations/monitoring': 'V4',
  '/app/kiosk': 'V3',
  // V1's one very basic report is the dashboard; the reports page comes in V2.
  '/app/reports': 'V2',
  // Settings: users, roles, general, calendar, business day, shift policy, order workflow,
  // discount limits, payment methods, reason codes, note templates
  '/app/settings': 'V1',
  '/app/settings/approvals': 'V2',
  '/app/settings/branch-overrides': 'V4',
  '/app/settings/localization': 'F',
  '/app/settings/data-reset': 'F',
  // Full delivery is V1; head office's fleet roll-up is not.
  '/app/delivery': 'V1',
  '/app/delivery/rollup': 'V4',
  // Categories, products with sizes, add-on groups and combos, availability, today's stock
  // and the product and category import
  '/app/catalog': 'V1',
  '/app/catalog/availability/report': 'V4',
  // A V1 branch sells at base prices; price lists are chain-scale pricing.
  '/app/pricing/price-lists': 'V4',
  // Raising or lowering base prices now, by percent or amount
  '/app/pricing/changes': 'V1',
  // A dated percent off an item, taken off till lines by itself (HAMI's item discounts)
  '/app/pricing/item-discounts': 'V1',
  '/app/pricing/snappfood': 'V3',
  // Registering and finding customers, with their addresses
  '/app/customers': 'V1',
  // A customer's profile page (`*` is one path segment: the customer's id)
  '/app/customers/*': 'V4',
  '/app/credit': 'V3',
  // Customer-specific rates and the wallet belong to the customer club.
  '/app/discounts': 'V4',
  '/app/discounts/coupons': 'V3',
};

/** Features that ship later than the page they sit on. */
export const FEATURE_LABELS = {
  // POS register
  'pos.coupon': 'V3',
  'pos.customerCredit': 'V3',
  // Delivery platforms (Snappfood) come with the incoming orders, in V3.
  'pos.onlineTab': 'V3',
  // The pay panel saying a delivery order's remainder goes with the courier
  'pos.pay.courierCollects': 'V3',
  // Orders list and the order drawer
  'orders.snappfood': 'V3',
  'orders.headOfficeView': 'V4',
  // Shifts: in V1 the cashier enters the counted cash and closes the shift, nothing more.
  'shift.safeDrop': 'V4',
  'shift.blindCount': 'V4',
  'shift.differenceSignoff': 'V4',
  'shift.openOrdersPin': 'V4',
  // Business days
  'businessDay.reopen': 'V2',
  // Card terminals and the bank accounts they settle into
  'payments.onlineGateway': 'F',
  'payments.bankTransfer': 'V4',
  'payments.settlementAccounts': 'V4',
  // Delivery. Couriers belong to one branch and are on a salary: a trip pays them nothing.
  'delivery.availability': 'V4',
  'delivery.moveCourier': 'V4',
  'delivery.courierDetail': 'V4',
  // V1 dispatch: assign and send out, then settle on return. Everything else waits.
  'delivery.failRide': 'V4',
  'delivery.swapRider': 'V4',
  'delivery.checkIn': 'V4',
  'delivery.mobilePos': 'V4',
  'delivery.settlementReview': 'V4',
  'delivery.settlementReverse': 'V2',
  // Catalog. Sizes, add-on groups, combos and the packaging price are V1 (2026-10-04).
  'catalog.maxPerOrder': 'V4',
  'catalog.priceHistory': 'V4',
  // Availability: a V1 item is available, or off until someone puts it back.
  'catalog.snappfoodStop': 'V3',
  // V1 stops are "until further notice" only: off until the next shift and off for set hours are F.
  'catalog.stopBranches': 'V4',
  'catalog.sellingWindows': 'V2',
  'import.customers': 'F',
  // Price changes: V1 changes base prices now.
  'pricing.scheduled': 'V4',
  'pricing.listPrices': 'V4',
  'pricing.addonPrices': 'V4',
  // Customers and credit
  'customers.block': 'F',
  'customers.credit': 'V3',
  'credit.aging': 'V4',
  'coupons.testBench': 'F',
  // Operations
  'branches.nonSellingTypes': 'F',
  'terminals.kiosk': 'V3',
  'printers.serial': 'F',
  'printers.simulated': 'F',
  'printers.label': 'F',
  'printers.fallback': 'F',
  'printQueue.simulate': 'F',
  // Reports
  'reports.savedViews': 'V4',
  // Settings. Money is shown in Toman in V1; the Omani rial and the US dollar come in V7.
  'settings.currencies': 'F',
  'settings.reopenOrders': 'V2',
  'settings.incomingOrders': 'V3',
  'settings.refundMethods': 'V2',
  // Kiosk (V3): sizes and add-ons ship with the kiosk.
  'kiosk.simulatedTerminal': 'F',
  // Dashboard: head office's view across branches
  'dashboard.branchHealth': 'V4',
  // Moadian e-invoices on an order
} satisfies Record<string, PhaseLabel>;

export type LabelledFeature = keyof typeof FEATURE_LABELS;

/** Reports that ship later than the reports page (V2), by report code. */
export const REPORT_LABELS: Record<string, PhaseLabel> = {
  'aggregator-orders': 'V3',
  'snappfood-reconciliation': 'V3',
  'customer-credit': 'V3',
  'credit-eod-usage': 'V3',
  'customer-activity': 'V4',
  'credit-aging': 'V4',
  'branch-comparison': 'V4',
  'print-operations': 'F',
  'integration-operations': 'F',
};

/** Whether `pathname` is `prefix` or under it; a `*` in the prefix stands for one path segment. */
function underPrefix(pathname: string, prefix: string) {
  const want = prefix.split('/');
  const have = pathname.split('/');
  return want.length <= have.length && want.every((part, i) => part === '*' || part === have[i]);
}

export function pageLabel(pathname: string): PhaseLabel | undefined {
  let best: string | undefined;
  for (const prefix of Object.keys(PAGE_LABELS)) {
    const matches = underPrefix(pathname, prefix);
    if (matches && (!best || prefix.length > best.length)) best = prefix;
  }
  return best ? PAGE_LABELS[best] : undefined;
}
