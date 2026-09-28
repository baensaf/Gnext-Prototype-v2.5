import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { Payment } from '../src/entities/Payment.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { PaymentController } from '../src/modules/payment/payment.controller';
import { deleteTenantData } from './utils/tenant-teardown';

// The Payments page used to read an audit route the server never served, so it was always
// empty. It now reads one page of the payments themselves, each with its order's number.
describe('payment list (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let controller: PaymentController;
  let tenantId: string;
  let branchA: string;
  let branchB: string;

  const at = (hour: number) => new Date(Date.UTC(2026, 8, 20, hour, 0, 0));
  const list = (query: any, userBranchId: string | null = null) =>
    controller.listPayments(query, { tenantId, userBranchId } as any) as Promise<any>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    controller = moduleRef.get(PaymentController);

    const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
    tenantId = (await save(Tenant, { code: `PLIST-${Date.now()}`, name: 'Payment list', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchA = (await save(Branch, { tenant_id: tenantId, code: 'PLA', name: 'A', is_active: true, time_zone: 'Asia/Tehran' })).id;
    branchB = (await save(Branch, { tenant_id: tenantId, code: 'PLB', name: 'B', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const methodId = (await save(PaymentMethod, { tenant_id: tenantId, code: 'CARD_POS', name: 'Card', kind: 'CARD_POS', is_active: true })).id;

    let seq = 0;
    const pay = async (branchId: string, orderNumber: string, postedAt: Date | null, extra: Partial<Payment> = {}) => {
      const order = await save(OrderHeader, {
        tenant_id: tenantId,
        branch_id: branchId,
        order_number: orderNumber,
        channel: 'POS',
        order_type: 'TAKEAWAY',
        state: 'COMPLETED',
        status: 'COMPLETED',
      });
      await save(Payment, {
        tenant_id: tenantId,
        order_id: order.id,
        payment_number: `PAY-PL-${++seq}`,
        method_id: methodId,
        method_kind: 'CARD',
        status: 'SUCCEEDED',
        amount: '150000.0000',
        currency_code: 'IRR',
        business_date: '2026-09-20',
        posted_at: postedAt,
        ...extra,
      });
    };

    await pay(branchA, 'ORD-A-1', at(9), { reference: 'RRN-111' });
    await pay(branchA, 'ORD-A-2', at(11));
    await pay(branchA, 'ORD-A-3', at(10), { method_kind: 'CASH' });
    await pay(branchB, 'ORD-B-1', at(12));
  }, 120000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it("lists a branch's payments newest first, with the order number and the page's fields", async () => {
    const res = await list({ branchId: branchA });
    expect(res.total).toBe(3);
    expect(res.data.map((p: any) => p.order_number)).toEqual(['ORD-A-2', 'ORD-A-3', 'ORD-A-1']);
    const oldest = res.data[2];
    expect(oldest).toMatchObject({ method_kind: 'CARD', status: 'SUCCEEDED', currency_code: 'IRR', reference: 'RRN-111' });
    expect(Number(oldest.amount)).toBe(150000);
    expect(oldest.payment_number).toMatch(/^PAY-PL-/);
    expect(oldest.posted_at).toBeTruthy();
  });

  it('pages through the list', async () => {
    const first = await list({ branchId: branchA, limit: '2' });
    const second = await list({ branchId: branchA, limit: '2', page: '2' });
    expect(first.total).toBe(3);
    expect(first.data).toHaveLength(2);
    expect(second.data.map((p: any) => p.order_number)).toEqual(['ORD-A-1']);
  });

  it('gives head office every branch when it names none', async () => {
    const res = await list({});
    expect(res.total).toBe(4);
    expect(res.data[0].order_number).toBe('ORD-B-1');
  });

  it("keeps a branch account to its own branch whatever it asks for", async () => {
    const res = await list({ branchId: branchB }, branchA);
    expect(res.total).toBe(3);
    expect(res.data.every((p: any) => p.branch_id === branchA)).toBe(true);
  });
});
