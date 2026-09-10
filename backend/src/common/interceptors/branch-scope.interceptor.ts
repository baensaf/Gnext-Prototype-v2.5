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
      BranchScopeInterceptor.confine(req.query, userBranchId);
      BranchScopeInterceptor.confine(req.body, userBranchId);
    }

    return next.handle();
  }

  /**
   * Only ever overwrites a branch the caller named; it does not add one. A handler that was
   * called without a branch still decides for itself what "no branch given" means.
   */
  private static confine(bag: any, userBranchId: string): void {
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return;
    for (const key of BranchScopeInterceptor.KEYS) {
      if (bag[key] !== undefined && bag[key] !== null && bag[key] !== '') {
        bag[key] = userBranchId;
      }
    }
  }
}
