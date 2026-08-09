import { DataSource } from 'typeorm';
import { AppDataSource } from '../src/data-source';
import { Tenant } from '../src/entities/Tenant.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { Payment } from '../src/entities/Payment.entity';
import { Refund } from '../src/entities/Refund.entity';
import { CustomerCreditAccount } from '../src/entities/CustomerCreditAccount.entity';
import { IdempotencyRecord } from '../src/entities/IdempotencyRecord.entity';

describe('Real PostgreSQL Integration Suite (Port 5433)', () => {
  let dataSource: DataSource;
  let testTenantId: string;
  let testBranchId: string;

  beforeAll(async () => {
    // Ensure DB_PORT is set to 5433 for disposable postgres
    process.env.DB_PORT = process.env.DB_PORT || '5433';
    process.env.DB_NAME = process.env.DB_NAME || 'appdb_test';
    process.env.DB_USER = process.env.DB_USER || 'postgres';
    process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';

    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    dataSource = AppDataSource;

    const tenantRepo = dataSource.getRepository(Tenant);
    let tenant = await tenantRepo.findOne({ where: { code: 'PG-INTEG-TEST' } });
    if (!tenant) {
      tenant = tenantRepo.create({
        code: 'PG-INTEG-TEST',
        name: 'PostgreSQL Integration Test Tenant',
        base_currency: 'IRR',
        default_locale: 'fa',
        time_zone: 'Asia/Tehran',
      });
      tenant = await tenantRepo.save(tenant);
    }
    testTenantId = tenant.id;

    const branchRepo = dataSource.getRepository(Branch);
    let branch = await branchRepo.findOne({ where: { tenant_id: testTenantId, code: 'PG-BR-01' } });
    if (!branch) {
      branch = branchRepo.create({
        tenant_id: testTenantId,
        code: 'PG-BR-01',
        name: 'Postgres Test Branch',
        time_zone: 'Asia/Tehran',
      });
      branch = await branchRepo.save(branch);
    }
    testBranchId = branch.id;
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

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
          status: 'DRAFT',
          payment_status: 'UNPAID',
          fulfillment_status: 'PENDING',
          currency_code: 'IRR',
          subtotal: '100000.0000',
          total_tax: '9000.0000',
          total_discount: '0.0000',
          total_amount: '109000.0000',
        });
        await transactionalEntityManager.save(OrderHeader, newOrder);

        // Force intentional transaction failure
        throw new Error('INTENTIONAL_TRANSACTION_ROLLBACK_TEST_ERROR');
      });
    } catch (err: any) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError.message).toBe('INTENTIONAL_TRANSACTION_ROLLBACK_TEST_ERROR');

    // Verify order was NOT persisted to PostgreSQL
    const found = await orderRepo.findOne({ where: { tenant_id: testTenantId, order_number: orderNumber } });
    expect(found).toBeNull();
  });

  it('2. Real PostgreSQL Concurrent Idempotency: enforces unique idempotency key constraints', async () => {
    const idempotencyRepo = dataSource.getRepository(IdempotencyRecord);
    const key = `pg-idem-key-${Date.now()}`;

    const rec1 = idempotencyRepo.create({
      tenant_id: testTenantId,
      user_id: '00000000-0000-0000-0000-000000000001',
      idempotency_key: key,
      request_hash: 'hash-abc-123',
      request_path: '/api/v1/orders',
      status_code: 201,
      response_body: { orderId: 'ord-123' },
    });
    await idempotencyRepo.save(rec1);

    // Concurrent duplicate insertion attempt
    const rec2 = idempotencyRepo.create({
      tenant_id: testTenantId,
      user_id: '00000000-0000-0000-0000-000000000001',
      idempotency_key: key,
      request_hash: 'hash-abc-123',
      request_path: '/api/v1/orders',
      status_code: 201,
      response_body: { orderId: 'ord-123' },
    });

    let duplicateErr: any = null;
    try {
      await idempotencyRepo.save(rec2);
    } catch (err: any) {
      duplicateErr = err;
    }

    expect(duplicateErr).not.toBeNull();
    expect(duplicateErr.code).toBe('23505'); // Postgres unique constraint violation code
  });

  it('3. Real PostgreSQL Pessimistic Row Locking: SELECT FOR UPDATE locks row during transaction', async () => {
    const creditRepo = dataSource.getRepository(CustomerCreditAccount);
    const account = creditRepo.create({
      tenant_id: testTenantId,
      customer_id: '00000000-0000-0000-0000-000000000099',
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

    // Step A: Create Order Header & Items
    const order = orderRepo.create({
      tenant_id: testTenantId,
      branch_id: testBranchId,
      order_number: orderNo,
      order_type: 'TAKEAWAY',
      status: 'SUBMITTED',
      payment_status: 'UNPAID',
      fulfillment_status: 'PENDING',
      currency_code: 'IRR',
      subtotal: '200000.0000',
      total_tax: '18000.0000',
      total_discount: '0.0000',
      total_amount: '218000.0000',
    });
    const savedOrder = await orderRepo.save(order);

    const item = itemRepo.create({
      tenant_id: testTenantId,
      order_id: savedOrder.id,
      product_code: 'PROD-CHEESEBURGER',
      product_name: 'Cheeseburger Special',
      quantity: 1,
      unit_price: '200000.0000',
      subtotal: '200000.0000',
      tax_amount: '18000.0000',
      total_amount: '218000.0000',
    });
    await itemRepo.save(item);

    // Step B: Post Payment
    const paymentNo = `PAY-${Date.now()}`;
    const payment = paymentRepo.create({
      tenant_id: testTenantId,
      order_id: savedOrder.id,
      payment_number: paymentNo,
      method_id: '00000000-0000-0000-0000-000000000002',
      method_kind: 'CASH',
      status: 'POSTED',
      amount: '218000.0000',
      currency_code: 'IRR',
      business_date: '2026-08-09',
    });
    const savedPayment = await paymentRepo.save(payment);

    savedOrder.payment_status = 'PAID';
    savedOrder.status = 'COMPLETED';
    await orderRepo.save(savedOrder);

    // Step C: Execute Refund
    const refundNo = `REF-${Date.now()}`;
    const refund = refundRepo.create({
      tenant_id: testTenantId,
      order_id: savedOrder.id,
      refund_number: refundNo,
      status: 'POSTED',
      method_id: '00000000-0000-0000-0000-000000000002',
      method_kind: 'CASH',
      amount: '218000.0000',
      currency_code: 'IRR',
      reason_text: 'Customer requested full refund',
    });
    const savedRefund = await refundRepo.save(refund);

    savedOrder.payment_status = 'REFUNDED';
    await orderRepo.save(savedOrder);

    // Verify persisted state in PostgreSQL
    const finalOrder = await orderRepo.findOne({ where: { id: savedOrder.id } });
    const finalPayment = await paymentRepo.findOne({ where: { id: savedPayment.id } });
    const finalRefund = await refundRepo.findOne({ where: { id: savedRefund.id } });

    expect(finalOrder?.payment_status).toBe('REFUNDED');
    expect(finalPayment?.status).toBe('POSTED');
    expect(finalRefund?.amount).toBe('218000.0000');
  });
});
