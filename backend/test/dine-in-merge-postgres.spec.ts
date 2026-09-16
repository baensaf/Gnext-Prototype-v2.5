import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DineInService } from '../src/modules/dine-in/dine-in.service';
import { OrderService } from '../src/modules/order/order.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// Merging tables has to run against the real database: the bug it guards against lived in
// TypeORM's cascade, which a mocked EntityManager never exercises. On 2026-09-16 a merge
// cancelled the source bill and zeroed it, while saving that cancelled order cascaded its
// items straight back onto it — the merged table's food vanished from every bill.
describe('merging two tables onto one bill (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let dineIn: DineInService;
  let orders: OrderService;
  let tenantId: string;
  let branchId: string;
  let burgerId: string;
  let colaId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    dineIn = moduleRef.get(DineInService);
    orders = moduleRef.get(OrderService);

    const tenant = await dataSource.getRepository(Tenant).save(
      dataSource.getRepository(Tenant).create({
        code: `MERGE-${Date.now()}`,
        name: 'Table merge fixture',
        base_currency: 'IRR',
        default_locale: 'fa',
        time_zone: 'Asia/Tehran',
      }),
    );
    tenantId = tenant.id;
    const branch = await dataSource.getRepository(Branch).save(
      dataSource.getRepository(Branch).create({ tenant_id: tenantId, code: 'MRG', name: 'Merge branch', is_active: true, time_zone: 'Asia/Tehran' }),
    );
    branchId = branch.id;
    const category = await dataSource.getRepository(Category).save(
      dataSource.getRepository(Category).create({ tenant_id: tenantId, code: 'MRG-CAT', name: 'Food', is_active: true }),
    );
    const product = (code: string, price: string) =>
      dataSource.getRepository(Product).save(
        dataSource.getRepository(Product).create({ tenant_id: tenantId, category_id: category.id, code, name: code, base_price: price, tax_rate: '0.0900' }),
      );
    burgerId = (await product('MRG-BURGER', '250000.0000')).id;
    colaId = (await product('MRG-COLA', '30000.0000')).id;
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const placeOrder = async (productId: string, quantity: number) => {
    const draft = await orders.createDraft(tenantId, {
      branch_id: branchId,
      order_type: 'DINE_IN',
      items: [{ product_id: productId, quantity }],
    } as any);
    return orders.submitOrder(tenantId, draft.id, {} as any);
  };

  it('moves every line of the merged bill onto the target and bills the table for all of it', async () => {
    const target = await placeOrder(burgerId, 2);
    const source = await placeOrder(colaId, 1);

    await dineIn.mergeOrders(tenantId, { sourceOrderIds: [source.id], targetOrderId: target.id, reason: 'guests joined' });

    const itemsOn = async (orderId: string) =>
      dataSource.getRepository(OrderItem).find({ where: { tenant_id: tenantId, order_id: orderId, state: 'ACTIVE' } });
    expect(await itemsOn(source.id)).toHaveLength(0);
    expect((await itemsOn(target.id)).map((i) => i.product_id).sort()).toEqual([burgerId, colaId].sort());

    const merged = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: target.id });
    // 2 × 250,000 + 30,000 = 530,000, and 9% VAT on all of it.
    expect(merged.subtotal).toBe('530000.0000');
    expect(merged.tax_total).toBe('47700.0000');
    expect(merged.grand_total).toBe('577700.0000');
    expect(merged.outstanding_total).toBe('577700.0000');

    const cancelled = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id: source.id });
    expect(cancelled.state).toBe('CANCELLED');
    expect(cancelled.grand_total).toBe('0.0000');
    expect(cancelled.tax_total).toBe('0.0000');
  }, 60000);
});
