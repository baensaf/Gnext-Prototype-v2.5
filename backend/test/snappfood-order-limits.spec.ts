import { Test, TestingModule } from '@nestjs/testing';
import { basePriceLists } from './utils/price-list-fakes';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderService } from '../src/modules/order/order.service';
import { OrderSequenceService } from '../src/modules/order/order-sequence.service';
import { DiscountEvaluationService } from '../src/modules/discounts/discount-evaluation.service';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { CashierShift } from '../src/entities/CashierShift.entity';
import { OrderItem }from '../src/entities/OrderItem.entity';
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
import { PaymentService } from '../src/modules/payment/payment.service';
import { PrintQueueService } from '../src/modules/printing/print-queue.service';
import { SimulationService } from '../src/modules/simulation/simulation.service';
import { OrderTransitionRecorder } from '../src/modules/order-lifecycle/order-transition-recorder.service';
import { maxPromiseMinutes } from '../src/common/utils/snappfood-order.util';

// Snappfood's annex (4.3.0) gives a store accept, reject, ack and pick for an order, and
// nothing else: no call to change its lines, cancel it or change the time once accepted.
describe('a Snappfood order stays within what the annex lets a store do', () => {
  let service: OrderService;
  let orderRepo: any;
  let itemRepo: any;
  let em: any;  let simulationService: any;
  let auditWriter: any;
  let printQueueService: any;

  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60000);

  const snappfoodOrder = (overrides: Record<string, any> = {}) => ({
    id: 'order-1',
    tenant_id: 't-1',
    branch_id: 'b-1',
    order_number: 'SNP-SF-400',
    channel: 'AGGREGATOR',
    order_type: 'AGGREGATOR',
    state: 'CONFIRMED',
    status: 'CONFIRMED',
    accepted_at: minutesAgo(10),
    items: [],
    ...overrides,
  });

  const lockedOut = (err: any) => err instanceof ConflictException && (err.getResponse() as any).code === 'SNAPPFOOD_ORDER_LOCKED';

  beforeEach(async () => {
    orderRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn((order) => Promise.resolve(order)) };
    itemRepo = { find: jest.fn().mockResolvedValue([]) };
    em = {
      create: jest.fn((_entity, data) => ({ ...data })),
      save: jest.fn((_entity, data) => Promise.resolve(data)),
      findOne: jest.fn((_entity, options) => orderRepo.findOne(options)),
      // A shift is open at the branch, so an accept goes through.
      find: jest.fn((entity) => Promise.resolve(entity === CashierShift ? [{ id: 'shift-1', state: 'OPEN' }] : [])),
      getRepository: jest.fn(),
    };    simulationService = {
      notifyAccepted: jest.fn().mockResolvedValue({ status: 204, statusCode: 42 }),
      notifyRejected: jest.fn().mockResolvedValue({ status: 204, statusCode: 51 }),
      getDeclineReasons: jest.fn().mockResolvedValue([
        { id: 113, title: 'رستوران پیک ندارد', level: 1 },
        { id: 153, title: 'تاخیر در زمان ارسال', level: 1 },
      ]),
    };
    auditWriter = { write: jest.fn() };
    printQueueService = { enqueueOrderPrintJobs: jest.fn().mockResolvedValue([]), enqueueKitchenChangeTicket: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        OrderSequenceService,
        { provide: RefundService, useValue: { cancelPaidOrder: jest.fn() } },
        { provide: CatalogService, useValue: { isCategoryOff: jest.fn().mockResolvedValue(false), getSuspension: jest.fn(), assertLineSellable: jest.fn(), lockStockCounts: jest.fn().mockResolvedValue([]), recordRefusedSale: jest.fn() } },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: itemRepo },
        { provide: getRepositoryToken(OrderItemOption), useValue: {} },
        { provide: getRepositoryToken(OrderAdjustment), useValue: {} },
        { provide: getRepositoryToken(OrderNote), useValue: {} },
        { provide: getRepositoryToken(OrderLink), useValue: {} },
        { provide: getRepositoryToken(OrderStateEvent), useValue: {} },
        { provide: getRepositoryToken(OrderSequence), useValue: {} },
        { provide: getRepositoryToken(Product), useValue: {} },
        { provide: getRepositoryToken(ProductVariant), useValue: {} },
        { provide: getRepositoryToken(OptionItem), useValue: {} },
        basePriceLists(),
        { provide: DiscountEvaluationService, useValue: {} },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: OutboxWriter, useValue: { enqueueInTransaction: jest.fn(), enqueue: jest.fn() } },
        { provide: ApprovalService, useValue: {} },
        { provide: DataSource, useValue: { transaction: jest.fn(async (cb) => await cb(em)) } },        { provide: PrintQueueService, useValue: printQueueService },
        { provide: SimulationService, useValue: simulationService },
        OrderTransitionRecorder,
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  describe('the time the store promises on accepting', () => {
    const waitingExpress = () =>
      snappfoodOrder({
        state: 'PENDING_ACCEPTANCE',
        status: 'PENDING_ACCEPTANCE',
        accepted_at: null,
        aggregator_expedition: 'ZF_EXPRESS',
        aggregator_prep_minutes: 15,
        aggregator_max_extra_minutes: 10,
      });

    it("for a Snapp Express rider, is at most Snappfood's prep time plus the minutes the vendor may add", async () => {
      orderRepo.findOne.mockResolvedValue(waitingExpress());

      const refused = await service.acceptIncomingOrder('t-1', 'order-1', { prepMinutes: 26 }).catch((e) => e);

      expect(refused).toBeInstanceOf(BadRequestException);
      expect(refused.getResponse()).toEqual(expect.objectContaining({ code: 'PROMISE_OVER_PLATFORM_LIMIT', maxMinutes: 25 }));
      expect(em.save).not.toHaveBeenCalled();
      expect(simulationService.notifyAccepted).not.toHaveBeenCalled();
    });

    it('goes to Snappfood as riderPickupTime, and the order keeps when it was accepted and what was promised', async () => {
      orderRepo.findOne.mockResolvedValue(waitingExpress());

      const accepted = await service.acceptIncomingOrder('t-1', 'order-1', { prepMinutes: 25 });

      expect(simulationService.notifyAccepted).toHaveBeenCalledWith('t-1', 'SF-400', { riderPickupTime: 25 });
      expect(accepted.promised_minutes).toBe(25);
      expect(accepted.accepted_at).toBeInstanceOf(Date);
    });

    it("for the store's own courier, is at most 70 minutes and goes to Snappfood as deliveryTime", () => {
      const ownDelivery: any = { aggregator_expedition: 'DELIVERY', aggregator_prep_minutes: 15, aggregator_max_extra_minutes: 10 };

      expect(maxPromiseMinutes(ownDelivery)).toBe(70);
    });
  });

  describe('reporting a problem after accepting', () => {
    it('asks Snappfood for more time with decline reason 153, and the kitchen keeps the order', async () => {
      orderRepo.findOne.mockResolvedValue(snappfoodOrder());

      const reported = await service.reportOnlineOrder('t-1', 'order-1', { reason: 'MORE_TIME', extraMinutes: 20 }, 'user-1');

      expect(simulationService.notifyRejected).toHaveBeenCalledWith('t-1', 'SF-400', { reasonId: 153, comment: 'Needs 20 more minutes' });
      expect(reported.state).toBe('CONFIRMED');
      expect(reported.aggregator_issue_at).toBeInstanceOf(Date);
      expect(reported.aggregator_issue).toContain('Needs 20 more minutes');
      expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'ONLINE_ORDER_REPORTED', entityId: 'order-1' }));
    });

    it('needs to know how many more minutes a delay takes', async () => {
      orderRepo.findOne.mockResolvedValue(snappfoodOrder());

      await expect(service.reportOnlineOrder('t-1', 'order-1', { reason: 'MORE_TIME' })).rejects.toBeInstanceOf(BadRequestException);
      expect(simulationService.notifyRejected).not.toHaveBeenCalled();
    });

    it('is refused once an hour has passed since accepting, as Snappfood refuses it', async () => {
      orderRepo.findOne.mockResolvedValue(snappfoodOrder({ accepted_at: minutesAgo(61) }));

      await expect(service.reportOnlineOrder('t-1', 'order-1', { reason: 'MORE_TIME', extraMinutes: 10 })).rejects.toBeInstanceOf(ConflictException);
      expect(simulationService.notifyRejected).not.toHaveBeenCalled();
    });

    it('is refused while an earlier report is still with Snappfood support', async () => {
      orderRepo.findOne.mockResolvedValue(snappfoodOrder({ aggregator_issue_at: minutesAgo(2) }));

      await expect(service.reportOnlineOrder('t-1', 'order-1', { reason: 'NO_COURIER' })).rejects.toBeInstanceOf(ConflictException);
      expect(simulationService.notifyRejected).not.toHaveBeenCalled();
    });

    it.each(['PENDING_ACCEPTANCE', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'])('is refused for an order that is %s', async (state) => {
      orderRepo.findOne.mockResolvedValue(snappfoodOrder({ state, status: state }));

      await expect(service.reportOnlineOrder('t-1', 'order-1', { reason: 'NO_COURIER' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('is only for Snappfood orders', async () => {
      orderRepo.findOne.mockResolvedValue(snappfoodOrder({ channel: 'POS', order_number: 'ORD-1' }));

      await expect(service.reportOnlineOrder('t-1', 'order-1', { reason: 'NO_COURIER' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // Audit A3 (2026-10-08): Snappfood cancelling an order the kitchen had went unseen.
  describe('Snappfood cancelling an order the kitchen already has', () => {
    it('takes its lines off the kitchen and leaves an alert on the till until someone sees it', async () => {
      itemRepo.find.mockResolvedValue([{ id: 'line-1' }, { id: 'line-2' }]);
      const order: any = snappfoodOrder({ state: 'CANCELLED', status: 'CANCELLED' });

      const result = await service.stopKitchenForPlatformCancel('t-1', order, 'CONFIRMED');

      // With printed tickets the cook learns it from a STOP chit.
      expect(printQueueService.enqueueKitchenChangeTicket).toHaveBeenCalledWith('t-1', 'order-1', expect.objectContaining({ kind: 'CANCELLED' }), undefined);
      expect(result.online_alert).toBe('PLATFORM_CANCELLED');
      expect(result.online_alert_seen_at).toBeNull();
    });

    it('raises nothing for an order that was still waiting to be accepted', async () => {
      const order: any = snappfoodOrder({ state: 'CANCELLED', status: 'CANCELLED', accepted_at: null });

      const result = await service.stopKitchenForPlatformCancel('t-1', order, 'PENDING_ACCEPTANCE');

      expect(result.online_alert).toBeUndefined();
    });
  });

  describe('changes Snappfood gives a store no call for', () => {
    it('refuses to cancel an accepted order', async () => {
      orderRepo.findOne.mockResolvedValue(snappfoodOrder());

      expect(lockedOut(await service.cancelOrder('t-1', 'order-1', { reasonCodeId: undefined } as any).catch((e) => e))).toBe(true);
    });

    it('refuses a cancel sent as a plain state transition', async () => {
      orderRepo.findOne.mockResolvedValue(snappfoodOrder());

      expect(lockedOut(await service.transitionState('t-1', 'order-1', 'CANCEL', {}).catch((e) => e))).toBe(true);
      expect(em.save).not.toHaveBeenCalled();
    });

    it('refuses to reopen one Snappfood cancelled', async () => {
      orderRepo.findOne.mockResolvedValue(snappfoodOrder({ state: 'CANCELLED', status: 'CANCELLED' }));

      expect(lockedOut(await service.reopenOrder('t-1', 'order-1', { approvalRequestId: 'ap-1' } as any).catch((e) => e))).toBe(true);
    });

    it('refuses to change its lines', async () => {
      orderRepo.findOne.mockResolvedValue(snappfoodOrder());

      const edit = { changes: { void: [{ orderItemId: 'item-1' }] } } as any;
      expect(lockedOut(await service.editOrder('t-1', 'order-1', edit).catch((e) => e))).toBe(true);
    });

    it('still lets a till cancel its own order', async () => {
      orderRepo.findOne.mockResolvedValue(snappfoodOrder({ channel: 'POS', order_type: 'TAKEAWAY', order_number: 'ORD-1' }));

      const cancelled = await service.transitionState('t-1', 'order-1', 'CANCEL', {});

      expect(cancelled.state).toBe('CANCELLED');
    });

    it('refuses a payment at the till, since Snappfood collects', async () => {
      const txEm = { findOne: jest.fn().mockResolvedValue(snappfoodOrder()) };
      const dataSource: any = { transaction: jest.fn(async (cb) => await cb(txEm)) };
      const payments = new PaymentService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, dataSource, {} as any, {} as any);

      const refused = await payments.createPaymentIntent('t-1', { orderId: 'order-1' } as any).catch((e) => e);

      expect(lockedOut(refused)).toBe(true);
    });

    it('refuses a refund from the till, since Snappfood refunds its customers', async () => {
      const txEm = { findOne: jest.fn().mockResolvedValue(snappfoodOrder({ state: 'COMPLETED', status: 'COMPLETED' })) };
      const dataSource: any = { transaction: jest.fn(async (cb) => await cb(txEm)) };
      const refunds = new RefundService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, dataSource);

      const refused = await refunds.createRefundIntent('t-1', 'order-1', { reason: 'cold', full: true } as any).catch((e) => e);

      expect(lockedOut(refused)).toBe(true);
    });
  });
});
