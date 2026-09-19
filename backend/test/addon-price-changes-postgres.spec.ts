import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource, IsNull, Not } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { PriceChangeService } from '../src/modules/catalog/price-changes.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { OptionGroup } from '../src/entities/OptionGroup.entity';
import { OptionItem } from '../src/entities/OptionItem.entity';
import { PriceEntry } from '../src/entities/PriceEntry.entity';
import { BusinessDateUtil } from '../src/common/utils/business-date.util';
import { deleteTenantData } from './utils/tenant-teardown';

// Price changes on add-ons: "+10% on extras from tomorrow", chain-wide, dated, cancellable,
// and applied to the add-on's price once they start. Free add-ons stay free.
describe('Add-on price changes (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let catalog: CatalogService;
  let changes: PriceChangeService;
  let tenantId: string;
  let extras: string;
  let sauces: string;
  let cheese: string;
  let bacon: string;
  let noOnion: string;
  let mayo: string;

  const tomorrow = () => BusinessDateUtil.today(new Date(Date.now() + 24 * 3600 * 1000));
  const priceOf = async (id: string) => (await dataSource.getRepository(OptionItem).findOneByOrFail({ id })).price_delta;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    catalog = moduleRef.get(CatalogService);
    changes = moduleRef.get(PriceChangeService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (await save(Tenant, { code: `APCH-${Date.now()}`, name: 'Add-on price fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    extras = (await save(OptionGroup, { tenant_id: tenantId, code: 'EXTRAS', name: 'Extras', min_selection: 0, max_selection: 3 })).id;
    sauces = (await save(OptionGroup, { tenant_id: tenantId, code: 'SAUCES', name: 'Sauces', min_selection: 0, max_selection: 1 })).id;
    const item = async (groupId: string, code: string, delta: string) =>
      (await save(OptionItem, { tenant_id: tenantId, option_group_id: groupId, code, name: code, price_delta: delta })).id;
    cheese = await item(extras, 'CHEESE', '20000.0000');
    bacon = await item(extras, 'BACON', '35000.0000');
    noOnion = await item(extras, 'NO-ONION', '0.0000');
    mayo = await item(sauces, 'MAYO', '5000.0000');
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const tenPercent = { target: 'ADDONS' as const, adjustment: 'PERCENT' as const, value: 10, round_to: 1000 };

  it('previews every priced add-on, rounded up, and leaves free ones out', async () => {
    const preview = await changes.preview(tenantId, tenPercent);
    expect(preview.items.map((i) => [i.name, i.current, i.new])).toEqual([
      ['Extras — BACON', '35000.0000', '39000.0000'],
      ['Extras — CHEESE', '20000.0000', '22000.0000'],
      ['Sauces — MAYO', '5000.0000', '6000.0000'],
    ]);
    expect(preview.items.some((i) => i.option_item_id === noOnion)).toBe(false);

    const onlyExtras = await changes.preview(tenantId, { ...tenPercent, option_group_id: extras });
    expect(onlyExtras.items.map((i) => i.option_item_id).sort()).toEqual([bacon, cheese].sort());
  });

  it('refuses a price list on an add-on change: add-on prices are chain-wide', async () => {
    await expect(changes.preview(tenantId, { ...tenPercent, price_list_id: '00000000-0000-0000-0000-000000000001' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ADDON_PRICES_CHAIN_WIDE' }),
    });
  });

  it('keeps the old price until the start date, and a change called off leaves nothing behind', async () => {
    const job = await changes.commit(tenantId, { ...tenPercent, option_group_id: extras, effective_date: tomorrow() }, null, 'corr');
    expect(job).toMatchObject({ status: 'SCHEDULED', items: 2, target: 'ADDONS', option_group_id: extras });
    await changes.applyDueBaseChanges(tenantId);
    expect(await priceOf(cheese)).toBe('20000.0000');

    // A later change previews from the price the first one sets on that day.
    const next = await changes.preview(tenantId, { target: 'ADDONS', option_group_id: extras, adjustment: 'AMOUNT', value: 1000, effective_date: tomorrow() });
    expect(next.items.find((i) => i.option_item_id === cheese)).toMatchObject({ current: '22000.0000', new: '23000.0000' });

    await changes.cancel(tenantId, job.id, null, 'corr');
    expect(await dataSource.getRepository(PriceEntry).count({ where: { tenant_id: tenantId, bulk_job_id: job.id } })).toBe(0);
  });

  it('charges a change from today at once, and a price typed on the add-on afterwards wins', async () => {
    await changes.commit(tenantId, { ...tenPercent, option_group_id: sauces }, null, 'corr');
    expect(await priceOf(mayo)).toBe('6000.0000');
    expect(await priceOf(cheese)).toBe('20000.0000');

    await catalog.updateOptionItem(tenantId, sauces, mayo, { price_delta: '7000' }, 'corr');
    await changes.applyDueBaseChanges(tenantId);
    expect(await priceOf(mayo)).toBe('7000.0000');
    const live = await dataSource.getRepository(PriceEntry).find({ where: { tenant_id: tenantId, modifier_option_id: mayo, effective_to: IsNull(), product_id: IsNull() } });
    expect(live).toHaveLength(0);
    expect(await dataSource.getRepository(PriceEntry).count({ where: { tenant_id: tenantId, modifier_option_id: Not(IsNull()) } })).toBe(1);
  });
});
