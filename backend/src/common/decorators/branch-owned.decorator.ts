import { SetMetadata } from '@nestjs/common';

/**
 * Says which record a route's id names, so the branch it belongs to can be checked.
 *
 * The branch-scope interceptor confines what a request *asks for* — a branch named in the
 * query string or the body becomes the caller's own. It cannot confine what a request
 * *names*: `PATCH /terminals/<id>` carries no branch at all, only an id, and every service
 * behind those routes looked the record up by tenant and id alone. An audit found the
 * Downtown manager renaming Central Plaza's terminal and its kitchen station that way.
 *
 * Ids are not secret and are not a permission. This marks the route with the entity its id
 * refers to; `BranchOwnershipGuard` does the looking up, once, in one place.
 */

export const BRANCH_OWNED_KEY = 'branchOwned';

export type BranchOwnedSpec = {
  /** The entity class the route's id refers to. */
  entity: Function;
  /** Route parameter carrying that id. Defaults to `id`. */
  param?: string;
  /**
   * For a record that reaches its branch through a parent rather than a column of its own —
   * a table belongs to a floor, and the floor belongs to the shop.
   */
  through?: { entity: Function; foreignKey: string };
};

export const BranchOwned = (entity: Function, options: Omit<BranchOwnedSpec, 'entity'> = {}) =>
  SetMetadata(BRANCH_OWNED_KEY, { entity, ...options } as BranchOwnedSpec);
