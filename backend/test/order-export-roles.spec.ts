import { ROLES_KEY, MANAGER_AND_ABOVE } from '../src/common/decorators/roles.decorator';
import { OrdersController } from '../src/modules/order/order.controller';

// The export is the branch's whole order book with customers' names and mobiles. The
// 2026-09-23 dispatch audit (OD12) found any cashier could download it.
describe('Order export', () => {
  it('is for a manager or head office, not every register', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, OrdersController.prototype.exportOrders);
    expect(roles).toEqual(MANAGER_AND_ABOVE);
    expect(roles).not.toContain('CASHIER');
  });
});
