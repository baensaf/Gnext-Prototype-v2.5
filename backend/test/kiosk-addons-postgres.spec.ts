import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { KioskService } from '../src/modules/kiosk/kiosk.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { OptionGroup } from '../src/entities/OptionGroup.entity';
import { OptionItem } from '../src/entities/OptionItem.entity';
import { ProductOptionGroup } from '../src/entities/ProductOptionGroup.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// A kiosk guest picks several toppings from a group that allows them, priced one by one,
// within the group's maximum, the same as the register.
describe('Kiosk add-on groups with several choices (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let kiosk: KioskService;
  let tenantId: string;
  let branchId: string;
  let pizza: string;
  let toppings: string[];
  let groupId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    kiosk = moduleRef.get(KioskService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (await save(Tenant, { code: `KADD-${Date.now()}`, name: 'Kiosk add-ons fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'KA1', name: 'Main', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const categoryId = (await save(Category, { tenant_id: tenantId, code: 'KA-PIZZA', name: 'Pizza', is_active: true })).id;
    pizza = (await save(Product, { tenant_id: tenantId, category_id: categoryId, code: 'PIZZA', name: 'Pizza', base_price: '300000.0000', tax_rate: '0.0000', is_active: true })).id;
    groupId = (await save(OptionGroup, { tenant_id: tenantId, code: 'TOPPINGS', name: 'Toppings', min_selection: 1, max_selection: 3, is_required: true })).id;
    toppings = [];
    for (const [code, delta] of [['OLIVES', '20000'], ['MUSHROOM', '30000'], ['PEPPER', '10000'], ['ONION', '5000']]) {
      toppings.push((await save(OptionItem, { tenant_id: tenantId, option_group_id: groupId, code, name: code, price_delta: `${delta}.0000`, is_active: true })).id);
    }
    await save(ProductOptionGroup, { tenant_id: tenantId, product_id: pizza, option_group_id: groupId });
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const order = (picks: string[]) =>
    kiosk.createKioskOrder(tenantId, {
      branch_id: branchId,
      order_type: 'TAKEAWAY',
      items: [{ product_id: pizza, quantity: 1, options: picks.map((id) => ({ option_group_id: groupId, option_item_id: id })) }],
    });

  it('offers the group with its limits on the kiosk menu', async () => {
    const menu = await kiosk.getBootstrapContext(tenantId, branchId);
    const group = menu.products.find((p: any) => p.id === pizza).option_groups[0];
    expect(group).toMatchObject({ min_selection: 1, max_selection: 3 });
    expect(group.items).toHaveLength(4);
  });

  it('takes several toppings from one group and charges each', async () => {
    const placed = await order(toppings.slice(0, 3));
    expect(placed.total_amount).toBe('360000.0000');
    expect(placed.items[0].modifier_total).toBe('60000.0000');
  });

  it("refuses more than the group's maximum, and none when one is required", async () => {
    await expect(order(toppings)).rejects.toThrow('at most 3');
    await expect(order([])).rejects.toThrow('needs a Toppings choice');
  });
});
