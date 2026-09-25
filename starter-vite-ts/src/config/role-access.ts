/**
 * Gnext Prototype — what each role is allowed to reach.
 *
 * One table, read by the sidebar, the router and the post-sign-in redirect, so those three
 * cannot drift apart and offer a link that then refuses to open. This shapes what an
 * operator is offered; the API does not enforce it yet, so treat it as the product rule
 * rather than a security boundary.
 */

import type { BranchType } from 'src/api/tenantApi';

/** Roles the prototype seeds or recognises. Anything else is treated as a register account. */
export type AppRole = 'SUPER_ADMIN' | 'ADMIN' | 'OWNER' | 'MANAGER' | 'CASHIER';

export interface RoleAccess {
  /** Path prefixes this role may open. A prefix covers its detail routes. */
  allow: string[];
  /** Carve-outs checked before `allow`, for the few pages inside an otherwise open area. */
  deny: string[];
  /** Where this role starts after signing in. */
  home: string;
}

/**
 * A register operator: take orders, work the floor, close their own shift. Everything
 * that shapes the business — prices, discounts, catalogue, settings — is somebody else's.
 */
const CASHIER_PATHS = [
  '/app/dashboard',
  '/app/pos',
  '/app/kiosk',
  '/app/kds',
  '/app/dine-in',
  '/app/orders',
  '/app/cashier/shifts',
  // A refund is handed over at the register, so this is the cashier's screen even though
  // the money only moves once an approver has put their pin in.
  '/app/refunds',
  // At the counter it is the cashier who hands a delivery to the courier and counts the
  // cash-on-delivery back in; the fleet itself (couriers, zones, pay) stays the manager's.
  '/app/delivery/orders',
  '/app/delivery/couriers',
  '/app/delivery/settlements',
];

/** A branch manager runs one site: its people, its money, its menu, its reports. */
const MANAGER_PATHS = [
  ...CASHIER_PATHS,
  '/app/cashier',
  '/app/delivery',
  '/app/payments',
  '/app/customers',
  '/app/credit',
  '/app/customer-club',
  '/app/catalog',
  '/app/pricing',
  '/app/discounts',
  '/app/operations',
  '/app/reports',
  '/app/audit',
  '/app/moadian',
  '/app/settings',
];

/**
 * Decisions that belong to the chain rather than to any one shop. A manager reaching these
 * would be editing other people's branches, so they stay with head office even though the
 * surrounding area is open.
 */
const CHAIN_ONLY_PATHS = [
  '/app/settings/users',
  // Who may see what across the chain is head office's document, not a branch's setting.
  '/app/settings/roles',
  // One set of currencies, tender types, reason codes, approval thresholds and languages
  // for the whole chain, so one place decides them. What a branch may diverge on is the
  // overridable settings groups, which keep their own screens.
  '/app/settings/general',
  '/app/settings/approvals',
  '/app/settings/discount-authorizations',
  '/app/settings/payments',
  '/app/settings/payments-refunds',
  '/app/settings/reasons',
  '/app/settings/localization',
  '/app/operations/branches',
  // Which PC may speak for a branch is decided centrally; a branch account could otherwise
  // enrol a machine for the shop next door.
  '/app/operations/agents',
  '/app/reports/branch-comparison',
  // Reading every branch at once is head office's job by definition. A branch manager has
  // the live screens for their own site and no business reading the shop next door's
  // drawer variance, so the roll-ups are chain-only even though they only ever read.
  '/app/delivery/rollup',
  '/app/cashier/rollup',
  '/app/catalog/import-export',
  '/app/settings/data-reset',
  // The menu is the chain's. A branch does not invent products, rename categories,
  // rewrite modifiers or reprice anything — it decides which of head office's items
  // it can actually serve today, on /app/catalog/availability, which stays open.
  // Products stays open too, read-only, because you cannot 86 what you cannot see.
  '/app/catalog/categories',
  '/app/catalog/modifiers',
  '/app/pricing',
  // Discounts are the chain's for the same reason the menu is: a coupon and a negotiated
  // customer rate carry no branch column, so a branch editing one is editing everybody's.
  // The register still validates coupons and quotes discounts — those are reads in all but
  // HTTP verb. Cashier discount caps live only at /app/settings/discount-authorizations.
  '/app/discounts',
  '/app/customer-club',
  // Customers and their credit are held centrally: one record per customer across the
  // chain, one limit and one ledger. The counter still looks customers up and signs new
  // ones on at the POS, and takes a credit payment through the payment module — neither
  // goes through these screens.
  '/app/customers',
  '/app/credit',
  // The sandbox drives the chain's integrations — Snappfood, the payment and printer mocks,
  // the offline queue — and its API has been head office's only all along, so a branch
  // copy of the menu was a set of screens whose every call came back refused.
  '/app/simulation',
];

/**
 * Screens that run one site: its live service, its tills, its couriers, its equipment. At
 * head office there is no site to run, and the chain reads these through the roll-ups
 * instead — so they are hidden there rather than offered with nobody's data in them.
 */
const SITE_ONLY_PATHS = [
  '/app/delivery',
  '/app/cashier',
  // Money is taken and handed back at a till, so the payment and refund desks are the
  // branch's. Orders are not listed here: head office looks them up, read-only.
  '/app/payments',
  '/app/refunds',
  '/app/operations/terminals',
  '/app/operations/printers',
  '/app/operations/kds-configuration',
  '/app/operations/print-queue',
  // Orders from Snappfood and the website are answered at the shop they were sent to.
  '/app/orders/incoming',
];

