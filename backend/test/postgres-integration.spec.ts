import { DataSource } from 'typeorm';
import { AppDataSource } from '../src/data-source';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { OrderHeader, OrderState } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { Payment } from '../src/entities/Payment.entity';
import { Refund } from '../src/entities/Refund.entity';
import { CustomerCreditAccount } from '../src/entities/CustomerCreditAccount.entity';
import { IdempotencyRecord } from '../src/entities/IdempotencyRecord.entity';
import { deleteTenantData } from './utils/tenant-teardown';

describe('Real PostgreSQL Integration Suite (Port 5433)', () => {
  let dataSource: DataSource;
  let testTenantId: string;
  let testBranchId: string;

  beforeAll(async () => {
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_NAME = process.env.DB_NAME || 'appdb';
    process.env.DB_USER = process.env.DB_USER || 'admin';
    process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'admin';

    (AppDataSource.options as any).port = parseInt(process.env.DB_PORT, 10);
    (AppDataSource.options as any).database = process.env.DB_NAME;
    (AppDataSource.options as any).username = process.env.DB_USER;
    (AppDataSource.options as any).password = process.env.DB_PASSWORD;

    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    dataSource = AppDataSource;

    await dataSource.runMigrations();

    const tenantRepo = dataSource.getRepository(Tenant);
    let tenant = await tenantRepo.findOne({ where: { code: 'PG-INTEG-TEST' } });
    if (!tenant) {
      tenant = tenantRepo.create({
        code: 'PG-INTEG-TEST',
        name: 'PostgreSQL Integration Test Store',
        base_currency: 'IRR',
        default_locale: 'fa',
        time_zone: 'Asia/Tehran',
      });
      tenant = await tenantRepo.save(tenant);
    }
    testTenantId = tenant.id;

    const branchRepo = dataSource.getRepository(Branch);
    let branch = await branchRepo.findOne({ where: { tenant_id: testTenantId, code: 'BR-PG-TEST' } });
    if (!branch) {
      branch = branchRepo.create({
        tenant_id: testTenantId,
        code: 'BR-PG-TEST',
        name: 'PostgreSQL Test Branch',
        is_active: true,
        time_zone: 'Asia/Tehran',
      });
      branch = await branchRepo.save(branch);
    }
    testBranchId = branch.id;
  }, 30000);

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      // This suite reuses one tenant by code rather than making a fresh one, so it grew an
      // order per run instead of a tenant per run. Every fixture here is find-or-create,
      // so clearing the tenant is safe — the next run builds it again.
      await deleteTenantData(AppDataSource, testTenantId);
      await AppDataSource.destroy();
    }
  }, 30000);

  it('1. Real PostgreSQL Transaction Rollback: rolls back all queries on transaction failure', async () => {
    const orderRepo = dataSource.getRepository(OrderHeader);
    const orderNumber = `TEST-ROLLBACK-${Date.now()}`;

    let caughtError: any = null;
    try {
      await dataSource.transaction(async (transactionalEntityManager) => {
        const newOrder = transactionalEntityManager.create(OrderHeader, {
          tenant_id: testTenantId,
          branch_id: testBranchId,
          order_number: orderNumber,
          order_type: 'DINE_IN',
          state: 'DRAFT' as OrderState,
          status: 'DRAFT',
          currency_code: 'IRR',
          subtotal: '100000.0000',
          tax_total: '9000.0000',
          discount_total: '0.0000',
          grand_total: '109000.0000',
          total_amount: '109000.0000',
        });
        await transactionalEntityManager.save(OrderHeader, newOrder);

        throw new Error('INTENTIONAL_TRANSACTION_ROLLBACK_TEST_ERROR');
      });
    } catch (err: any) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError.message).toBe('INTENTIONAL_TRANSACTION_ROLLBACK_TEST_ERROR');

    const found = await orderRepo.findOne({ where: { tenant_id: testTenantId, order_number: orderNumber } });
    expect(found).toBeNull();
  });

  it('2. Real PostgreSQL Concurrent Idempotency: enforces unique idempotency key constraints', async () => {
    const idempotencyRepo = dataSource.getRepository(IdempotencyRecord);
    const key = `pg-idem-key-${Date.now()}`;

    const hashVal = 'a'.repeat(64);
    const rec1 = idempotencyRepo.create({
      tenant_id: testTenantId,
      scope: 'ORDERS',
      key: key,
      request_hash: hashVal,
      status: 'SUCCEEDED',
      response_status: 201,
      response_body: { orderId: 'ord-123' },
      expires_at: new Date(Date.now() + 86400000),
    });
    await idempotencyRepo.save(rec1);

    const rec2 = idempotencyRepo.create({
      tenant_id: testTenantId,
      scope: 'ORDERS',
      key: key,
      request_hash: hashVal,
      status: 'SUCCEEDED',
      response_status: 201,
      response_body: { orderId: 'ord-123' },
      expires_at: new Date(Date.now() + 86400000),
    });

    let duplicateErr: any = null;
    try {
      await idempotencyRepo.save(rec2);
    } catch (err: any) {
      duplicateErr = err;
    }

    expect(duplicateErr).not.toBeNull();
    expect(duplicateErr.code).toBe('23505');
  });

  it('3. Real PostgreSQL Pessimistic Row Locking: SELECT FOR UPDATE locks row during transaction', async () => {
    const creditRepo = dataSource.getRepository(CustomerCreditAccount);
    const uniqueCustId = `00000000-0000-0000-0000-${Date.now().toString(16).slice(-12).padStart(12, '0')}`;
    const account = creditRepo.create({
      tenant_id: testTenantId,
      customer_id: uniqueCustId,
      currency_code: 'IRR',
      credit_limit: '1000000.0000',
      current_balance: '500000.0000',
      is_blocked: false,
    });
    const savedAccount = await creditRepo.save(account);

    await dataSource.transaction(async (tem) => {
      const lockedAccount = await tem.findOne(CustomerCreditAccount, {
        where: { id: savedAccount.id },
        lock: { mode: 'pessimistic_write' },
      });
      expect(lockedAccount).not.toBeNull();
      expect(lockedAccount?.current_balance).toBe('500000.0000');

      lockedAccount!.current_balance = '600000.0000';
      await tem.save(CustomerCreditAccount, lockedAccount!);
    });

    const reRead = await creditRepo.findOne({ where: { id: savedAccount.id } });
    expect(reRead?.current_balance).toBe('600000.0000');
  });

  it('4. Core Persisted Workflow: Order -> Payment -> Refund in real PostgreSQL database', async () => {
    const orderRepo = dataSource.getRepository(OrderHeader);
    const itemRepo = dataSource.getRepository(OrderItem);
    const paymentRepo = dataSource.getRepository(Payment);
    const refundRepo = dataSource.getRepository(Refund);

    const orderNo = `ORD-FLOW-${Date.now()}`;

    const orderToCreate = orderRepo.create({
      tenant_id: testTenantId,
      branch_id: testBranchId,
      order_number: orderNo,
      order_type: 'TAKEAWAY',
      state: 'SUBMITTED' as OrderState,
      status: 'SUBMITTED',
      currency_code: 'IRR',
      subtotal: '200000.0000',
      tax_total: '18000.0000',
      discount_total: '0.0000',
      grand_total: '218000.0000',
      total_amount: '218000.0000',
    });
    const savedOrder = await orderRepo.save(orderToCreate);

    const itemToCreate = itemRepo.create({
      tenant_id: testTenantId,
      order_id: savedOrder.id,
      product_id: '00000000-0000-0000-0000-000000000001',
      product_code: 'PROD-CHEESEBURGER',
      product_name: 'Cheeseburger Special',
      quantity: '1.0000',
      unit_price: '200000.0000',
      subtotal: '200000.0000',
      tax_amount: '18000.0000',
      total_amount: '218000.0000',
    });
    await itemRepo.save(itemToCreate);

    const paymentNo = `PAY-${Date.now()}`;
    const paymentToCreate = paymentRepo.create({
      tenant_id: testTenantId,
      order_id: savedOrder.id,
      payment_number: paymentNo,
      method_id: '00000000-0000-0000-0000-000000000002',
      method_kind: 'CASH',
      status: 'SUCCEEDED',
      amount: '218000.0000',
      currency_code: 'IRR',
      business_date: '2026-08-09',
    });
    const savedPayment = await paymentRepo.save(paymentToCreate);

    savedOrder.state = 'COMPLETED' as OrderState;
    savedOrder.status = 'COMPLETED';
    savedOrder.paid_total = '218000.0000';
    await orderRepo.save(savedOrder);

    const refundNo = `REF-${Date.now()}`;
    const refundToCreate = refundRepo.create({
      tenant_id: testTenantId,
      order_id: savedOrder.id,
      refund_number: refundNo,
      status: 'SUCCEEDED',
      method_id: '00000000-0000-0000-0000-000000000002',
      method_kind: 'CASH',
      amount: '218000.0000',
      currency_code: 'IRR',
      reason_text: 'Customer requested full refund',
    });
    const savedRefund = await refundRepo.save(refundToCreate);

    savedOrder.state = 'CANCELLED' as OrderState;
    savedOrder.status = 'CANCELLED';
    await orderRepo.save(savedOrder);

    const finalOrder = await orderRepo.findOne({ where: { id: savedOrder.id } });
    const finalPayment = await paymentRepo.findOne({ where: { id: savedPayment.id } });
    const finalRefund = await refundRepo.findOne({ where: { id: savedRefund.id } });

    expect(finalOrder?.state).toBe('CANCELLED');
    expect(finalPayment?.status).toBe('SUCCEEDED');
    expect(finalRefund?.amount).toBe('218000.0000');
  });

});
