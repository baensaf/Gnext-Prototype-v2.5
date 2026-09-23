import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY, HEAD_OFFICE_ONLY_KEY } from '../decorators/roles.decorator';
import { effectiveBranchId } from '../utils/user-scope.util';
import { CatalogController } from '../../modules/catalog/catalog.controller';
import { DiscountsController } from '../../modules/discounts/discounts.controller';
import { LocalizationController } from '../../modules/localization/localization.controller';
import { CustomerController } from '../../modules/customer/customer.controller';
import { CreditController } from '../../modules/customer/credit.controller';
import { SimulationController } from '../../modules/simulation/simulation.controller';

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
  // A decorator on the class covers every route in it, and reading only the handler makes a
  // guarded controller look wide open — which is exactly how an audit of this codebase
  // first mis-reported UsersController.
  const classHeadOffice = !!Reflect.getMetadata(HEAD_OFFICE_ONLY_KEY, controller);
  const classRoles = Reflect.getMetadata(ROLES_KEY, controller);
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = proto[name];
      return {
        name,
        path: Reflect.getMetadata(PATH_METADATA, handler),
        method: Reflect.getMetadata(METHOD_METADATA, handler),
        headOfficeOnly: !!Reflect.getMetadata(HEAD_OFFICE_ONLY_KEY, handler) || classHeadOffice,
        roles: Reflect.getMetadata(ROLES_KEY, handler) ?? classRoles,
      };
    })
    .filter((route) => route.path !== undefined)
    .filter((route) => WRITE_METHODS.includes(route.method)) as Route[];
}

/**
 * Writes each controller deliberately leaves open to anybody signed in, and why. Anything
 * not named here must carry `@HeadOfficeOnly()` for reach or `@Roles()` for seniority, so
 * a new route is refused by this test until somebody decides which side of the line it
 * belongs on.
 */
const OPEN_BY_DESIGN: Array<[string, any, string[]]> = [
  // The shelf, not the menu: taking an item off sale today is the branch's call — but a
  // manager's, so availability carries @Roles and is not open in the sense meant here.
  // The register's own 86 is the exception (decided 2026-09-18): any register user may take
  // an item off until the next shift with a reason, and the route itself asks for an
  // approver's pin for anything longer or for putting an item back.
  ['catalog', CatalogController, ['availability/pos-stop', 'availability/pos-resume']],
  // Reads in all but HTTP verb — the register calls both in the middle of an order.
  ['discounts', DiscountsController, ['coupons/validate', 'discount-quotes']],
  ['localization', LocalizationController, []],
  // Everything a counter does with a customer: sign one up, correct what it got wrong, add
  // a phone, an address, a consent. The record itself is the chain's, so merging two and the
  // group taxonomy are not — nor is refusing to serve somebody, since a block taken at one
  // site has to hold at the next, which is why block/unblock carry @HeadOfficeOnly and are
  // deliberately absent from this list.
  [
    'customer',
    CustomerController,
    [
      'customers',
      'customers/:id',
      'customers/:id/phones',
      'customers/:id/consents',
      'customers/:id/addresses',
    ],
  ],
  // Credit is held centrally. Nothing here checked anything at all until an audit found a
  // register account could read the whole chain's ledger and move balances on it.
  ['credit', CreditController, []],
  // The demo sandbox writes real orders and flips connectivity the whole demo reads. Its
  // screens are head office's; so is the API.
  ['simulation', SimulationController, []],
];

describe.each(OPEN_BY_DESIGN)('%s: what the chain decides once', (label, controller, open) => {
  it('finds the write routes at all', () => {
    // Guards the test itself: if the metadata shape ever changes, an empty list would make
    // every assertion below pass vacuously.
    expect(writeRoutes(controller).length).toBeGreaterThan(0);
  });

  it('leaves no chain-wide write open to a branch', () => {
    const unguarded = writeRoutes(controller)
      .filter((route) => !route.headOfficeOnly && !route.roles)
      .map((route) => String(route.path))
      .filter((path) => !open.includes(path));

    expect(unguarded).toEqual([]);
  });
});

describe('money on a customer account', () => {
  // Reach, not seniority: one limit and one ledger per customer, usable at every branch,
  // so no branch — not even its manager — sets a limit, takes a repayment or adjusts one.
  it('keeps credit limits, repayments and adjustments with head office', () => {
    const creditPaths = (path: string | string[]) =>
      ([] as string[]).concat(path).some((p) => p.includes('credit'));
    const routes = [
      ...writeRoutes(CreditController),
      ...writeRoutes(CustomerController).filter((route) => creditPaths(route.path)),
    ];
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.headOfficeOnly).toBe(true);
    }
  });
});

describe('signing a customer up at the counter', () => {
  // Creating a customer also opens their credit account, and the POS sends a limit with every
  // sign-up — so without this a cashier granted credit to whoever they signed on.
  async function limitPassedOn(user: { userRole: string; userBranchId: string | null }) {
    const service = { createCustomer: jest.fn().mockResolvedValue({}) };
    const controller = new CustomerController(service as any, {} as any);
    const body = { first_name: 'Sara', mobile: '09120000000', credit_limit: '10000000' };
    await controller.createCustomer(body, { tenantId: 'tenant', ...user } as any);
    return service.createCustomer.mock.calls[0][1].credit_limit;
  }

  it('signs the customer up but drops a limit sent from a branch', async () => {
    expect(await limitPassedOn({ userRole: 'CASHIER', userBranchId: 'branch-downtown' })).toBeUndefined();
    expect(await limitPassedOn({ userRole: 'MANAGER', userBranchId: 'branch-downtown' })).toBeUndefined();
  });

  it('lets head office open the account with a limit', async () => {
    expect(await limitPassedOn({ userRole: 'SUPER_ADMIN', userBranchId: null })).toBe('10000000');
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