/**
 * Tools that only make sense standing in a shop: a register, a kiosk, a kitchen display,
 * a dining floor. A production kitchen and an office have no customers either.
 */
const SHOP_FLOOR_PATHS = ['/app/pos', '/app/kiosk', '/app/kds', '/app/dine-in'];

/**
 * What stands behind the shop floor: the orders, the tills and shifts, the money in and
 * out, the couriers, the payment terminals and the rules for editing an order. A
 * production kitchen and an office take no orders, so none of it applies inside one —
 * but unlike the shop floor, head office keeps what it reads or sets for the chain here,
 * the order lookup and the order-editing defaults. Printers and the print queue are not
 * listed: a commissary prints labels and production sheets.
 */
const SELLING_SITE_PATHS = [
  '/app/orders',
  '/app/delivery',
  '/app/cashier',
  '/app/payments',
  '/app/refunds',
  '/app/operations/terminals',
  '/app/operations/kds-configuration',
  '/app/settings/order-workflow',
  '/app/settings/shift-policy',
  '/app/settings/courier-pay',
];

const FULL_ACCESS: RoleAccess = { allow: ['*'], deny: [], home: '/app/dashboard' };

export const ROLE_ACCESS: Record<string, RoleAccess> = {
  SUPER_ADMIN: FULL_ACCESS,
  ADMIN: FULL_ACCESS,
  OWNER: FULL_ACCESS,
  MANAGER: { allow: MANAGER_PATHS, deny: CHAIN_ONLY_PATHS, home: '/app/dashboard' },
  CASHIER: { allow: CASHIER_PATHS, deny: [], home: '/app/pos' },
};

/** A role nobody has classified gets the narrowest set rather than the widest. */
const UNCLASSIFIED = ROLE_ACCESS.CASHIER;

function matches(pathname: string, prefix: string): boolean {
  return prefix === '*' || pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Null while the signed-in account is still unknown — during the first `/auth/me`, or if an
 * error boundary took the store with it. Callers treat null as "do not restrict yet":
 * hiding the whole app because the role has not arrived is worse than showing it.
 */
export function accessForRole(role?: string | null): RoleAccess | null {
  if (!role) return null;
  return ROLE_ACCESS[role.toUpperCase()] ?? UNCLASSIFIED;
}

/** True for a screen that decides something for the whole chain rather than for one site. */
export function isChainOnlyPath(pathname: string): boolean {
  return CHAIN_ONLY_PATHS.some((prefix) => matches(pathname, prefix));
}

/**
 * `isHeadOffice` is reach, and it is a separate question from seniority.
 *
 * The server refuses a chain-wide write on `isHeadOfficeUser` — a head-office role AND no
 * branch confinement — so an ADMIN pinned to one site is that site's administrator and is
 * turned away from the chain's screens. The role table alone said otherwise and offered
 * that account links whose every write then came back 403. Defaults to unconfined, which
 * is what an unknown account gets while `/auth/me` is still in flight.
 */
export function canReachPath(
  role: string | null | undefined,
  pathname: string,
  isHeadOffice: boolean = true
): boolean {
  const access = accessForRole(role);
  if (!access) return true;
  if (!isHeadOffice && isChainOnlyPath(pathname)) return false;
  if (access.deny.some((prefix) => matches(pathname, prefix))) return false;
  return access.allow.some((prefix) => matches(pathname, prefix));
}

/** The scope chosen in the header switcher, as opposed to the account's own reach. */
export interface WorkspaceScope {
  isHeadOffice: boolean;
  /** Null at head office, which is not a site. */
  branchType: BranchType | null;
}

/**
 * Whether a screen belongs in the scope the header is set to — a separate question from
 * `canReachPath`. An unconfined admin may open everything, but at head office the menu is
 * the chain's work and inside a branch it is that branch's, so each side hides the other's.
 * This shapes what is offered, not what may be opened: a link from an order to its receipt
 * still works at head office.
 *
 * Null scope — still loading, or the provider was lost to an error boundary — hides nothing.
 */
export function fitsWorkspace(pathname: string, scope?: WorkspaceScope | null): boolean {
  if (!scope) return true;
  const listed = (prefixes: string[]) => prefixes.some((prefix) => matches(pathname, prefix));
  // Checked first: the chain's roll-ups sit under the same prefixes as the live screens
  // they summarise, /app/delivery/rollup under /app/delivery.
  if (isChainOnlyPath(pathname)) return scope.isHeadOffice;
  if (scope.isHeadOffice) return !listed(SITE_ONLY_PATHS) && !listed(SHOP_FLOOR_PATHS);
  return scope.branchType === 'RESTAURANT' || (!listed(SHOP_FLOOR_PATHS) && !listed(SELLING_SITE_PATHS));
}

/**
 * Roles whose pin releases what a register operator may not do alone. Mirrors the server's
 * APPROVER_ROLES; the server still checks, this only decides whether to ask for a pin.
 */
export const APPROVER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OWNER', 'MANAGER', 'SUPERVISOR'];

export function isApproverRole(role?: string | null): boolean {
  return APPROVER_ROLES.includes((role || '').toUpperCase());
}

export function homePathForRole(role?: string | null): string {
  return accessForRole(role)?.home ?? '/app/dashboard';
}

/** Fallback English names; `auth.roles.*` supplies the translated ones. */
export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'System Administrator',
  ADMIN: 'Administrator',
  OWNER: 'Owner',
  MANAGER: 'Branch Manager',
  CASHIER: 'Cashier',
};
