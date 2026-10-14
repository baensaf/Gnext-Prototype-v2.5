import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { OrderAdjustment } from '../src/entities/OrderAdjustment.entity';
import { ShiftService } from '../src/modules/cashier/shift.service';
import { OrderService } from '../src/modules/order/order.service';
import { deleteTenantData } from './utils/tenant-teardown';

// An order discount on a sent order that is edited afterwards (2026-10-14): a percent stays a
// percent of what is left, and tax is charged on the lines after their share of the discount,
// as it is when the order is first sent.
describe('Order discount after an edit (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: OrderService;
  let tenantId: string;
  let branchId: string;
  let terminalId: string;
  let shiftId: string;
  let burger: string;
  let cola: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    orders = moduleRef.get(OrderService);
    const shifts = moduleRef.get(ShiftService);

    const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
    tenantId = (await save(Tenant, { code: `ODISC-${Date.now()}`, name: 'Order discount', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'OD1', name: 'Nasr', is_active: true, time_zone: 'Asia/Tehran' })).id;
    terminalId = (await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'OD-1', name: 'Till 1', terminal_type: 'CASHIER', is_active: true })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'OD-MAINS', name: 'Mains', is_active: true })).id;
    // 10% tax on both, so a discount that is not taken off before tax shows up in the total.
    burger = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'BURGER', name: 'Burger', base_price: '100000.0000', tax_rate: '0.1000', is_active: true })).id;
    cola = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'COLA', name: 'Cola', base_price: '30000.0000', tax_rate: '0.1000', is_active: true })).id;
    shiftId = ((await shifts.openShift(tenantId, { terminalId } as any)) as any).id;
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  /** Two burgers and a cola (230,000 before tax), sent with the given order discount. */
  const sentOrder = async (manualDiscount: { calculation_type: 'PERCENTAGE' | 'FIXED_AMOUNT'; value: string }) => {
    const draft = await orders.createDraft(tenantId, {
      branch_id: branchId,
      terminal_id: terminalId,
      shift_id: shiftId,
      order_type: 'TAKEAWAY',
      channel: 'POS',
      items: [
        { product_id: burger, quantity: 2 },
        { product_id: cola, quantity: 1 },
      ],
    } as any);
    await orders.submitOrder(tenantId, draft.id, { manualDiscount } as any, undefined, undefined, 'MANAGER');
    return draft.id;
  };

  const voidCola = async (orderId: string) => {
    const line = await dataSource.getRepository(OrderItem).findOneByOrFail({ order_id: orderId, product_id: cola });
    await orders.editOrder(tenantId, orderId, {
      changes: { void: [{ orderItemId: line.id, reasonCodeId: randomUUID() }] },
      reason: 'Customer changed their mind',
    } as any);
    return dataSource.getRepository(OrderHeader).findOneByOrFail({ id: orderId });
  };

  it('keeps a percent discount a percent of what is left, and taxes the discounted lines', async () => {
    const id = await sentOrder({ calculation_type: 'PERCENTAGE', value: '10' });
    const sent = await dataSource.getRepository(OrderHeader).findOneByOrFail({ id });
    // 10% of 230,000; tax 10% of 207,000.
    expect(sent.discount_total).toBe('23000.0000');
    expect(sent.tax_total).toBe('20700.0000');
    expect(sent.grand_total).toBe('227700.0000');

    const edited = await voidCola(id);
    // 10% of the 200,000 left; tax 10% of 180,000.
    expect(edited.discount_total).toBe('20000.0000');
    expect(edited.tax_total).toBe('18000.0000');
    expect(edited.grand_total).toBe('198000.0000');

    const adjustment = await dataSource.getRepository(OrderAdjustment).findOneByOrFail({ order_id: id, source_type: 'MANUAL' });
    expect(adjustment.amount).toBe('20000.0000');
  });

  it('keeps a fixed discount, taking it off before tax', async () => {
    const id = await sentOrder({ calculation_type: 'FIXED_AMOUNT', value: '50000' });

    const edited = await voidCola(id);
    // 200,000 less 50,000; tax 10% of 150,000.
    expect(edited.discount_total).toBe('50000.0000');
    expect(edited.tax_total).toBe('15000.0000');
    expect(edited.grand_total).toBe('165000.0000');
  });
});
