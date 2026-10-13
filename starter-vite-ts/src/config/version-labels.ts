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
 *
 * Phase 1 has three versions (2026-10-13): V1 the counter; V2 everything a branch needs to
 * leave HAMI (Snappfood, customer credit, the wallet and cashback, friends and family);
 * V3 what head office needs to run many branches (cross-branch views, price lists, kiosk).
 */

/** V1–V3 are the three Phase 1 versions; F is after Phase 1. */
export type PhaseLabel = 'V1' | 'V2' | 'V3' | 'F';

export const PHASE_LABELS: PhaseLabel[] = ['V1', 'V2', 'V3', 'F'];

/** The version a page first ships in, by path prefix. The longest matching prefix wins. */
const PAGE_LABELS: Record<string, PhaseLabel> = {
  // Today's sales, open orders and open shifts: V1's one basic report
  '/app/dashboard': 'V1',
  // Prototype tools: the Snappfood simulator, payment and printer mocks, integration logs
  '/app/simulation': 'F',
  '/app/pos': 'V1',
  '/app/orders': 'V1',
  // Only Snappfood (and later the website) sends orders that wait to be accepted.
  '/app/orders/incoming': 'V2',
  // Shifts, their statements and business days
  '/app/cashier': 'V1',
  '/app/payments': 'V1',
  '/app/operations/card-terminals': 'V1',
  // Branches, tills, kitchen stations and routing, printers, the print queue, branch agents
  '/app/operations': 'V1',
  '/app/kiosk': 'V3',
  // The reports page (moved from V2 to V1, 2026-10-12); the dashboard is still the day at a glance.
  '/app/reports': 'V1',
  // Settings: users, roles, general, calendar, business day, shift policy, order workflow,
  // discount limits, payment methods, reason codes, note templates
  '/app/settings': 'V1',
  '/app/settings/data-reset': 'F',
  '/app/delivery': 'V1',
  // Categories, products with sizes, add-on groups and combos, availability (the 86 stop)
  // and the product and category import
  '/app/catalog': 'V1',
  // A V1 branch sells at base prices; price lists are chain-scale pricing.
  '/app/pricing/price-lists': 'V3',
  // Raising or lowering base prices now, by percent or amount
  '/app/pricing/changes': 'V1',
  // A dated percent off an item, taken off till lines by itself (HAMI's item discounts)
  '/app/pricing/item-discounts': 'V1',
  '/app/pricing/snappfood': 'V2',
  // Registering and finding customers, with their addresses
  '/app/customers': 'V1',
  // A customer's profile page (`*` is one path segment: the customer's id)
  '/app/customers/*': 'V3',
  // The wallet and its cashback rule: HamiClub's replacement, so a branch can leave HAMI.
  '/app/wallet': 'V2',
  // One-time coupons: batches of codes for a campaign, each used once at the till.
  '/app/coupons': 'V2',
};

/** Features that ship later than the page they sit on. */
export const FEATURE_LABELS = {
  // POS register: paying from the customer's credit or wallet, and their friends-and-family rate
  'pos.customerCredit': 'V2',
  'pos.wallet': 'V2',
  'pos.familyDiscount': 'V2',
  'pos.coupon': 'V2',
  // Delivery platforms (Snappfood) come with the incoming orders, in V2.
  // The pay panel saying a delivery order's remainder goes with the courier
  'pos.pay.courierCollects': 'V2',
  // Orders list and the order drawer
  'orders.snappfood': 'V2',
  'orders.headOfficeView': 'V3',
  // Shifts: in V1 the cashier enters the counted cash and closes the shift, nothing more.
  // Card terminals and the bank accounts they settle into
  'payments.bankTransfer': 'V3',
  'payments.settlementAccounts': 'V3',
  // Delivery. Couriers belong to one branch and are on a salary: a trip pays them nothing.
  // V1 dispatch: assign and send out, then settle on return.
  // Catalog. Sizes, add-on groups and combos are V1 (2026-10-04).
  'catalog.maxPerOrder': 'V3',
  'catalog.priceHistory': 'V3',
  // Availability: a V1 item is available, or off until someone puts it back.
  'catalog.snappfoodStop': 'V2',
  // V1 stops are "until further notice" only: off until the next shift and off for set hours are F.
  'catalog.stopBranches': 'V3',
  // Price changes: V1 changes base prices now.
  'pricing.listPrices': 'V3',
  // Customers: credit, the wallet and friends-and-family rates on the customer list
  'customers.credit': 'V2',
  'customers.wallet': 'V2',
  'customers.family': 'V2',
  // Operations
  'terminals.kiosk': 'V3',
  'printers.simulated': 'F',
  'printQueue.simulate': 'F',
  // Settings. Money is shown in Toman in V1; the Omani rial and the US dollar come in V7.
  'settings.incomingOrders': 'V2',
  // Kiosk (V3): sizes and add-ons ship with the kiosk.
  'kiosk.simulatedTerminal': 'F',
  // Dashboard: head office's view across branches
  'dashboard.branchHealth': 'V3',
  // Moadian e-invoices on an order
} satisfies Record<string, PhaseLabel>;

export type LabelledFeature = keyof typeof FEATURE_LABELS;

/** Reports that ship later than the reports page (V1), by report code. */
export const REPORT_LABELS: Record<string, PhaseLabel> = {
  'aggregator-orders': 'V2',
  'snappfood-reconciliation': 'V2',
  'customer-credit': 'V2',
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
