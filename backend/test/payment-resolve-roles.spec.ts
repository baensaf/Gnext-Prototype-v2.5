import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { PaymentController } from '../src/modules/payment/payment.controller';

// The person at the till holds the terminal's slip, so a cashier answers a card charge the
// terminal never confirmed; it used to wait for a manager (feedback 5, 2026-10-12). The audit
// entry names who answered.
describe('Answering a card charge waiting on the terminal', () => {
  it('is open to the cashier, not only to a manager', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PaymentController.prototype.resolveTerminal)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, PaymentController)).toBeUndefined();
  });

  it('is the same door as asking the terminal again', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PaymentController.prototype.checkTerminal)).toBeUndefined();
  });
});
