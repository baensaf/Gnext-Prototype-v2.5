import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY, HEAD_OFFICE_ONLY_KEY } from '../../common/decorators/roles.decorator';
import { effectiveBranchId } from '../../common/utils/user-scope.util';
import { CatalogController } from './catalog.controller';

/**
 * The menu is the chain's, the shelf is the branch's.
 *
 * Reading the decorators back off the controller is the only assertion that keeps working
 * when somebody adds a 31st route: a hand-written list of endpoints would still pass while
 * the new one shipped unguarded.
 */
const WRITE_METHODS = [RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE];

/** The two endpoints a branch is *meant* to reach, and so the only writes left open. */
const BRANCH_WRITES = ['availability/suspend', 'availability/resume'];

type Route = { name: string; path: string; headOfficeOnly: boolean; roles?: string[] };

function routes(): Route[] {
  const proto = CatalogController.prototype;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = (proto as any)[name];
      return {
        name,
        path: Reflect.getMetadata(PATH_METADATA, handler),
        method: Reflect.getMetadata(METHOD_METADATA, handler),
        headOfficeOnly: !!Reflect.getMetadata(HEAD_OFFICE_ONLY_KEY, handler),
        roles: Reflect.getMetadata(ROLES_KEY, handler),
      };
    })
    .filter((route) => route.path !== undefined)
    .filter((route) => WRITE_METHODS.includes(route.method)) as Route[];
}

describe('who may change the catalogue', () => {
  it('finds the write routes at all', () => {
    // Guards the test itself: if the metadata shape ever changes, an empty list would
    // make every assertion below pass vacuously.
    expect(routes().length).toBeGreaterThan(15);
  });

  it('leaves no catalogue write open to a branch', () => {
    const open = routes()
      .filter((route) => !route.headOfficeOnly)
      .map((route) => route.path)
      .filter((path) => !BRANCH_WRITES.includes(path));

    expect(open).toEqual([]);
  });

  it('keeps availability with the branch that has to serve the food', () => {
    const branchWrites = routes().filter((route) => BRANCH_WRITES.includes(route.path));

    expect(branchWrites).toHaveLength(2);
    expect(branchWrites.every((route) => route.headOfficeOnly)).toBe(false);
  });

  // The sidebar has never offered the availability screen to a register. An endpoint that
  // disagreed with the sidebar would be the only way anybody found that out.
  it('does not let a register 86 an item behind the screen it cannot open', () => {
    const branchWrites = routes().filter((route) => BRANCH_WRITES.includes(route.path));

    for (const route of branchWrites) {
      expect(route.roles).toBeDefined();
      expect(route.roles).toContain('MANAGER');
      expect(route.roles).not.toContain('CASHIER');
    }
  });
});

describe('whose shelf an availability change lands on', () => {
  const DOWNTOWN = 'branch-downtown';
  const UPTOWN = 'branch-uptown';

  it('ignores the branch a branch user asks for and uses their own', () => {
    expect(effectiveBranchId(DOWNTOWN, UPTOWN)).toBe(DOWNTOWN);
  });

  // Omitting the branch is how you suspend chain-wide, so a branch user must not be able
  // to reach that by simply leaving the field out.
  it('does not let a branch user 86 an item across the chain', () => {
    expect(effectiveBranchId(DOWNTOWN, undefined)).toBe(DOWNTOWN);
  });

  it('lets head office work on a named branch, or on the whole chain', () => {
    expect(effectiveBranchId(null, UPTOWN)).toBe(UPTOWN);
    expect(effectiveBranchId(null, undefined)).toBeUndefined();
  });
});
