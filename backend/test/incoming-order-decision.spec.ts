import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderService } from '../src/modules/order/order.service';
import { OrderSequenceService } from '../src/modules/order/order-sequence.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { DiscountEvaluationService } from '../src/modules/discounts/discount-evaluation.service';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { OrderItemOption } from '../src/entities/OrderItemOption.entity';
import { OrderAdjustment } from '../src/entities/OrderAdjustment.entity';
import { OrderNote } from '../src/entities/OrderNote.entity';
import { OrderLink } from '../src/entities/OrderLink.entity';
import { OrderStateEvent } from '../src/entities/OrderStateEvent.entity';
import { OrderSequence } from '../src/entities/OrderSequence.entity';
import { Product } from '../src/entities/Product.entity';
import { ProductVariant } from '../src/entities/ProductVariant.entity';
import { OptionItem } from '../src/entities/OptionItem.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { OutboxWriter } from '../src/modules/outbox/outbox-writer.service';
import { ApprovalService } from '../src/modules/approval/approval.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { RefundService } from '../src/modules/refund/refund.service';
import { KdsService } from '../src/modules/kds/kds.service';
import { PrintQueueService } from '../src/modules/printing/print-queue.service';
import { SimulationService } from '../src/modules/simulation/simulation.service';
import { NON_REVENUE_ORDER_STATES } from '../src/common/utils/business-date.util';

