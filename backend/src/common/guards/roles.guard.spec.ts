import { ForbiddenException } from '@nestjs/common';
import {
  HEAD_OFFICE_ONLY_KEY,
  MANAGER_AND_ABOVE,
  ROLES_KEY,
} from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

const contextFor = (req: any) =>
  ({
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => req }),
  }) as any;

/** Stands in for the metadata a decorator would have attached to the handler. */
const reflectorFor = (meta: Record<string, any>) =>
  ({ getAllAndOverride: (key: string) => meta[key] }) as any;

const request = (role: string, branchId: string | null) => ({
  userId: 'u1',
  userRole: role,
  userBranchId: branchId,
});

const headOffice = request('SUPER_ADMIN', null);
const downtownManager = request('MANAGER', 'branch-a');
const downtownCashier = request('CASHIER', 'branch-a');

describe('RolesGuard', () => {
  // The whole API is behind this guard, so the case that matters most is the one where
  // nobody asked for anything: an unmarked route must behave as if the guard were absent.
  it('leaves an unmarked route open to anyone signed in', () => {
    const guard = new RolesGuard(reflectorFor({}));
    expect(guard.canActivate(contextFor(downtownCashier))).toBe(true);
  });

  it('leaves a route marked with an empty role list alone', () => {
    const guard = new RolesGuard(reflectorFor({ [ROLES_KEY]: [] }));
    expect(guard.canActivate(contextFor(downtownCashier))).toBe(true);
  });

  describe('@HeadOfficeOnly()', () => {
    const guard = new RolesGuard(reflectorFor({ [HEAD_OFFICE_ONLY_KEY]: true }));

    it('admits an account that acts for the organization', () => {
      expect(guard.canActivate(contextFor(headOffice))).toBe(true);
    });

    it('refuses a branch manager', () => {
      expect(() => guard.canActivate(contextFor(downtownManager))).toThrow(ForbiddenException);
    });

    // The point of the decorator: seniority is not reach. An administrator pinned to a
    // site administers that site.
    it('refuses an administrator pinned to a branch', () => {
      expect(() => guard.canActivate(contextFor(request('ADMIN', 'branch-a')))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('@Roles(...)', () => {
    const guard = new RolesGuard(reflectorFor({ [ROLES_KEY]: MANAGER_AND_ABOVE }));

    it('admits a branch manager, who configures their own site', () => {
      expect(guard.canActivate(contextFor(downtownManager))).toBe(true);
    });

    it('admits head office', () => {
      expect(guard.canActivate(contextFor(headOffice))).toBe(true);
    });

    it('refuses a register operator', () => {
      expect(() => guard.canActivate(contextFor(downtownCashier))).toThrow(ForbiddenException);
    });

    it('does not care how the role was cased', () => {
      expect(guard.canActivate(contextFor(request('manager', 'branch-a')))).toBe(true);
    });
  });

  it('refuses a marked route that no session guard identified', () => {
    const guard = new RolesGuard(reflectorFor({ [HEAD_OFFICE_ONLY_KEY]: true }));
    expect(() => guard.canActivate(contextFor({}))).toThrow(ForbiddenException);
  });
});
