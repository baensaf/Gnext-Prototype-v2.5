/**
 * Gnext Prototype — what each role is allowed to reach.
 *
 * One table, read by the sidebar, the router and the post-sign-in redirect, so those three
 * cannot drift apart and offer a link that then refuses to open. This shapes what an
 * operator is offered; the API does not enforce it yet, so treat it as the product rule
 * rather than a security boundary.
 */

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
];

/** A branch manager runs one site: its people, its money, its menu, its reports. */
const MANAGER_PATHS = [
  ...CASHIER_PATHS,
  '/app/cashier',
  '/app/delivery',
  '/app/payments',
  '/app/refunds',
  '/app/customers',
  '/app/credit',
  '/app/customer-club',
  '/app/catalog',
  '/app/pricing',
  '/app/discounts',
  '/app/operations',
  '/app/reports',
  '/app/audit',
  '/app/settings',
];

/**
 * Decisions that belong to the chain rather than to any one shop. A manager reaching these
 * would be editing other people's branches, so they stay with head office even though the
 * surrounding area is open.
 */
const CHAIN_ONLY_PATHS = [
  '/app/settings/users',
  '/app/operations/branches',
  '/app/reports/branch-comparison',
  '/app/catalog/import-export',
  '/app/settings/data-reset',
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

export function canReachPath(role: string | null | undefined, pathname: string): boolean {
  const access = accessForRole(role);
  if (!access) return true;
  if (access.deny.some((prefix) => matches(pathname, prefix))) return false;
  return access.allow.some((prefix) => matches(pathname, prefix));
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
