import { SetMetadata } from '@nestjs/common';

/**
 * Two ways to mark a route, because the chain has two different rules.
 *
 * `@Roles(...)` is about seniority: a register operator may not write settings, whatever
 * branch they stand in. `@HeadOfficeOnly()` is about reach: opening a branch or resetting
 * the chain's data is not a thing any one site does, so an account pinned to a site cannot
 * do it even when its role sounds senior.
 */

export const ROLES_KEY = 'requiredRoles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export const HEAD_OFFICE_ONLY_KEY = 'headOfficeOnly';
export const HeadOfficeOnly = () => SetMetadata(HEAD_OFFICE_ONLY_KEY, true);

/**
 * Work done at a branch: head office reads a branch's orders and money but changes none of them
 * (O-28, P-27). An account pinned to the branch passes, whatever its role.
 */
export const BRANCH_STAFF_ONLY_KEY = 'branchStaffOnly';
export const BranchStaffOnly = () => SetMetadata(BRANCH_STAFF_ONLY_KEY, true);

/** Senior enough to configure a site. Head office roles are included by definition. */
export const MANAGER_AND_ABOVE = ['SUPER_ADMIN', 'ADMIN', 'OWNER', 'MANAGER'];
