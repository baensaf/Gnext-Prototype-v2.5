import 'reflect-metadata';

import { HEAD_OFFICE_ONLY_KEY, ROLES_KEY, MANAGER_AND_ABOVE } from '../decorators/roles.decorator';
import { DeliveryController } from '../../modules/delivery/delivery.controller';
import { DineInController } from '../../modules/dine-in/dine-in.controller';
import { KdsController } from '../../modules/kds/kds.controller';
import { PrintersController } from '../../modules/printing/printers.controller';
import { TenantController } from '../../modules/tenant/tenant.controller';
import { PaymentController } from '../../modules/payment/payment.controller';
import { SettingsController } from '../../modules/settings/settings.controller';
import { CatalogController } from '../../modules/catalog/catalog.controller';

/**
 * Which routes carry an authority rule at all.
 *
 * The guard's own behaviour is covered next door; what was missing was any check that the
 * routes ask it anything. An audit found 133 of 234 mutating routes carrying no rule, so a
 * cashier could define a delivery zone, rewrite the dining floor, register a terminal or
 * set an approver's pin. A rule that a later edit silently drops is the same hole again,
 * which is why these read the metadata off the controllers rather than restating the list.
 */

type Handler = { name: string; roles?: string[]; headOfficeOnly?: boolean };

function authorityOf(controller: any, method: string): Handler {
  const fn = controller.prototype[method];
  if (!fn) throw new Error(`${controller.name} has no handler named ${method}`);
  return {
    name: `${controller.name}.${method}`,
    roles: Reflect.getMetadata(ROLES_KEY, fn),
    headOfficeOnly: Reflect.getMetadata(HEAD_OFFICE_ONLY_KEY, fn),
  };
}

/** Equipment and layout belonging to one shop: its manager's, never the register's. */
const SITE_CONFIG: [any, string[]][] = [
  [DeliveryController, ['createZone', 'deleteZone', 'createCourier']],
  [DineInController, ['createSection', 'updateSection', 'archiveSection', 'createTable', 'updateTable', 'archiveTable']],
  [KdsController, ['createStation', 'updateStation', 'deleteStation', 'createScreen', 'updateScreen', 'deleteScreen', 'createRoutingRule', 'deleteRoutingRule']],
  [PrintersController, ['createPrinter', 'updatePrinter', 'deletePrinter', 'createGroup', 'updateGroup', 'deleteGroup', 'createRoute', 'updateRoute', 'deleteRoute']],
  [TenantController, ['createTerminal', 'updateTerminal', 'archiveTerminal']],
  [PaymentController, ['createDevice']],
];

/** One decision for the whole chain, taken once, at head office. */
const CHAIN_CONFIG: [any, string[]][] = [
  [TenantController, ['updateTenantProfile', 'createBranch', 'updateBranch', 'archiveBranch', 'updateBranchHours']],
  [PaymentController, ['createSettlementAccount']],
  [SettingsController, ['createCurrency', 'updateCurrency', 'createPaymentMethod', 'updatePaymentMethod', 'createReasonCode', 'updateReasonCode']],
  [CatalogController, ['createProduct', 'updateProduct', 'createCategory', 'updateCategory']],
];

describe('authority declared on the routes', () => {
  describe('a site’s own configuration is the branch manager’s', () => {
    for (const [controller, methods] of SITE_CONFIG) {
      for (const method of methods) {
        it(`${controller.name}.${method} requires manager or above`, () => {
          const handler = authorityOf(controller, method);
          expect(handler.roles).toEqual(MANAGER_AND_ABOVE);
        });
      }
    }
  });

  describe('the chain’s configuration stays with head office', () => {
    for (const [controller, methods] of CHAIN_CONFIG) {
      for (const method of methods) {
        it(`${controller.name}.${method} is head office only`, () => {
          const handler = authorityOf(controller, method);
          expect(handler.headOfficeOnly).toBe(true);
        });
      }
    }
  });

  // A cashier holding an approver's pin defeats the entire reason for having one, and the
  // route used to take the target account straight from the request body.
  it('setting another account’s pin is not something a route decorator can express', () => {
    // The rule is conditional — your own pin is self-service — so it lives in the handler.
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../modules/approval/approval.controller.ts'),
      'utf8',
    );
    expect(source).toMatch(/isHeadOfficeUser/);
    expect(source).toMatch(/Only head office may set another account/);
  });
});
