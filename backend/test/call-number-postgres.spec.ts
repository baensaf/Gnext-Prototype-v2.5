import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { assignCallNumber, CALL_NUMBER_SETTING_KEY, nthInRange, readCallNumberRanges } from '../src/modules/order/call-number';
import { deleteTenantData } from './utils/tenant-teardown';

// The number a branch calls an order by: per branch, per business day, from its set's range,
// and never the same number twice for two orders standing at once.
describe('order call numbers (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let tenantId: string;
  let branchA: string;
  let branchB: string;
  let seq = 0;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
    tenantId = (await save(Tenant, { code: `CALLNO-${Date.now()}`, name: 'Call numbers', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchA = (await save(Branch, { tenant_id: tenantId, code: 'CNA', name: 'A', is_active: true, time_zone: 'Asia/Tehran' })).id;
    branchB = (await save(Branch, { tenant_id: tenantId, code: 'CNB', name: 'B', is_active: true, time_zone: 'Asia/Tehran' })).id;
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const order = async (branchId: string, fields: Partial<OrderHeader>, businessDate = '2026-09-22') => {
    const repo = dataSource.getRepository(OrderHeader);
    return await repo.save(
      repo.create({ tenant_id: tenantId, branch_id: branchId, order_number: `CN-${Date.now()}-${++seq}`, business_date: businessDate, ...fields }),
    );
  };
  const numberFor = async (branchId: string, fields: Partial<OrderHeader>, businessDate?: string) =>
    assignCallNumber(dataSource.manager, await order(branchId, fields, businessDate));
  const TILL_TAKEAWAY = { channel: 'POS', order_type: 'TAKEAWAY' };

  it('counts on-site and remote orders in their own sets, and each branch on its own', async () => {
    expect(await numberFor(branchA, TILL_TAKEAWAY)).toBe(100);
    expect(await numberFor(branchA, { channel: 'KIOSK', order_type: 'DINE_IN' })).toBe(101);
    expect(await numberFor(branchA, { channel: 'POS', order_type: 'DELIVERY' })).toBe(500);
    expect(await numberFor(branchA, { channel: 'AGGREGATOR', order_type: 'AGGREGATOR', aggregator_expedition: 'DELIVERY' })).toBe(501);
    expect(await numberFor(branchA, { channel: 'AGGREGATOR', order_type: 'AGGREGATOR', aggregator_expedition: 'PICKUP' })).toBe(102);
    expect(await numberFor(branchB, TILL_TAKEAWAY)).toBe(100);
  });

  it('starts again the next business day', async () => {
    expect(await numberFor(branchA, TILL_TAKEAWAY, '2026-09-23')).toBe(100);
  });

  it('keeps the number an order was first given', async () => {
    const o = await order(branchA, TILL_TAKEAWAY, '2026-09-24');
    const first = await assignCallNumber(dataSource.manager, o);
    const again = await assignCallNumber(dataSource.manager, { ...o, call_number: null } as any);
    expect(again).toBe(first);
  });

  it("uses head office's ranges, and wraps back to the start when one runs out", async () => {
    await dataSource.getRepository(TenantSetting).save({
      tenant_id: tenantId,
      branch_id: null,
      key: CALL_NUMBER_SETTING_KEY,
      value: { ranges: { ON_SITE: { start: 10, end: 11 } } },
    } as any);
    const day = '2026-09-25';
    expect([await numberFor(branchA, TILL_TAKEAWAY, day), await numberFor(branchA, TILL_TAKEAWAY, day), await numberFor(branchA, TILL_TAKEAWAY, day)]).toEqual([10, 11, 10]);
  });

  it('ignores a range that makes no sense', () => {
    expect(readCallNumberRanges({ ranges: { ON_SITE: { start: 500, end: 100 } } }).ON_SITE).toEqual({ start: 100, end: 499 });
    expect(nthInRange(401, { start: 100, end: 499 })).toBe(100);
  });
});
