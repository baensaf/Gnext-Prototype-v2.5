import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * A branch account is answered about its own branch, whatever the client asked for.
 *
 * Controllers take the branch from `?branchId=` or from the body, which is right for head
 * office — it is how one account looks at four shops. For an account pinned to a shop it is
 * a hole: the sidebar never offers another branch, but the query string will happily name
 * one, and an audit found a Downtown cashier reading Central Plaza's settings, zones and
 * couriers that way.
 *
 * `effectiveBranchId` already encodes the rule and a handful of controllers call it. Doing
 * it here instead means it holds for the thirty-odd that never did, and for the next one
 * somebody writes: by the time a handler reads `branchId`, it is already the caller's own.
 * Head office has no branch of its own, so nothing it sends is touched.
 */
@Injectable()
export class BranchScopeInterceptor implements NestInterceptor {
  /** Both spellings appear across the modules, and requests arrive with either. */
  private static readonly KEYS = ['branchId', 'branch_id'];

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const userBranchId = req?.userBranchId;

    // No session yet (the public routes), or head office, which may name any branch.
    if (userBranchId) {
      BranchScopeInterceptor.confine(req.query, userBranchId, true);
      BranchScopeInterceptor.confine(req.body, userBranchId, false);
    }

    return next.handle();
  }

  /**
   * Rewrites a branch the caller named, and on a query will supply one they left out.
   *
   * Overwriting alone was only half the rule. Every leaking list endpoint found in the
   * audit — terminals, delivery zones, couriers, dining sections, business days — already
   * threaded `branchId` through to its service; they answered about the whole chain purely
   * because the client sent nothing and "no branch given" means "no filter". For an account
   * pinned to one shop there is no reading of "no branch given" that should include another
   * shop, so the query gets the branch filled in.
   *
   * The body deliberately does not: a create with no branch is a handler's own decision
   * about what it is making, and quietly stamping a branch onto it would invent ownership
   * for records that may have none.
   */
  private static confine(bag: any, userBranchId: string, fillIfAbsent: boolean): void {
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return;

    const named = BranchScopeInterceptor.KEYS.filter(
      (key) => bag[key] !== undefined && bag[key] !== null && bag[key] !== '',
    );

    if (named.length) {
      for (const key of named) bag[key] = userBranchId;
      return;
    }

    // `branchId` is the spelling every controller's @Query reads; a handler wanting the
    // snake_case one takes it from the same bag.
    if (fillIfAbsent) bag.branchId = userBranchId;
  }
}
