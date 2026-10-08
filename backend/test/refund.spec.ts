import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
  let em: any;

  beforeEach(async () => {
    refundRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn() };
    allocRepo = { create: jest.fn(), save: jest.fn() };
    orderRepo = { findOne: jest.fn(), save: jest.fn() };
    itemRepo = { find: jest.fn().mockResolvedValue([]) };
    paymentRepo = { find: jest.fn().mockResolvedValue([]) };
    methodRepo = { findOne: jest.fn() };
    shiftService = {
      getCurrentShift: jest.fn().mockResolvedValue(null),
      requireCurrentShift: jest.fn(),
      requireDrawer: jest.fn(),
      resolveDrawer: jest.fn().mockResolvedValue({ id: 'shf-1' }),
      recordCashRefundMovement: jest.fn(),
    };
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

    em = mockEntityManager;
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
      shiftService.requireDrawer.mockResolvedValue({ id: 'shf-1' });

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

    it('reverses loyalty cashback against the order total, not the user id', async () => {
      const order = {
        id: 'ord-cashback',
        customer_id: 'cust-1',
        terminal_id: 'term-1',
        state: 'COMPLETED',
        refunded_total: '0.0000',
        total_amount: '10746000.0000',
        currency_code: 'IRR',
      };
      orderRepo.findOne.mockResolvedValue(order);
      paymentRepo.find.mockResolvedValue([{ id: 'pay-1', amount: '10746000.0000', status: 'SUCCEEDED', method_id: 'pm-cash' }]);
      methodRepo.findOne.mockResolvedValue({ id: 'pm-cash', kind: 'CASH', is_active: true });
      shiftService.requireDrawer.mockResolvedValue({ id: 'shift-1' });
      shiftService.recordCashRefundMovement = jest.fn().mockResolvedValue(undefined);

      const refund = await service.createRefundIntent('t-1', 'ord-cashback', { amount: '1000000.0000', reason: 'Late order' }, 'user-uuid', 'corr-1');
      await service.processRefund('t-1', refund.id, {}, 'user-uuid', 'corr-1');

      expect(creditService.reverseLoyaltyCashback).toHaveBeenCalledWith(
        't-1',
        'ord-cashback',
        '1000000.0000',
        '10746000.0000',
        'IRR',
        expect.anything(),
      );
    });

    it('pays a card sale back card-to-card on the refund PIN, out of no drawer but on the till shift', async () => {
      orderRepo.findOne.mockResolvedValue({
        id: 'ord-card',
        terminal_id: 'term-1',
        state: 'COMPLETED',
        refunded_total: '0.0000',
        total_amount: '8066000.0000',
        currency_code: 'IRR',
      });
      paymentRepo.find.mockResolvedValue([{ id: 'pay-1', amount: '8066000.0000', status: 'SUCCEEDED', method_id: 'pm-card' }]);
      methodRepo.findOne.mockImplementation(async ({ where }: any) =>
        where.id === 'pm-transfer'
          ? { id: 'pm-transfer', kind: 'BANK_TRANSFER', is_active: true }
          : { id: 'pm-card', kind: 'CARD_POS', is_active: true, allows_alternative_refund: true },
      );
      shiftService.recordCashRefundMovement = jest.fn();

      const refund = await service.createRefundIntent(
        't-1',
        'ord-card',
        { amount: '1000000', reason: 'Cold', targetMethodId: 'pm-transfer', reference: 'TR-1', moneyOutAuthorized: true },
        'user-uuid',
        'corr-1',
      );
      const done: any = await service.processRefund('t-1', refund.id, {}, 'user-uuid', 'corr-1');

      expect(done.method_kind).toBe('BANK_TRANSFER');
      expect(done.shift_id).toBe('shf-1');
      expect(shiftService.recordCashRefundMovement).not.toHaveBeenCalled();
    });
  });

  describe('Refund audit fixes (2026-10-08)', () => {
    const cardMethod = { id: 'pm-card', name: 'Card', kind: 'CARD_POS', is_active: true, allows_alternative_refund: true };
    const cashMethod = { id: 'pm-cash', name: 'Cash', kind: 'CASH', is_active: true };
    const creditMethod = { id: 'pm-credit', name: 'Store credit', kind: 'CUSTOMER_CREDIT', is_active: true };
    const methods: Record<string, any> = { 'pm-card': cardMethod, 'pm-cash': cashMethod, 'pm-credit': creditMethod };

    beforeEach(() => {
      methodRepo.findOne.mockImplementation(async ({ where }: any) => methods[where.id] ?? null);
    });

    it('does not pay out a refund once another has given the order back', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 'ord-1', state: 'COMPLETED', refunded_total: '0.0000', currency_code: 'IRR' });
      paymentRepo.find.mockResolvedValue([{ id: 'pay-1', amount: '272500.0000', status: 'SUCCEEDED', method_id: 'pm-card' }]);

      const first = await service.createRefundIntent('t-1', 'ord-1', { full: true, reason: 'A' });
      // Another refund of the whole order settles in between.
      refundRepo.find.mockImplementation(async ({ where }: any) =>
        where.status === 'SUCCEEDED' ? [{ id: 'other', amount: '272500.0000', status: 'SUCCEEDED' }] : [],
      );

      await expect(service.processRefund('t-1', first.id, {})).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'REFUND_EXCEEDS_BALANCE' }),
      });
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('checks the drawer before a cash refund exists, so a closed till leaves nothing behind', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 'ord-1', state: 'COMPLETED', refunded_total: '0.0000', terminal_id: 't' });
      paymentRepo.find.mockResolvedValue([{ id: 'pay-1', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-cash' }]);
      shiftService.requireDrawer.mockRejectedValue(new ConflictException({ code: 'NO_OPEN_SHIFT' }));

      await expect(service.refundOrder('t-1', 'ord-1', { full: true, reason: 'Cold' })).rejects.toBeInstanceOf(ConflictException);
      expect(auditWriter.write).not.toHaveBeenCalled();
    });

    it('takes a cash refund of a split order out of the cash payment first', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 'ord-split', state: 'COMPLETED', refunded_total: '0.0000', terminal_id: 't' });
      paymentRepo.find.mockResolvedValue([
        { id: 'pay-card', amount: '5246000.0000', status: 'SUCCEEDED', method_id: 'pm-card' },
        { id: 'pay-cash', amount: '5000000.0000', status: 'SUCCEEDED', method_id: 'pm-cash' },
      ]);
      shiftService.requireDrawer.mockResolvedValue({ id: 'shf-1' });

      const refund: any = await service.createRefundIntent('t-1', 'ord-split', {
        amount: '6000000',
        reason: 'Wrong order',
        targetMethodId: 'pm-cash',
        moneyOutAuthorized: true,
      });

      // 5,000,000 from the cash payment, only the remaining 1,000,000 from the card one.
      expect(refund.is_alternative_method).toBe(true);
      const allocs = em.create.mock.calls.filter(([cls]: any[]) => cls === RefundAllocation).map(([, data]: any[]) => data);
      expect(allocs.map((a: any) => [a.payment_id, a.amount])).toEqual([
        ['pay-cash', '5000000.0000'],
        ['pay-card', '1000000.0000'],
      ]);
    });

    it('refuses paying a sale back another way when its method does not allow it', async () => {
      methods['pm-card'] = { ...cardMethod, allows_alternative_refund: false };
      orderRepo.findOne.mockResolvedValue({ id: 'ord-1', state: 'COMPLETED', refunded_total: '0.0000', terminal_id: 't' });
      paymentRepo.find.mockResolvedValue([{ id: 'pay-1', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-card' }]);
      shiftService.requireDrawer.mockResolvedValue({ id: 'shf-1' });

      const refused = await service
        .createRefundIntent('t-1', 'ord-1', { full: true, reason: 'Cold', targetMethodId: 'pm-cash', moneyOutAuthorized: true })
        .catch((e) => e);
      expect(refused).toBeInstanceOf(BadRequestException);
      expect(refused.getResponse()).toEqual(expect.objectContaining({ code: 'REFUND_METHOD_NOT_ALLOWED' }));
      methods['pm-card'] = cardMethod;
    });

    it('refuses a sale whose method allows no refund at all', async () => {
      methods['pm-cash'] = { ...cashMethod, allows_refund: false };
      orderRepo.findOne.mockResolvedValue({ id: 'ord-1', state: 'COMPLETED', refunded_total: '0.0000', terminal_id: 't' });
      paymentRepo.find.mockResolvedValue([{ id: 'pay-1', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-cash' }]);

      const refused = await service.createRefundIntent('t-1', 'ord-1', { full: true, reason: 'Cold' }).catch((e) => e);
      expect(refused.getResponse()).toEqual(expect.objectContaining({ code: 'REFUND_METHOD_NOT_ALLOWED' }));
      methods['pm-cash'] = cashMethod;
    });

    it('checks an approval id against this order rather than trusting it', async () => {
      const approvalService = { validateApprovedRequest: jest.fn().mockRejectedValue(new ForbiddenException('other order')) };
      (service as any).approvalService = approvalService;
      orderRepo.findOne.mockResolvedValue({ id: 'ord-1', state: 'COMPLETED', refunded_total: '0.0000', terminal_id: 't' });
      paymentRepo.find.mockResolvedValue([{ id: 'pay-1', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-card' }]);

      await expect(
        service.createRefundIntent('t-1', 'ord-1', {
          full: true,
          reason: 'Cold',
          targetMethodId: 'pm-cash',
          approvalRequestId: '00000000-0000-4000-8000-000000000000',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(approvalService.validateApprovedRequest).toHaveBeenCalledWith(
        't-1',
        '00000000-0000-4000-8000-000000000000',
        'REFUND_ALTERNATIVE_METHOD',
        undefined,
        'ord-1',
      );
    });

    it('pays a card sale back to store credit, opening an account with no credit to buy on', async () => {
      orderRepo.findOne.mockResolvedValue({
        id: 'ord-1',
        customer_id: 'cust-1',
        state: 'COMPLETED',
        refunded_total: '0.0000',
        total_amount: '50000.0000',
        currency_code: 'IRR',
        terminal_id: 't',
      });
      paymentRepo.find.mockResolvedValue([{ id: 'pay-1', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-card' }]);
      creditService.getAccountByCustomer.mockResolvedValue(null);
      creditService.postRepayment.mockResolvedValue({});

      const done: any = await service.refundOrder(
        't-1',
        'ord-1',
        { full: true, reason: 'Cold', targetMethodId: 'pm-credit' },
        { userId: 'cashier', approvedBy: 'manager' },
      );

      expect(done.status).toBe('SUCCEEDED');
      expect(done.method_kind).toBe('CUSTOMER_CREDIT');
      expect(creditService.postRepayment).toHaveBeenCalledWith(
        't-1',
        expect.anything(),
        expect.objectContaining({ amount: '50000.0000', preApproved: true }),
        'cashier',
        undefined,
        expect.anything(),
      );
      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFUND_SUCCEEDED', details: { approvedBy: 'manager' } }),
      );
    });

    it('lists only the refunds of the branch asked about', async () => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'r-1', order_id: 'o-1' }], 1]),
      };
      refundRepo.createQueryBuilder.mockReturnValue(qb);
      orderRepo.find = jest.fn().mockResolvedValue([{ id: 'o-1', order_number: 'ORD-1', total_amount: '100.0000' }]);

      const res = await service.getRefunds('t-1', { limit: '100000' }, 'branch-1');

      expect(qb.innerJoin).toHaveBeenCalledWith(expect.anything(), 'o', expect.stringContaining('o.branch_id = :branchId'), {
        branchId: 'branch-1',
      });
      expect(qb.take).toHaveBeenCalledWith(200);
      expect(res.data[0]).toEqual(expect.objectContaining({ order_number: 'ORD-1', order_total: '100.0000' }));
    });
  });
});
