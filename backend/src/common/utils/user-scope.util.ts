/**
 * Roles that act for the organization rather than for one site. Only these may change
 * settings head office owns, or work outside a single branch.
 */
export const HEAD_OFFICE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OWNER'];

/**
 * Roles whose pin releases something a register operator is not trusted to do alone —
 * money going back out of the till, mainly. A cashier is who the pin is asked of, so a
 * cashier is not on this list.
 */
export const APPROVER_ROLES = [...HEAD_OFFICE_ROLES, 'MANAGER', 'SUPERVISOR'];

/** Every role the users screen may hand out. */
export const ASSIGNABLE_ROLES = [...APPROVER_ROLES, 'CASHIER'];

/**
 * An approver pin is four to eight digits. A one-digit pin falls to the fifth guess of the
 * fifteen-minute window, and every refund and paid cancellation at that branch with it.
 */
export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

/** True when the account carries its own authority and needs nobody else's pin. */
export function isApprover(role?: string | null): boolean {
  return APPROVER_ROLES.includes((role || '').toUpperCase());
}

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

/**
 * Which branch a request is really about.
 *
 * A branch account is answered about its own branch whatever the client asked for — the
 * confinement has to hold at the query, not only in the switcher that normally sets it.
 * Head office gets whatever it asked for, and everything when it asked for nothing.
 */
export function effectiveBranchId(
  userBranchId: string | null | undefined,
  requested?: string | null,
): string | undefined {
  if (userBranchId) return userBranchId;
  return requested || undefined;
}

/** The branches a user may act on: one for branch staff, all of them for head office. */
export function canActOnBranch(scope: UserScope, branchId: string): boolean {
  if (!scope.branchId) return true;
  return scope.branchId === branchId;
}
