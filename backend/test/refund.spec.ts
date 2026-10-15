import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RefundService } from '../src/modules/refund/refund.service';
import { Refund } from '../src/entities/Refund.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { AuditEvent } from '../src/entities/AuditEvent.entity';
import { RefundAllocation } from '../src/entities/RefundAllocation.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { Payment } from '../src/entities/Payment.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { ShiftService } from '../src/modules/cashier/shift.service';
import { CreditService } from '../src/modules/customer/credit.service';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { TaraPayService } from '../src/modules/tara/tara-pay.service';

describe('Refunds & Paid-Order Cancellation Suite (R16, simplified 2026-10-10)', () => {
  let service: RefundService;
  let refundRepo: any;
  let orderRepo: any;
  let auditRepo: any;
  let userRepo: any;
  let paymentRepo: any;
  let methodRepo: any;
  let allocations: any[];
  let shiftService: any;
  let creditService: any;
  let auditWriter: any;
  let dataSource: any;
  let em: any;

  const cashMethod = { id: 'pm-cash', name: 'Cash', kind: 'CASH', is_active: true };
  const cardMethod = { id: 'pm-card', name: 'Card', kind: 'CARD_POS', is_active: true };
  const creditMethod = { id: 'pm-credit', name: 'Store credit', kind: 'CUSTOMER_CREDIT', is_active: true };
  const methods: Record<string, any> = { 'pm-card': cardMethod, 'pm-cash': cashMethod, 'pm-credit': creditMethod };

  const completedOrder = (extra: Record<string, any> = {}) => ({
    id: 'ord-1',
    state: 'COMPLETED',
    refunded_total: '0.0000',
    total_amount: '100000.0000',
    currency_code: 'IRR',
    terminal_id: 'term-1',
    ...extra,
  });

  beforeEach(async () => {
    refundRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn() };
    orderRepo = { findOne: jest.fn(), save: jest.fn() };
    auditRepo = { find: jest.fn().mockResolvedValue([]) };
    userRepo = { find: jest.fn().mockResolvedValue([]) };
    paymentRepo = { find: jest.fn().mockResolvedValue([]) };
    methodRepo = { findOne: jest.fn().mockImplementation(async ({ where }: any) => methods[where.id] ?? null) };
    allocations = [];
    shiftService = {
      requireDrawer: jest.fn(),
      resolveDrawer: jest.fn().mockResolvedValue({ id: 'shf-1' }),
      recordCashRefundMovement: jest.fn(),
    };
    creditService = { reversePurchase: jest.fn().mockResolvedValue(null), reverseLoyaltyCashback: jest.fn().mockResolvedValue(true) };
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
        if (entityClass === RefundAllocation) return allocations;
        return [];
      }),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      // The number counter (order_sequence upsert).
      query: jest.fn().mockResolvedValue([{ last_value: 1 }]),
    };

    em = mockEntityManager;
    dataSource = {
      transaction: jest.fn(async (cb) => await cb(mockEntityManager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundService,
        { provide: getRepositoryToken(Refund), useValue: refundRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(AuditEvent), useValue: auditRepo },
        { provide: getRepositoryToken(AdminUser), useValue: userRepo },
        { provide: ShiftService, useValue: shiftService },
        { provide: CreditService, useValue: creditService },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: DataSource, useValue: dataSource },
        // Tara is not on these orders; its services are not reached.
        { provide: TaraPayService, useValue: {} },
      ],
    }).compile();

    service = module.get<RefundService>(RefundService);
  });

  describe('What can be refunded', () => {
    it('refuses an order that is not COMPLETED', async () => {
      orderRepo.findOne.mockResolvedValue(completedOrder({ state: 'SUBMITTED' }));

      await expect(service.refundOrder('t-1', 'ord-1', { reason: 'Customer return' })).rejects.toThrow(BadRequestException);
    });

    it('refuses a refund with no reason', async () => {
      orderRepo.findOne.mockResolvedValue(completedOrder());
      paymentRepo.find.mockResolvedValue([{ id: 'pay-1', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-cash' }]);

      await expect(service.refundOrder('t-1', 'ord-1', { reason: '' })).rejects.toThrow('mandatory reason');
    });

    it('refuses an order that has nothing left to give back', async () => {
      orderRepo.findOne.mockResolvedValue(completedOrder());
      paymentRepo.find.mockResolvedValue([{ id: 'pay-1', amount: '272500.0000', status: 'SUCCEEDED', method_id: 'pm-card' }]);
      // An earlier refund already gave the whole payment back.
      refundRepo.find.mockResolvedValue([{ id: 'done', status: 'SUCCEEDED' }]);
      allocations = [{ refund_id: 'done', payment_id: 'pay-1', amount: '272500.0000' }];

      await expect(service.refundOrder('t-1', 'ord-1', { reason: 'Again' })).rejects.toThrow('no refundable balance');
      expect(em.save).not.toHaveBeenCalled();
    });

    it('checks the drawer before a cash refund exists, so a closed till leaves nothing behind', async () => {
      orderRepo.findOne.mockResolvedValue(completedOrder());
      paymentRepo.find.mockResolvedValue([{ id: 'pay-1', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-cash' }]);
      shiftService.requireDrawer.mockRejectedValue(new ConflictException({ code: 'NO_OPEN_SHIFT' }));

      await expect(service.refundOrder('t-1', 'ord-1', { reason: 'Cold' })).rejects.toBeInstanceOf(ConflictException);
      expect(auditWriter.write).not.toHaveBeenCalled();
      expect(em.save).not.toHaveBeenCalled();
    });
  });

  describe('Giving the money back by the methods it came in by', () => {
    it('pays a cash sale back out of the drawer', async () => {
      orderRepo.findOne.mockResolvedValue(completedOrder());
      paymentRepo.find.mockResolvedValue([{ id: 'pay-1', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-cash' }]);
      shiftService.requireDrawer.mockResolvedValue({ id: 'shf-1' });

      const refunds = await service.refundOrder('t-1', 'ord-1', { reason: 'Cold' }, { userId: 'cashier' });

      expect(refunds).toHaveLength(1);
      expect(refunds[0]).toEqual(expect.objectContaining({ method_kind: 'CASH', amount: '50000.0000', status: 'SUCCEEDED', shift_id: 'shf-1' }));
      expect(shiftService.recordCashRefundMovement).toHaveBeenCalledWith('t-1', 'shf-1', refunds[0].id, '50000.0000', 'cashier', em);
    });

    it('refunds a split sale as one refund per payment, cash from the drawer and the card by card', async () => {
      orderRepo.findOne.mockResolvedValue(completedOrder({ total_amount: '10246000.0000' }));
      paymentRepo.find.mockResolvedValue([
        { id: 'pay-card', amount: '5246000.0000', status: 'SUCCEEDED', method_id: 'pm-card' },
        { id: 'pay-cash', amount: '5000000.0000', status: 'SUCCEEDED', method_id: 'pm-cash' },
      ]);
      shiftService.requireDrawer.mockResolvedValue({ id: 'shf-1' });

      const refunds = await service.refundOrder('t-1', 'ord-1', { reason: 'Wrong order' });

      expect(refunds.map((r) => [r.method_id, r.method_kind, r.amount])).toEqual([
        ['pm-card', 'CARD_POS', '5246000.0000'],
        ['pm-cash', 'CASH', '5000000.0000'],
      ]);
      // Only the cash payment comes out of the drawer; each refund keeps its own payment.
      expect(shiftService.recordCashRefundMovement).toHaveBeenCalledTimes(1);
      expect(shiftService.recordCashRefundMovement).toHaveBeenCalledWith('t-1', 'shf-1', refunds[1].id, '5000000.0000', undefined, em);
      const allocs = em.create.mock.calls.filter(([cls]: any[]) => cls === RefundAllocation).map(([, data]: any[]) => data);
      expect(allocs.map((a: any) => [a.payment_id, a.amount])).toEqual([
        ['pay-card', '5246000.0000'],
        ['pay-cash', '5000000.0000'],
      ]);
      expect(em.save).toHaveBeenCalledWith(OrderHeader, expect.objectContaining({ refunded_total: '10246000.0000' }));
    });

    it('does not count a reversed payment among the money to give back', async () => {
      orderRepo.findOne.mockResolvedValue(completedOrder());
      paymentRepo.find.mockResolvedValue([
        { id: 'pay-succeeded', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-cash' },
        { id: 'pay-reversed', amount: '30000.0000', status: 'REVERSED', method_id: 'pm-card' },
      ]);
      shiftService.requireDrawer.mockResolvedValue({ id: 'shf-1' });

      const refunds = await service.refundOrder('t-1', 'ord-1', { reason: 'Customer return for succeeded portion' });

      expect(refunds.map((r) => r.amount)).toEqual(['50000.0000']);
    });

    it('books a card refund on the till shift without touching the drawer', async () => {
      orderRepo.findOne.mockResolvedValue(completedOrder());
      paymentRepo.find.mockResolvedValue([{ id: 'pay-1', amount: '8066000.0000', status: 'SUCCEEDED', method_id: 'pm-card' }]);

      const [refund] = await service.refundOrder('t-1', 'ord-1', { reason: 'Cold' });

      expect(refund.method_kind).toBe('CARD_POS');
      expect(refund.shift_id).toBe('shf-1');
      expect(shiftService.requireDrawer).not.toHaveBeenCalled();
      expect(shiftService.recordCashRefundMovement).not.toHaveBeenCalled();
    });

    it('gives a credit sale back to the customer by unwinding the purchase the payment made', async () => {
      orderRepo.findOne.mockResolvedValue(completedOrder({ customer_id: 'cust-1' }));
      paymentRepo.find.mockResolvedValue([{ id: 'pay-cred', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-credit' }]);

      const [refund] = await service.refundOrder('t-1', 'ord-1', { reason: 'Cold' }, { userId: 'cashier', correlationId: 'corr-1' });

      expect(refund.method_kind).toBe('CUSTOMER_CREDIT');
      expect(creditService.reversePurchase).toHaveBeenCalledWith('t-1', 'pay-cred', expect.stringContaining(refund.refund_number), 'cashier', 'corr-1', em);
    });

    it('reverses loyalty cashback against the order total, not the user id', async () => {
      orderRepo.findOne.mockResolvedValue(completedOrder({ id: 'ord-cashback', customer_id: 'cust-1', total_amount: '10746000.0000' }));
      paymentRepo.find.mockResolvedValue([{ id: 'pay-1', amount: '10746000.0000', status: 'SUCCEEDED', method_id: 'pm-cash' }]);
      shiftService.requireDrawer.mockResolvedValue({ id: 'shift-1' });

      await service.refundOrder('t-1', 'ord-cashback', { reason: 'Late order' }, { userId: 'user-uuid', correlationId: 'corr-1' });

      expect(creditService.reverseLoyaltyCashback).toHaveBeenCalledWith(
        't-1',
        'ord-cashback',
        '10746000.0000',
        '10746000.0000',
        'IRR',
        expect.anything(),
      );
    });

    it('records who released the money on each refund', async () => {
      orderRepo.findOne.mockResolvedValue(completedOrder());
      paymentRepo.find.mockResolvedValue([{ id: 'pay-1', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-card' }]);

      await service.refundOrder('t-1', 'ord-1', { reason: 'Cold' }, { userId: 'cashier', approvedBy: 'manager' });

      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFUND_SUCCEEDED', details: { approvedBy: 'manager' } }),
      );
    });
  });

  describe('Paid-Order Cancellation Orchestration (R16)', () => {
    it('should process refund before cancelling order during paid order cancellation', async () => {
      const order = { id: 'ord-1', state: 'SUBMITTED', refunded_total: '0.0000', currency_code: 'IRR', terminal_id: 'term-1' };
      const cashPayment = { id: 'pay-1', amount: '50000.0000', status: 'SUCCEEDED', method_id: 'pm-cash' };

      orderRepo.findOne.mockResolvedValue(order);
      paymentRepo.find.mockResolvedValue([cashPayment]);
      shiftService.requireDrawer.mockResolvedValue({ id: 'shf-1' });

      const cancelledOrder = await service.cancelPaidOrder('t-1', 'ord-1', { reason: 'Out of stock' });
      expect(cancelledOrder.state).toBe('CANCELLED');
      expect(shiftService.recordCashRefundMovement).toHaveBeenCalled();
    });

    it('cancels an unpaid order without any refund', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 'ord-1', state: 'SUBMITTED', refunded_total: '0.0000' });

      const cancelled = await service.cancelPaidOrder('t-1', 'ord-1', { reason: 'Changed mind' });

      expect(cancelled.state).toBe('CANCELLED');
      expect(shiftService.recordCashRefundMovement).not.toHaveBeenCalled();
    });
  });

  describe('The refunds list', () => {
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
    it('lists the refunds made in a window, with the order and who approved each', async () => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'r-1', order_id: 'o-1' }, { id: 'r-2', order_id: 'o-1' }], 2]),
      };
      refundRepo.createQueryBuilder.mockReturnValue(qb);
      orderRepo.find = jest.fn().mockResolvedValue([{ id: 'o-1', order_number: 'ORD-1', call_number: 42, total_amount: '100.0000' }]);
      // r-1 was released by a manager's PIN; r-2 names no approver, so the account that made it counts.
      auditRepo.find.mockResolvedValue([
        { entity_id: 'r-1', actor_id: 'cashier-1', details: { approvedBy: 'manager-1' } },
        { entity_id: 'r-2', actor_id: 'cashier-1', details: null },
      ]);
      userRepo.find.mockResolvedValue([
        { id: 'manager-1', display_name: 'Sara', username: 'sara' },
        { id: 'cashier-1', display_name: null, username: 'ali' },
      ]);

      const res = await service.getRefunds('t-1', {
        from: '2026-10-12T00:00:00+03:30',
        to: '2026-10-13T00:00:00+03:30',
        q: 'cold',
      });

      expect(qb.andWhere).toHaveBeenCalledWith('r.initiated_at >= :from', { from: new Date('2026-10-12T00:00:00+03:30') });
      expect(qb.andWhere).toHaveBeenCalledWith('r.initiated_at < :to', { to: new Date('2026-10-13T00:00:00+03:30') });
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('r.reason_text ILIKE :like'), { like: '%cold%' });
      expect(res.total).toBe(2);
      expect(res.data[0]).toEqual(expect.objectContaining({ order_call_number: 42, approved_by_name: 'Sara' }));
      expect(res.data[1].approved_by_name).toBe('ali');
    });
  });
});
