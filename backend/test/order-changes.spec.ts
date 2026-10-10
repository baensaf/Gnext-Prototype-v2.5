import { NotFoundException } from '@nestjs/common';
import { OrderService } from '../src/modules/order/order.service';

describe('OrderService.getOrderChanges', () => {
  const tenantId = '11111111-1111-1111-1111-111111111111';
  let findOrder: jest.Mock;
  let findEvents: jest.Mock;
  let service: OrderService;

  beforeEach(() => {
    findOrder = jest.fn();
    findEvents = jest.fn();
    // Only the order repository and its manager are read; the whole service is not built.
    service = Object.assign(Object.create(OrderService.prototype), {
      orderRepo: { findOne: findOrder, manager: { find: findEvents } },
    });
  });

  it("returns the order's audit entries for its own tenant, with secrets masked", async () => {
    findOrder.mockResolvedValue({ id: 'o1' });
    findEvents.mockResolvedValue([
      { id: 'a1', action: 'ORDER_EDITED', occurred_at: new Date(), details: { reason: 'typo', pin: '2468' }, before_data: null, after_data: null },
    ]);

    const changes = await service.getOrderChanges(tenantId, 'o1');

    expect(changes).toHaveLength(1);
    expect(changes[0].action).toBe('ORDER_EDITED');
    expect(changes[0].details).toEqual({ reason: 'typo', pin: '***MASKED***' });
    expect(findOrder.mock.calls[0][0].where).toEqual({ id: 'o1', tenant_id: tenantId });
    expect(findEvents.mock.calls[0][1].where).toEqual({ tenant_id: tenantId, entity_id: 'o1' });
  });

  it('answers an order of another tenant as if it did not exist', async () => {
    findOrder.mockResolvedValue(null);
    await expect(service.getOrderChanges(tenantId, 'o9')).rejects.toBeInstanceOf(NotFoundException);
    expect(findEvents).not.toHaveBeenCalled();
  });
});
