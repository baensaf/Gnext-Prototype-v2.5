import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaymentService } from '../src/modules/payment/payment.service';
import { Payment } from '../src/entities/Payment.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { PaymentAllocation } from '../src/entities/PaymentAllocation.entity';
import { PaymentAttempt } from '../src/entities/PaymentAttempt.entity';
import { PaymentDevice } from '../src/entities/PaymentDevice.entity';
import { SettlementAccount } from '../src/entities/SettlementAccount.entity';
import { ShiftService } from '../src/modules/cashier/shift.service';
import { CreditService } from '../src/modules/customer/credit.service';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';

describe('Payments & Split Settlement Suite (R15)', () => {
  let service: PaymentService;
  let paymentRepo: any;
  let orderRepo: any;
  let methodRepo: any;
  let allocRepo: any;
  let attemptRepo: any;
  let deviceRepo: any;
  let accountRepo: any;
  let shiftService: any;
  let creditService: any;
  let auditWriter: any;
  let dataSource: any;

  beforeEach(async () => {
    paymentRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn() };
    orderRepo = { findOne: jest.fn(), save: jest.fn() };
    methodRepo = { findOne: jest.fn() };
    allocRepo = { create: jest.fn(), save: jest.fn() };
    attemptRepo = { create: jest.fn(), save: jest.fn() };
    deviceRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn() };
    accountRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), find: jest.fn().mockResolvedValue([]) };
    shiftService = { getCurrentShift: jest.fn(), recordCashPaymentMovement: jest.fn() };
    creditService = {
      getAccountByCustomer: jest.fn(),
      assertCustomerPurchaseAllowed: jest.fn(),
      postPurchase: jest.fn(),
      reversePurchase: jest.fn(),
    };
    auditWriter = { write: jest.fn() };

    const mockQueryBuilder: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    };

    const entityStore = new Map<string, any>();

    const mockEntityManager: any = {
      create: jest.fn((entityClass, data) => {
        const id = data.id || `mock-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
        const entity = { id, ...data };
        entityStore.set(id, entity);
        return entity;
      }),
      save: jest.fn((entityClass, data) => {
        const entity = data || entityClass;
        if (entity && entity.id) entityStore.set(entity.id, entity);
        return Promise.resolve(entity);
      }),
      findOne: jest.fn(async (entityClass, options) => {
        if (entityClass === OrderHeader) return await orderRepo.findOne(options);
        if (entityClass === Payment) {
          if (Array.isArray(options?.where)) {
            const mockPay = await paymentRepo.findOne(options);
            if (mockPay && (mockPay.status === 'PENDING' || mockPay.status === 'PROCESSING')) {
              return mockPay;
            }
            return null;
          }
          const targetId = options?.where?.id;
          if (targetId && entityStore.has(targetId)) return entityStore.get(targetId);
          return await paymentRepo.findOne(options);
        }
        if (entityClass === PaymentMethod) return await methodRepo.findOne(options);
        if (entityClass === PaymentDevice) return await deviceRepo.findOne(options);
        return null;
      }),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    dataSource = {
      transaction: jest.fn(async (cb) => await cb(mockEntityManager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(PaymentMethod), useValue: methodRepo },
        { provide: getRepositoryToken(PaymentAllocation), useValue: allocRepo },
        { provide: getRepositoryToken(PaymentAttempt), useValue: attemptRepo },
        { provide: getRepositoryToken(PaymentDevice), useValue: deviceRepo },
        { provide: getRepositoryToken(SettlementAccount), useValue: accountRepo },
        { provide: ShiftService, useValue: shiftService },
        { provide: CreditService, useValue: creditService },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  describe('Active Intent & Idempotency Rules (R15)', () => {
    it('should throw ConflictException if an active payment intent (PENDING/PROCESSING) exists', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 'ord-1', state: 'SUBMITTED', outstanding_total: '100000.0000' });
      paymentRepo.findOne.mockResolvedValue({ id: 'pay-active', payment_number: 'PAY-1', status: 'PENDING' });

      await expect(
        service.createPaymentIntent('t-1', { orderId: 'ord-1', methodId: 'pm-1', amount: '50000.0000' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should return existing payment record if idempotencyKey matches', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 'ord-1', state: 'SUBMITTED', outstanding_total: '100000.0000' });
      paymentRepo.findOne
        .mockResolvedValueOnce(null) // no active intent check
        .mockResolvedValueOnce({ id: 'pay-idempotent', idempotency_key: 'ik-123', status: 'PENDING' }); // idempotency match

      const result = await service.createPaymentIntent('t-1', {
        orderId: 'ord-1',
        methodId: 'pm-1',
        amount: '50000.0000',
        idempotencyKey: 'ik-123',
      });
      expect(result.id).toBe('pay-idempotent');
    });
  });

  describe('Atomic Postings & Split Failure Isolation (R15)', () => {
    it('should process cash payment successfully, record cash shift movement, and update order paid_total', async () => {
      const payment = { id: 'pay-1', tenant_id: 't-1', order_id: 'ord-1', method_kind: 'CASH', amount: '50000.0000', status: 'PENDING', currency_code: 'IRR' };
      const order = { id: 'ord-1', grand_total: '100000.0000', paid_total: '0.0000', outstanding_total: '100000.0000', state: 'SUBMITTED' };

      paymentRepo.findOne.mockResolvedValue(payment);
      orderRepo.findOne.mockResolvedValue(order);
      shiftService.getCurrentShift.mockResolvedValue({ id: 'shf-1' });

      const result = await service.processPayment('t-1', 'pay-1', {});
      expect(result.status).toBe('SUCCEEDED');
      expect(shiftService.recordCashPaymentMovement).toHaveBeenCalled();
      expect(order.paid_total).toBe('50000.0000');
      expect(order.outstanding_total).toBe('50000.0000');
    });

    it('should retain earlier successful tender (Cash) when a later tender (POS) fails', async () => {
      const posPayment = { id: 'pay-pos', tenant_id: 't-1', order_id: 'ord-1', method_kind: 'POS', amount: '50000.0000', status: 'PENDING', attempts: [] };
      const order = { id: 'ord-1', grand_total: '100000.0000', paid_total: '50000.0000', outstanding_total: '50000.0000', state: 'SUBMITTED' };

      paymentRepo.findOne.mockResolvedValue(posPayment);
      orderRepo.findOne.mockResolvedValue(order);

      const result = await service.processPayment('t-1', 'pay-pos', { scenarioId: 'DECLINED' });
      expect(result.status).toBe('FAILED');
      // Order paid_total remains 50,000.0000 from earlier cash success!
      expect(order.paid_total).toBe('50000.0000');
      expect(order.outstanding_total).toBe('50000.0000');
    });
  });

  describe('Customer Credit Intent Precheck', () => {
    const creditOrder = {
      id: 'ord-1',
      state: 'SUBMITTED',
      customer_id: 'cust-1',
      currency_code: 'IRR',
      outstanding_total: '100000.0000',
      business_date: '2026-09-09',
    };

    it('should reject an over-limit credit tender before creating the intent', async () => {
      orderRepo.findOne.mockResolvedValue(creditOrder);
      paymentRepo.findOne.mockResolvedValue(null);
      methodRepo.findOne.mockResolvedValue({ id: 'pm-credit', kind: 'CUSTOMER_CREDIT', is_active: true });
      creditService.assertCustomerPurchaseAllowed.mockRejectedValue(
        new ForbiddenException({ statusCode: 403, error: 'CREDIT_LIMIT_EXCEEDED', message: 'over limit' }),
      );

      await expect(
        service.createPaymentIntent('t-1', { orderId: 'ord-1', methodId: 'pm-credit', amount: '50000.0000' }),
      ).rejects.toThrow(ForbiddenException);

      expect(creditService.assertCustomerPurchaseAllowed).toHaveBeenCalledWith(
        't-1',
        'cust-1',
        'IRR',
        '50000.0000',
        undefined,
        expect.anything(),
      );
    });

    it('should reject a credit tender on an order with no customer', async () => {
      orderRepo.findOne.mockResolvedValue({ ...creditOrder, customer_id: null });
      paymentRepo.findOne.mockResolvedValue(null);
      methodRepo.findOne.mockResolvedValue({ id: 'pm-credit', kind: 'CUSTOMER_CREDIT', is_active: true });

      await expect(
        service.createPaymentIntent('t-1', { orderId: 'ord-1', methodId: 'pm-credit', amount: '50000.0000' }),
      ).rejects.toThrow(BadRequestException);
      expect(creditService.assertCustomerPurchaseAllowed).not.toHaveBeenCalled();
    });

    it('should create the intent when the customer has enough credit', async () => {
      orderRepo.findOne.mockResolvedValue(creditOrder);
      paymentRepo.findOne.mockResolvedValue(null);
      methodRepo.findOne.mockResolvedValue({ id: 'pm-credit', kind: 'CUSTOMER_CREDIT', is_active: true });
      creditService.assertCustomerPurchaseAllowed.mockResolvedValue({ id: 'acc-1' });

      const intent = await service.createPaymentIntent('t-1', {
        orderId: 'ord-1',
        methodId: 'pm-credit',
        amount: '50000.0000',
      });

      expect(intent.status).toBe('PENDING');
      expect(intent.method_kind).toBe('CUSTOMER_CREDIT');
    });

    it('should not run the credit precheck for other tenders', async () => {
      orderRepo.findOne.mockResolvedValue(creditOrder);
      paymentRepo.findOne.mockResolvedValue(null);
      methodRepo.findOne.mockResolvedValue({ id: 'pm-cash', kind: 'CASH', is_active: true });

      await service.createPaymentIntent('t-1', { orderId: 'ord-1', methodId: 'pm-cash', amount: '50000.0000' });

      expect(creditService.assertCustomerPurchaseAllowed).not.toHaveBeenCalled();
    });
  });

  describe('Customer Credit Reversal', () => {
    it('should give the customer their credit back when a CUSTOMER_CREDIT payment is reversed', async () => {
      const payment = {
        id: 'pay-cred',
        tenant_id: 't-1',
        order_id: 'ord-1',
        payment_number: 'PAY-9',
        method_kind: 'CUSTOMER_CREDIT',
        amount: '50000.0000',
        status: 'SUCCEEDED',
      };
      const order = { id: 'ord-1', grand_total: '100000.0000', paid_total: '50000.0000', outstanding_total: '50000.0000' };

      paymentRepo.findOne.mockResolvedValue(payment);
      orderRepo.findOne.mockResolvedValue(order);

      const result = await service.reversePayment('t-1', 'pay-cred', { reason: 'Cashier error' });

      expect(result.status).toBe('REVERSED');
      expect(order.paid_total).toBe('0.0000');
      expect(creditService.reversePurchase).toHaveBeenCalledWith(
        't-1',
        'pay-cred',
        expect.stringContaining('Cashier error'),
        undefined,
        undefined,
        expect.anything(), // reversal shares the payment's transaction
      );
    });

    it('should not touch the credit ledger when a non-credit payment is reversed', async () => {
      const payment = {
        id: 'pay-pos',
        tenant_id: 't-1',
        order_id: 'ord-1',
        payment_number: 'PAY-10',
        method_kind: 'POS',
        amount: '50000.0000',
        status: 'SUCCEEDED',
      };
      const order = { id: 'ord-1', grand_total: '100000.0000', paid_total: '50000.0000', outstanding_total: '50000.0000' };

      paymentRepo.findOne.mockResolvedValue(payment);
      orderRepo.findOne.mockResolvedValue(order);

      await service.reversePayment('t-1', 'pay-pos', { reason: 'Duplicate tender' });

      expect(creditService.reversePurchase).not.toHaveBeenCalled();
    });
  });

  describe('Payment Correction Flow (R15)', () => {
    it('should perform payment correction linking original and replacement with correction_group_id', async () => {
      const origPayment = { id: 'pay-orig', tenant_id: 't-1', order_id: 'ord-1', status: 'SUCCEEDED', amount: '50000.0000' };
      const order = { id: 'ord-1', grand_total: '100000.0000', paid_total: '50000.0000', outstanding_total: '50000.0000' };
      const method = { id: 'pm-new', is_active: true, kind: 'CASH' };

      paymentRepo.findOne.mockImplementation(async (options: any) => {
        if (options?.where?.id === 'pay-orig') return origPayment;
        return null;
      });
      orderRepo.findOne.mockResolvedValue(order);
      methodRepo.findOne.mockResolvedValue(method);
      shiftService.getCurrentShift.mockResolvedValue({ id: 'shf-1' });

      const correction = await service.correctPayment('t-1', 'pay-orig', {
        reason: 'Wrong payment method select',
        replacementMethodId: 'pm-new',
      });

      expect(correction.correctionGroupId).toBeDefined();
      expect(correction.originalPayment.status).toBe('REVERSED');
    });
  });
});
