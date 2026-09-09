import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY, HEAD_OFFICE_ONLY_KEY } from '../decorators/roles.decorator';
import { effectiveBranchId } from '../utils/user-scope.util';
import { CatalogController } from '../../modules/catalog/catalog.controller';
import { DiscountsController } from '../../modules/discounts/discounts.controller';
import { PricingController } from '../../modules/pricing/pricing.controller';
import { LocalizationController } from '../../modules/localization/localization.controller';
import { CustomerController } from '../../modules/customer/customer.controller';

/**
 * What the chain decides once, and what a branch decides for itself.
 *
 * The rule these controllers follow comes from the schema: a record with no `branch_id`
 * exists once for the whole tenant, so a branch editing one is editing everybody's. Those
 * writes are head office's. Records that do carry a branch, and the day-to-day traffic of
 * running a shop, are not.
 *
 * Reading the decorators back off each controller is the only assertion that keeps working
 * when somebody adds a route: a hand-written list of endpoints would still pass while the
 * new one shipped unguarded.
 */
const WRITE_METHODS = [
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
];

type Route = { name: string; path: string; headOfficeOnly: boolean; roles?: string[] };

function writeRoutes(controller: any): Route[] {
  const proto = controller.prototype;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = proto[name];
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

/**
 * Writes each controller deliberately leaves open, and why. Anything not named here must
 * carry `@HeadOfficeOnly()`, so a new route is refused by this test until somebody decides
 * which side of the line it belongs on.
 */
const OPEN_BY_DESIGN: Array<[string, any, string[]]> = [
  // The shelf, not the menu: taking an item off sale today is the branch's call.
  ['catalog', CatalogController, ['availability/suspend', 'availability/resume']],
  // Reads in all but HTTP verb — the register calls both in the middle of an order.
  ['discounts', DiscountsController, ['coupons/validate', 'discount-quotes']],
  // Computes a preview and writes nothing.
  ['pricing', PricingController, ['prices/bulk-preview']],
  ['localization', LocalizationController, []],
  // Everything a counter does with a customer: sign one up, add a phone, take a payment
  // against their account. Only the group taxonomy is chain-wide.
  [
    'customer',
    CustomerController,
    [
      'customers',
      'customers/merge',
      'customers/:id/phones',
      'customers/:id/consents',
      'customers/:id/addresses',
      ['customers/:id/credit-account/transactions', 'customers/:id/credit/transactions'].join(),
      ['customers/:id/credit-account/repayments', 'customers/:id/credit/repayments'].join(),
      ['customers/:id/credit-account/adjustments', 'customers/:id/credit/adjustments'].join(),
    ],
  ],
];

describe.each(OPEN_BY_DESIGN)('%s: what the chain decides once', (label, controller, open) => {
  it('finds the write routes at all', () => {
    // Guards the test itself: if the metadata shape ever changes, an empty list would make
    // every assertion below pass vacuously.
    expect(writeRoutes(controller).length).toBeGreaterThan(0);
  });

  it('leaves no chain-wide write open to a branch', () => {
    const unguarded = writeRoutes(controller)
      .filter((route) => !route.headOfficeOnly)
      .map((route) => String(route.path))
      .filter((path) => !open.includes(path));

    expect(unguarded).toEqual([]);
  });
});

describe('what a branch still decides for itself', () => {
  const branchWrites = ['availability/suspend', 'availability/resume'];

  it('keeps availability with the branch that has to serve the food', () => {
    const routes = writeRoutes(CatalogController).filter((r) => branchWrites.includes(r.path));

    expect(routes).toHaveLength(2);
    expect(routes.every((route) => route.headOfficeOnly)).toBe(false);
  });

  // The sidebar has never offered the availability screen to a register. An endpoint that
  // disagreed with the sidebar would be the only way anybody found that out.
  it('does not let a register 86 an item behind the screen it cannot open', () => {
    for (const route of writeRoutes(CatalogController).filter((r) => branchWrites.includes(r.path))) {
      expect(route.roles).toBeDefined();
      expect(route.roles).toContain('MANAGER');
      expect(route.roles).not.toContain('CASHIER');
    }
  });

  it('keeps the register able to price and tender an order', () => {
    const open = writeRoutes(DiscountsController)
      .filter((route) => !route.headOfficeOnly)
      .map((route) => route.path);

    expect(open).toContain('coupons/validate');
    expect(open).toContain('discount-quotes');
  });
});

describe('whose shelf an availability change lands on', () => {
  const DOWNTOWN = 'branch-downtown';
  const UPTOWN = 'branch-uptown';

  it('ignores the branch a branch user asks for and uses their own', () => {
    expect(effectiveBranchId(DOWNTOWN, UPTOWN)).toBe(DOWNTOWN);
  });

  // Omitting the branch is how you suspend chain-wide, so a branch user must not be able to
  // reach that by simply leaving the field out.
  it('does not let a branch user 86 an item across the chain', () => {
    expect(effectiveBranchId(DOWNTOWN, undefined)).toBe(DOWNTOWN);
  });

  it('lets head office work on a named branch, or on the whole chain', () => {
    expect(effectiveBranchId(null, UPTOWN)).toBe(UPTOWN);
    expect(effectiveBranchId(null, undefined)).toBeUndefined();
  });
});