// Slice 2 of incoming orders: the store's answer to an order that is waiting for it.
// Accept is the only way into the kitchen; reject is final and never reaches it.
describe('the store accepts or rejects an incoming aggregator order', () => {
  let service: OrderService;
  let orderRepo: any;
  let em: any;
  let kdsService: any;
  let printQueueService: any;
  let simulationService: any;

  const pendingOrder = (overrides: Record<string, any> = {}) => ({
    id: 'order-1',
    tenant_id: 't-1',
    branch_id: 'b-1',
    order_number: 'SNP-SF-304',
    channel: 'AGGREGATOR',
    state: 'PENDING_ACCEPTANCE',
    status: 'PENDING_ACCEPTANCE',
    items: [{ id: 'item-1', state: 'ACTIVE' }],
    ...overrides,
  });

  const savedStateEvents = () =>
    em.save.mock.calls.filter(([entity]: any[]) => entity === OrderStateEvent).map(([, data]: any[]) => data);

  beforeEach(async () => {
    orderRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    em = {
      create: jest.fn((_entity, data) => ({ ...data })),
      save: jest.fn((_entity, data) => Promise.resolve(data)),
      findOne: jest.fn((_entity, options) => orderRepo.findOne(options)),
      find: jest.fn(() => Promise.resolve([])),
      getRepository: jest.fn(),
    };
    kdsService = { generateTicketsForOrder: jest.fn().mockResolvedValue([]) };
    printQueueService = { enqueueOrderPrintJobs: jest.fn().mockResolvedValue([]) };
    simulationService = {
      notifyAccepted: jest.fn().mockResolvedValue({ status: 204, statusCode: 42 }),
      notifyRejected: jest.fn().mockResolvedValue({ status: 204, statusCode: 51 }),
      getDeclineReasons: jest.fn().mockResolvedValue([
        { id: 113, title: 'رستوران پیک ندارد', level: 1 },
        { id: 153, title: 'تاخیر در زمان ارسال', level: 1 },
        { id: 154, title: 'تغییر هزینه پیک', level: 2 },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        OrderSequenceService,
        { provide: RefundService, useValue: { cancelPaidOrder: jest.fn() } },
        { provide: CatalogService, useValue: { getSuspension: jest.fn() } },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: {} },
        { provide: getRepositoryToken(OrderItemOption), useValue: {} },
        { provide: getRepositoryToken(OrderAdjustment), useValue: {} },
        { provide: getRepositoryToken(OrderNote), useValue: {} },
        { provide: getRepositoryToken(OrderLink), useValue: {} },
        { provide: getRepositoryToken(OrderStateEvent), useValue: {} },
        { provide: getRepositoryToken(OrderSequence), useValue: {} },
        { provide: getRepositoryToken(Product), useValue: {} },
        { provide: getRepositoryToken(ProductVariant), useValue: {} },
        { provide: getRepositoryToken(OptionItem), useValue: {} },
        { provide: PricingService, useValue: {} },
        { provide: DiscountEvaluationService, useValue: {} },
        { provide: AuditWriter, useValue: { write: jest.fn() } },
        { provide: OutboxWriter, useValue: { enqueueInTransaction: jest.fn(), enqueue: jest.fn() } },
        { provide: ApprovalService, useValue: {} },
        { provide: DataSource, useValue: { transaction: jest.fn(async (cb) => await cb(em)) } },
        { provide: KdsService, useValue: kdsService },
        { provide: PrintQueueService, useValue: printQueueService },
        { provide: SimulationService, useValue: simulationService },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  describe('accept', () => {
    it('confirms the order, fires the kitchen and the kitchen printer once, and tells Snappfood', async () => {
      orderRepo.findOne.mockResolvedValue(pendingOrder());

      const result = await service.acceptIncomingOrder('t-1', 'order-1', { prepMinutes: 25 }, 'user-1');

      expect(result.state).toBe('CONFIRMED');
      expect(savedStateEvents()).toEqual([
        expect.objectContaining({ from_state: 'PENDING_ACCEPTANCE', to_state: 'CONFIRMED', action: 'ACCEPT', occurred_by: 'user-1' }),
      ]);
      expect(kdsService.generateTicketsForOrder).toHaveBeenCalledTimes(1);
      expect(kdsService.generateTicketsForOrder).toHaveBeenCalledWith('t-1', 'order-1', undefined);
      expect(printQueueService.enqueueOrderPrintJobs).toHaveBeenCalledTimes(1);
      expect(printQueueService.enqueueOrderPrintJobs).toHaveBeenCalledWith('t-1', 'order-1', 'KITCHEN_TICKET', false, undefined, 'user-1');
      expect(simulationService.notifyAccepted).toHaveBeenCalledWith('t-1', 'SF-304', { deliveryTime: 25 });
    });

    it('reads the order under a row lock, so a second cashier waits and then sees it already accepted', async () => {
      orderRepo.findOne.mockResolvedValue(pendingOrder());

      await service.acceptIncomingOrder('t-1', 'order-1', { prepMinutes: 25 });

      expect(orderRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ lock: { mode: 'pessimistic_write' } }));
    });

    it.each(['CONFIRMED', 'REJECTED', 'CANCELLED'])('refuses an order that is already %s, with no kitchen, print or Snappfood call', async (state) => {
      orderRepo.findOne.mockResolvedValue(pendingOrder({ state, status: state }));

      await expect(service.acceptIncomingOrder('t-1', 'order-1', { prepMinutes: 25 })).rejects.toBeInstanceOf(ConflictException);

      expect(kdsService.generateTicketsForOrder).not.toHaveBeenCalled();
      expect(printQueueService.enqueueOrderPrintJobs).not.toHaveBeenCalled();
      expect(simulationService.notifyAccepted).not.toHaveBeenCalled();
    });

    it('does not call Snappfood for an order that did not come from Snappfood', async () => {
      orderRepo.findOne.mockResolvedValue(pendingOrder({ channel: 'ONLINE', order_number: 'WEB-1001' }));

      await service.acceptIncomingOrder('t-1', 'order-1', { prepMinutes: 25 });

      expect(simulationService.notifyAccepted).not.toHaveBeenCalled();
      expect(kdsService.generateTicketsForOrder).toHaveBeenCalledTimes(1);
    });
  });

  describe('reject', () => {
    it('records the reason, sends nothing to the kitchen or printer, and tells Snappfood', async () => {
      orderRepo.findOne.mockResolvedValue(pendingOrder());

      const result = await service.rejectIncomingOrder('t-1', 'order-1', { reasonId: 113, comment: 'No rider tonight' }, 'user-1');

      expect(result.state).toBe('REJECTED');
      const [event] = savedStateEvents();
      expect(event).toEqual(expect.objectContaining({ from_state: 'PENDING_ACCEPTANCE', to_state: 'REJECTED', action: 'REJECT' }));
      expect(event.reason_text).toContain('113');
      expect(event.reason_text).toContain('No rider tonight');
      expect(kdsService.generateTicketsForOrder).not.toHaveBeenCalled();
      expect(printQueueService.enqueueOrderPrintJobs).not.toHaveBeenCalled();
      expect(simulationService.notifyRejected).toHaveBeenCalledWith('t-1', 'SF-304', { reasonId: 113, comment: 'No rider tonight' });
    });

    it("needs one of Snappfood's decline reasons", async () => {
      orderRepo.findOne.mockResolvedValue(pendingOrder());

      await expect(service.rejectIncomingOrder('t-1', 'order-1', { reasonId: 999 })).rejects.toBeInstanceOf(BadRequestException);

      expect(em.save).not.toHaveBeenCalled();
      expect(simulationService.notifyRejected).not.toHaveBeenCalled();
    });

    it('refuses an order that was already accepted', async () => {
      orderRepo.findOne.mockResolvedValue(pendingOrder({ state: 'CONFIRMED', status: 'CONFIRMED' }));

      await expect(service.rejectIncomingOrder('t-1', 'order-1', { reasonId: 113 })).rejects.toBeInstanceOf(ConflictException);

      expect(simulationService.notifyRejected).not.toHaveBeenCalled();
    });
  });

  describe('the generic order actions cannot go around accept and reject', () => {
    it('confirm cannot move a pending order into the kitchen without accepting it', async () => {
      orderRepo.findOne.mockResolvedValue(pendingOrder());

      await expect(service.transitionState('t-1', 'order-1', 'CONFIRM', {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('cancel cannot drop a pending order without Snappfood being told', async () => {
      orderRepo.findOne.mockResolvedValue(pendingOrder());

      await expect(
        service.cancelOrder('t-1', 'order-1', { reasonCodeId: '6f1c2b1e-0000-4000-8000-000000000001' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('an order nobody answers in time', () => {
    it('is rejected by the system, with the time limit as the reason, and Snappfood is told', async () => {
      orderRepo.findOne.mockResolvedValue(pendingOrder());

      const result = await service.rejectUnanswered('t-1', 'order-1', 5);

      expect(result.state).toBe('REJECTED');
      const [event] = savedStateEvents();
      expect(event).toEqual(expect.objectContaining({ to_state: 'REJECTED', action: 'REJECT', occurred_by: null }));
      expect(event.reason_text).toContain('5 min');
      expect(simulationService.notifyRejected).toHaveBeenCalledWith(
        't-1',
        'SF-304',
        expect.objectContaining({ comment: expect.stringContaining('5 min') }),
      );
      expect(kdsService.generateTicketsForOrder).not.toHaveBeenCalled();
    });

    it('leaves alone an order a cashier answered a moment earlier', async () => {
      orderRepo.findOne.mockResolvedValue(pendingOrder({ state: 'CONFIRMED', status: 'CONFIRMED' }));

      await expect(service.rejectUnanswered('t-1', 'order-1', 5)).rejects.toBeInstanceOf(ConflictException);

      expect(simulationService.notifyRejected).not.toHaveBeenCalled();
    });
  });

  it('a rejected order is not revenue', () => {
    expect(NON_REVENUE_ORDER_STATES).toContain('REJECTED');
  });

  // Until the store accepts it, an incoming order may still be rejected or expire, so it
  // is not a sale yet. It used to count in the sales summary and the business-day close.
  it('an order still waiting for acceptance is not revenue', () => {
    expect(NON_REVENUE_ORDER_STATES).toContain('PENDING_ACCEPTANCE');
  });
});
