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
  '/app/payments': 'V1',
  '/app/operations/card-terminals': 'V1',
  // Branches, tills, kitchen stations and routing, printers, the print queue, branch agents
  '/app/operations': 'V1',
  '/app/kiosk': 'V3',
  // V1's one very basic report is the dashboard; the reports page comes in V2.
  '/app/reports': 'V2',
  // Settings: users, roles, general, calendar, business day, shift policy, order workflow,
  // discount limits, payment methods, reason codes, note templates
  '/app/settings': 'V1',
  '/app/settings/approvals': 'V2',
  '/app/settings/data-reset': 'F',
  '/app/delivery': 'V1',
  // Categories, products with sizes, add-on groups and combos, availability (the 86 stop)
  // and the product and category import
  '/app/catalog': 'V1',
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
  // The wallet and its cashback rule (customer club).
  '/app/wallet': 'V4',
};

/** Features that ship later than the page they sit on. */
export const FEATURE_LABELS = {
  // POS register
  'pos.customerCredit': 'V3',
  // Delivery platforms (Snappfood) come with the incoming orders, in V3.
  // The pay panel saying a delivery order's remainder goes with the courier
  'pos.pay.courierCollects': 'V3',
  // Orders list and the order drawer
  'orders.snappfood': 'V3',
  'orders.headOfficeView': 'V4',
  // Shifts: in V1 the cashier enters the counted cash and closes the shift, nothing more.
  // Card terminals and the bank accounts they settle into
  'payments.bankTransfer': 'V4',
  'payments.settlementAccounts': 'V4',
  // Delivery. Couriers belong to one branch and are on a salary: a trip pays them nothing.
  // V1 dispatch: assign and send out, then settle on return.
  'delivery.settlementReverse': 'V2',
  // Catalog. Sizes, add-on groups and combos are V1 (2026-10-04).
  'catalog.maxPerOrder': 'V4',
  'catalog.priceHistory': 'V4',
  // Availability: a V1 item is available, or off until someone puts it back.
  'catalog.snappfoodStop': 'V3',
  // V1 stops are "until further notice" only: off until the next shift and off for set hours are F.
  'catalog.stopBranches': 'V4',
  // Price changes: V1 changes base prices now.
  'pricing.listPrices': 'V4',
  // Customers and credit
  'customers.credit': 'V3',
  // Operations
  'terminals.kiosk': 'V3',
  'printers.simulated': 'F',
  'printQueue.simulate': 'F',
  // Settings. Money is shown in Toman in V1; the Omani rial and the US dollar come in V7.
  'settings.reopenOrders': 'V2',
  'settings.incomingOrders': 'V3',
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
