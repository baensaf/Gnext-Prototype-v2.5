import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  BRANCH_STAFF_ONLY_KEY,
  HEAD_OFFICE_ONLY_KEY,
  ROLES_KEY,
} from '../decorators/roles.decorator';
import { isHeadOfficeUser } from '../utils/user-scope.util';

/**
 * Enforces the role decorators. Registered globally, but a handler carrying neither
 * decorator is left exactly as it was — every route that worked before this guard existed
 * still does, and a route only becomes restricted when someone says so at the handler.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const headOfficeOnly = this.reflector.getAllAndOverride<boolean>(HEAD_OFFICE_ONLY_KEY, targets);
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, targets);
    const branchStaffOnly = this.reflector.getAllAndOverride<boolean>(BRANCH_STAFF_ONLY_KEY, targets);

    if (!headOfficeOnly && !roles?.length && !branchStaffOnly) {
      return true;
    }

    const req = context.switchToHttp().getRequest();

    // Marked routes sit behind the session guard, so an unidentified caller here means the
    // route was also marked public. Refusing is the safe reading of that contradiction.
    if (!req.userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        title: 'Not Permitted',
        detail: 'This action requires a signed-in account with sufficient authority.',
      });
    }

    const scope = { role: req.userRole, branchId: req.userBranchId ?? null };

    if (branchStaffOnly && isHeadOfficeUser(scope)) {
      throw new ForbiddenException({
        code: 'HEAD_OFFICE_READS_ONLY',
        title: 'Head Office Reads Only',
        detail: "Head office reads a branch's orders and payments but doesn't change them. Sign in as the branch's staff.",
      });
    }

    if (headOfficeOnly && !isHeadOfficeUser(scope)) {
      throw new ForbiddenException({
        code: 'HEAD_OFFICE_ONLY',
        title: 'Head Office Only',
        detail: 'This action belongs to the organization rather than to a single branch.',
      });
    }

    if (roles?.length && !roles.includes((scope.role || '').toUpperCase())) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        title: 'Not Permitted',
        detail: `This action requires one of: ${roles.join(', ')}.`,
      });
    }

    return true;
  }
}
