import { DataSource } from 'typeorm';
import { Customer } from '../../src/entities/Customer.entity';
import { CustomerAddress } from '../../src/entities/CustomerAddress.entity';
import { DeliveryZone } from '../../src/entities/DeliveryZone.entity';

/**
 * A customer, their address and a free zone at the branch, so a test can ring a delivery order.
 * Since 2026-10-24 only a delivery that has not gone out takes line changes (O-22), and a takeaway
 * or dine-in order waits for its payment before the kitchen sees it (O-19). The zone costs
 * nothing, so totals read as they would on a counter order.
 */
export async function deliveryFixture(dataSource: DataSource, tenantId: string, branchId: string) {
  const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
  const tag = `${Date.now()}`.slice(-7);
  const customer = await save(Customer, { tenant_id: tenantId, code: `DLV-${tag}`, first_name: 'Delivery', last_name: 'Customer', mobile: `0912${tag}` });
  const address = await save(CustomerAddress, { tenant_id: tenantId, customer_id: customer.id, title: 'Home', address_text: 'Test street', is_default: true });
  const zone = await save(DeliveryZone, { tenant_id: tenantId, branch_id: branchId, code: `Z-${tag}`, name: 'Test zone', fee: '0.0000', estimated_minutes: 30, is_active: true });
  return {
    order_type: 'DELIVERY' as const,
    customer_id: customer.id as string,
    delivery_address_id: address.id as string,
    delivery_zone_id: zone.id as string,
  };
}
