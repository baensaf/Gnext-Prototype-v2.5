import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { OrderService } from '../src/modules/order/order.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { ItemDiscountsService } from '../src/modules/discounts/item-discounts.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { loadBusinessClock } from '../src/common/utils/business-clock';
import { deleteTenantData } from './utils/tenant-teardown';

// A cart line keeps the prices, tax rate and item discount it had when the item was added,
// whatever head office changes before the order is sent (Catalog and Pricing PRD).
describe('Prices fixed when an item is added (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let orders: OrderService;
  let catalog: CatalogService;
  let discounts: ItemDiscountsService;
  let tenantId: string;
  let branchId: string;
  let burger: string;
  let cheese: string;
  let bacon: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    orders = moduleRef.get(OrderService);
    catalog = moduleRef.get(CatalogService);
    discounts = moduleRef.get(ItemDiscountsService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (await save(Tenant, { code: `PQ-${Date.now()}`, name: 'Price quotes', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'PQ', name: 'Main', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const mains = (await save(Category, { tenant_id: tenantId, code: 'PQ-MAINS', name: 'Mains', is_active: true })).id;
    burger = (await save(Product, { tenant_id: tenantId, category_id: mains, code: 'BURGER', name: 'Burger', base_price: '1000000.0000', tax_rate: '0.1000', is_active: true })).id;
    const group = await catalog.saveOptionGroup(
      tenantId,
      null,
      { name: 'Extras', min_selection: 0, max_selection: 2, items: [{ name: 'Cheese', price_delta: '100000' }, { name: 'Bacon', price_delta: '200000' }] },
      'test',
    );
    cheese = group.items.find((i: any) => i.name === 'Cheese').id;
    bacon = group.items.find((i: any) => i.name === 'Bacon').id;
    await catalog.setOfferedChoices(tenantId, burger, group.id, [cheese, bacon], 'test');
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const send = async (item: any) => {
    const draft = await orders.createDraft(tenantId, { branch_id: branchId, order_type: 'TAKEAWAY', items: [{ quantity: '1', ...item }] } as any);
    const [line] = await dataSource.getRepository(OrderItem).find({ where: { order_id: draft.id } });
    return line;
  };
  const setProduct = (data: Partial<Product>) => dataSource.getRepository(Product).update({ id: burger }, data);

  it('keeps the price and tax rate of the moment the item was added', async () => {
    const [quote] = await orders.priceQuotes(tenantId, branchId, [{ product_id: burger, option_item_ids: [cheese] }]);
    expect(quote).toMatchObject({ unit_price: '1000000.0000', options: { [cheese]: '100000.0000' }, tax_rate: '0.1000' });

    await setProduct({ base_price: '1500000.0000', tax_rate: '0.0900' });
    const line = await send({ product_id: burger, options: [{ option_item_id: cheese }], price_quote: quote.token });
    expect(line).toMatchObject({ unit_price: '1000000.0000', modifier_total: '100000.0000', tax_rate: '0.1000' });
  });

  it('prices a line now when its quote is missing, altered or for other add-ons', async () => {
    const [quote] = await orders.priceQuotes(tenantId, branchId, [{ product_id: burger }]);
    const forged = quote.token.replace(/^[^.]+/, Buffer.from(JSON.stringify({ ...quote, token: undefined, unit_price: '1.0000' })).toString('base64url'));
    expect(await send({ product_id: burger, price_quote: forged })).toMatchObject({ unit_price: '1500000.0000', tax_rate: '0.0900' });
    expect(await send({ product_id: burger, options: [{ option_item_id: bacon }], price_quote: quote.token })).toMatchObject({ unit_price: '1500000.0000' });
    expect(await send({ product_id: burger })).toMatchObject({ unit_price: '1500000.0000' });
  });

  it('keeps what an edited line already had and prices only what changed', async () => {
    await setProduct({ base_price: '1000000.0000' });
    const [first] = await orders.priceQuotes(tenantId, branchId, [{ product_id: burger, option_item_ids: [cheese] }]);
    await setProduct({ base_price: '1200000.0000' });
    await dataSource.query(`UPDATE option_item SET price_delta = 150000 WHERE id = $1`, [cheese]);
    const [edited] = await orders.priceQuotes(tenantId, branchId, [{ product_id: burger, option_item_ids: [cheese, bacon], previous: first.token }]);
    expect(edited).toMatchObject({ unit_price: '1000000.0000', options: { [cheese]: '100000.0000', [bacon]: '200000.0000' } });
  });

  it('keeps the item discount the line had when added, even after the discount ends', async () => {
    const today = (await loadBusinessClock(dataSource.manager, tenantId, branchId)).today();
    const discount = await discounts.create(tenantId, { product_ids: [burger], percent: 20, starts_on: today });
    const [quote] = await orders.priceQuotes(tenantId, branchId, [{ product_id: burger }]);
    expect(quote.item_discount_percent).toBe('20.00');
    await discounts.remove(tenantId, discount.id);
    expect(await send({ product_id: burger, price_quote: quote.token })).toMatchObject({ item_discount_percent: '20.00' });
  });
});
