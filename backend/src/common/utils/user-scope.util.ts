/**
 * Roles that act for the organization rather than for one site. Only these may change
 * settings head office owns, or work outside a single branch.
 */
export const HEAD_OFFICE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OWNER'];

export type UserScope = {
  role: string;
  /** NULL means the account is not confined to a location. */
  branchId: string | null;
};

/**
 * Head office is both things at once: a chain-wide role AND no branch confinement.
 * Either alone is not enough — an ADMIN pinned to one site is that site's administrator,
 * and a CASHIER with no branch is a misconfiguration, not an executive.
 */
export function isHeadOfficeUser(scope: UserScope): boolean {
  return !scope.branchId && HEAD_OFFICE_ROLES.includes((scope.role || '').toUpperCase());
}

/** The branches a user may act on: one for branch staff, all of them for head office. */
export function canActOnBranch(scope: UserScope, branchId: string): boolean {
  if (!scope.branchId) return true;
  return scope.branchId === branchId;
}
