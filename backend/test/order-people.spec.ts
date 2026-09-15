import { OrderService } from '../src/modules/order/order.service';

describe('OrderService.getOrderPeople', () => {
  const tenantId = '11111111-1111-1111-1111-111111111111';
  let query: jest.Mock;
  let service: OrderService;

  beforeEach(() => {
    query = jest.fn();
    // Only the data source is read; building the whole service would drag in every dependency.
    service = Object.assign(Object.create(OrderService.prototype), { dataSource: { query } });
  });

  it('names the customer, the account that took the order and its courier', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM customer')) return [{ id: 'c1', code: 'CUST-1', first_name: 'Reza', last_name: 'M' }];
      if (sql.includes('FROM admin_user')) return [{ id: 'u1', username: 'cashier', display_name: 'Cashier' }];
      return [{ id: 'k1', code: 'CR-001', name: 'Ali' }];
    });

    const people = await service.getOrderPeople(tenantId, { id: 'o1', customer_id: 'c1', created_by: 'u1' });

    expect(people).toEqual({
      customer: { id: 'c1', code: 'CUST-1', first_name: 'Reza', last_name: 'M' },
      taken_by: { id: 'u1', username: 'cashier', display_name: 'Cashier' },
      courier: { id: 'k1', code: 'CR-001', name: 'Ali' },
    });
    for (const [, params] of query.mock.calls) expect(params[0]).toBe(tenantId);
  });

  it('skips the lookups an anonymous, undelivered order has nothing to look up for', async () => {
    query.mockResolvedValue([]);

    const people = await service.getOrderPeople(tenantId, { id: 'o1', customer_id: null, created_by: null });

    expect(people).toEqual({ customer: null, taken_by: null, courier: null });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
