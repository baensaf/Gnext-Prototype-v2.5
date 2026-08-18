import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RefundService } from '../src/modules/refund/refund.service';
import { Refund } from '../src/entities/Refund.entity';
import { RefundAllocation } from '../src/entities/RefundAllocation.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { Payment } from '../src/entities/Payment.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { ShiftService } from '../src/modules/cashier/shift.service';
import { CreditService } from '../src/modules/customer/credit.service';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';

describe('Refunds & Paid-Order Cancellation Suite (R16)', () => {
  let service: RefundService;
  let refundRepo: any;
  let allocRepo: any;
  let orderRepo: any;
  let itemRepo: any;
  let paymentRepo: any;
  let methodRepo: any;
  let shiftService: any;
  let creditService: any;
  let auditWriter: any;
  let dataSource: any;

  beforeEach(async () => {
    refundRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn() };
    allocRepo = { create: jest.fn(), save: jest.fn() };
    orderRepo = { findOne: jest.fn(), save: jest.fn() };
    itemRepo = { find: jest.fn().mockResolvedValue([]) };
    paymentRepo = { find: jest.fn().mockResolvedValue([]) };
    methodRepo = { findOne: jest.fn() };
    shiftService = { getCurrentShift: jest.fn(), recordCashRefundMovement: jest.fn() };
    creditService = { getAccountByCustomer: jest.fn(), postRepayment: jest.fn(), reverseLoyaltyCashback: jest.fn().mockResolvedValue(true) };
    auditWriter = { write: jest.fn() };

    const mockQueryBuilder: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    };

    const entityStore = new Map<string, any>();

    const mockEntityManager: any = {
      create: jest.fn((entityClass, data) => {
        const id = data.id || `mock-ref-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
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
        if (entityClass === Refund) {
          const targetId = options?.where?.id;
          if (targetId && entityStore.has(targetId)) return entityStore.get(targetId);
          return await refundRepo.findOne(options);
        }
        if (entityClass === PaymentMethod) return await methodRepo.findOne(options);
        return null;
      }),
      find: jest.fn(async (entityClass, options) => {
        if (entityClass === Payment) return await paymentRepo.find(options);
        if (entityClass === Refund) return await refundRepo.find(options);
        return [];
      }),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    dataSource = {
      transaction: jest.fn(async (cb) => await cb(mockEntityManager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundService,
        { provide: getRepositoryToken(Refund), useValue: refundRepo },
        { provide: getRepositoryToken(RefundAllocation), useValue: allocRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: itemRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(PaymentMethod), useValue: methodRepo },
        { provide: ShiftService, useValue: shiftService },
        { provide: CreditService, useValue: creditService },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<RefundService>(RefundService);
  });

  describe('Refundable Balance & Allocation Rules (R16)', () => {
    it('should throw BadRequestException if requested refund amount exceeds remaining refundable balance', async () => {
      const order = { id: 'ord-1', state: 'COMPLETED', refunded_total: '0.0000' };
      const payment = { id: 'pay-1', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-cash' };
      const method = { id: 'pm-cash', kind: 'CASH', is_active: true };

      orderRepo.findOne.mockResolvedValue(order);
      paymentRepo.find.mockResolvedValue([payment]);
      methodRepo.findOne.mockResolvedValue(method);

      // Available = 50,000. Attempting refund of 60,000
      await expect(
        service.createRefundIntent('t-1', 'ord-1', { amount: '60000.0000', reason: 'Customer return' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for ordinary refund on non-COMPLETED order', async () => {
      const order = { id: 'ord-1', state: 'SUBMITTED', refunded_total: '0.0000' };
      orderRepo.findOne.mockResolvedValue(order);

      await expect(
        service.createRefundIntent('t-1', 'ord-1', { amount: '10000.0000', reason: 'Customer return' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Alternative Method Policy (R16)', () => {
    it('should throw ForbiddenException if alternative method refund lacks approved approvalRequestId', async () => {
      const order = { id: 'ord-1', state: 'COMPLETED', refunded_total: '0.0000' };
      const posPayment = { id: 'pay-pos', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-pos' };
      const cashMethod = { id: 'pm-cash', kind: 'CASH', is_active: true };

      orderRepo.findOne.mockResolvedValue(order);
      paymentRepo.find.mockResolvedValue([posPayment]);
      methodRepo.findOne.mockResolvedValue(cashMethod);

      // Attempting POS-to-CASH refund without approvalRequestId
      await expect(
        service.createRefundIntent('t-1', 'ord-1', {
          amount: '50000.0000',
          reason: 'Alternative tender refund',
          targetMethodId: 'pm-cash',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Paid-Order Cancellation Orchestration (R16)', () => {
    it('should process refund before cancelling order during paid order cancellation', async () => {
      const order = { id: 'ord-1', state: 'SUBMITTED', refunded_total: '0.0000', currency_code: 'IRR', terminal_id: 'term-1' };
      const cashPayment = { id: 'pay-1', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-cash' };
      const cashMethod = { id: 'pm-cash', kind: 'CASH', is_active: true };

      orderRepo.findOne.mockResolvedValue(order);
      paymentRepo.find.mockResolvedValue([cashPayment]);
      methodRepo.findOne.mockResolvedValue(cashMethod);
      shiftService.getCurrentShift.mockResolvedValue({ id: 'shf-1' });

      const cancelledOrder = await service.cancelPaidOrder('t-1', 'ord-1', { reason: 'Out of stock' });
      expect(cancelledOrder.state).toBe('CANCELLED');
      expect(shiftService.recordCashRefundMovement).toHaveBeenCalled();
    });
  });

  describe('FIN-01 & FIN-02 Integrity Tests', () => {
    it('FIN-02: should accurately calculate refundable balance when some payments are REVERSED without double-subtraction', async () => {
      const order = { id: 'ord-multi-pay', state: 'COMPLETED', refunded_total: '0.0000' };
      const payments = [
        { id: 'pay-succeeded', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-cash' },
        { id: 'pay-reversed', amount: '30000.0000', status: 'REVERSED', method_id: 'pm-card' },
      ];
      const method = { id: 'pm-cash', kind: 'CASH', is_active: true };

      orderRepo.findOne.mockResolvedValue(order);
      paymentRepo.find.mockResolvedValue(payments);
      methodRepo.findOne.mockResolvedValue(method);

      // Refundable balance must be 50,000 (succeeded payments minus refunds), NOT 20,000 (which would be double-subtracting 30,000 reversals)
      const refundIntent = await service.createRefundIntent('t-1', 'ord-multi-pay', {
        amount: '50000.0000',
        reason: 'Customer return for succeeded portion',
      });

      expect(refundIntent).toBeDefined();
      expect(refundIntent.amount).toBe('50000.0000');
    });

    it('FIN-01: should pass active entityManager to creditService when processing CUSTOMER_CREDIT refund', async () => {
      const order = {
        id: 'ord-credit-ref',
        customer_id: 'cust-1',
        terminal_id: 'term-1',
        state: 'COMPLETED',
        refunded_total: '0.0000',
        subtotal: '50000.0000',
        currency_code: 'IRR',
      };
      const creditAccount = {
        id: 'acc-cust-1',
        tenant_id: 't-1',
        customer_id: 'cust-1',
        currency_code: 'IRR',
        current_balance: '-50000.0000',
        status: 'ACTIVE',
      };
      const payment = { id: 'pay-cred', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-credit' };
      const creditMethod = { id: 'pm-credit', kind: 'CUSTOMER_CREDIT', is_active: true };

      orderRepo.findOne.mockResolvedValue(order);
      paymentRepo.find.mockResolvedValue([payment]);
      methodRepo.findOne.mockResolvedValue(creditMethod);
      creditService.getAccountByCustomer.mockResolvedValue(creditAccount);
      creditService.postRepayment.mockResolvedValue({ entry: { id: 'entry-1' }, newBalance: '0.0000' });

      const refund = await service.createRefundIntent('t-1', 'ord-credit-ref', {
        amount: '50000.0000',
        reason: 'Customer credit refund test',
      });

      const processed = await service.processRefund('t-1', refund.id, {});

      expect(processed.status).toBe('SUCCEEDED');
      expect(creditService.getAccountByCustomer).toHaveBeenCalledWith('t-1', 'cust-1', 'IRR', expect.anything());
      expect(creditService.postRepayment).toHaveBeenCalledWith(
        't-1',
        'acc-cust-1',
        expect.objectContaining({ amount: '50000.0000' }),
        undefined,
        undefined,
        expect.anything(), // Verify entityManager is passed
      );
    });
  });
});
