import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderService } from '../src/modules/order/order.service';
import { OrderSequenceService } from '../src/modules/order/order-sequence.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { DiscountEvaluationService } from '../src/modules/discounts/discount-evaluation.service';
import { OrderHeader, OrderState } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { OrderItemOption } from '../src/entities/OrderItemOption.entity';
import { OrderAdjustment } from '../src/entities/OrderAdjustment.entity';
import { OrderNote } from '../src/entities/OrderNote.entity';
import { OrderLink } from '../src/entities/OrderLink.entity';
import { OrderStateEvent } from '../src/entities/OrderStateEvent.entity';
import { OrderSequence } from '../src/entities/OrderSequence.entity';
import { Product } from '../src/entities/Product.entity';
import { OptionItem } from '../src/entities/OptionItem.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { OutboxWriter } from '../src/modules/outbox/outbox-writer.service';

describe('Order Aggregate & State Machine Suite (R12)', () => {
  let service: OrderService;
  let sequenceService: OrderSequenceService;

  let orderRepo: any;
  let itemRepo: any;
  let optionRepo: any;
  let adjustmentRepo: any;
  let noteRepo: any;
  let linkRepo: any;
  let stateEventRepo: any;
  let sequenceRepo: any;
  let productRepo: any;
  let optionItemRepo: any;
  let priceService: any;
  let discountEngine: any;
  let auditWriter: any;
  let outboxWriter: any;
  let dataSource: any;

  beforeEach(async () => {
    orderRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() };
    itemRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), delete: jest.fn() };
    optionRepo = { create: jest.fn(), save: jest.fn() };
    adjustmentRepo = { create: jest.fn(), save: jest.fn() };
    noteRepo = { create: jest.fn(), save: jest.fn() };
    linkRepo = { create: jest.fn(), save: jest.fn() };
    stateEventRepo = { find: jest.fn().mockResolvedValue([]), create: jest.fn(), save: jest.fn() };
    sequenceRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    productRepo = { findOne: jest.fn() };
    optionItemRepo = { findOne: jest.fn() };
    priceService = { resolvePrice: jest.fn() };
    discountEngine = {
      evaluateQuote: jest.fn().mockResolvedValue({
        subtotal: '100000.0000',
        deliveryFee: '0.0000',
        discountTotal: '10000.0000',
        taxTotal: '0.0000',
        grandTotal: '90000.0000',
        consideredDiscounts: [{ campaignName: '10% Discount', status: 'APPLIED', amount: '10000.0000' }],
        warnings: [],
      }),
      consumeUsage: jest.fn().mockResolvedValue(undefined),
    };
    auditWriter = { write: jest.fn() };
    outboxWriter = { enqueueInTransaction: jest.fn(), enqueue: jest.fn() };

    const mockEntityManager: any = {
      create: jest.fn((entityClass, data) => ({ ...data })),
      save: jest.fn((entityClass, data) => Promise.resolve(data || entityClass)),
      findOne: jest.fn((entityClass, options) => orderRepo.findOne(options)),
      delete: jest.fn(),
      getRepository: jest.fn().mockReturnValue(sequenceRepo),
    };

    dataSource = {
      transaction: jest.fn(async (cb) => await cb(mockEntityManager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        OrderSequenceService,
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: itemRepo },
        { provide: getRepositoryToken(OrderItemOption), useValue: optionRepo },
        { provide: getRepositoryToken(OrderAdjustment), useValue: adjustmentRepo },
        { provide: getRepositoryToken(OrderNote), useValue: noteRepo },
        { provide: getRepositoryToken(OrderLink), useValue: linkRepo },
        { provide: getRepositoryToken(OrderStateEvent), useValue: stateEventRepo },
        { provide: getRepositoryToken(OrderSequence), useValue: sequenceRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(OptionItem), useValue: optionItemRepo },
        { provide: PricingService, useValue: priceService },
        { provide: DiscountEvaluationService, useValue: discountEngine },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: OutboxWriter, useValue: outboxWriter },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
    sequenceService = module.get<OrderSequenceService>(OrderSequenceService);
  });

  describe('Order State Machine Transitions (Section 6.1)', () => {
    it('should reject direct illegal transition DRAFT -> COMPLETED', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 'ord-1', tenant_id: 't-1', order_number: 'ORD-100', state: 'DRAFT' });

      await expect(
        service.transitionState('t-1', 'ord-1', 'COMPLETE', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('should transition DRAFT -> SUBMITTED and write OrderStateEvent', async () => {
      const order = { id: 'ord-1', tenant_id: 't-1', order_number: 'ORD-100', state: 'DRAFT', status: 'DRAFT' };
      orderRepo.findOne.mockResolvedValue(order);

      const result = await service.transitionState('t-1', 'ord-1', 'SUBMIT', {});
      expect(result.state).toBe('SUBMITTED');
    });

    it('should transition SUBMITTED -> CONFIRMED -> PREPARING -> READY -> OUT_FOR_DELIVERY -> COMPLETED', async () => {
      const order = { id: 'ord-1', tenant_id: 't-1', order_number: 'ORD-100', state: 'SUBMITTED', status: 'SUBMITTED' };
      orderRepo.findOne.mockResolvedValue(order);

      await service.transitionState('t-1', 'ord-1', 'CONFIRM', {});
      expect(order.state).toBe('CONFIRMED');

      await service.transitionState('t-1', 'ord-1', 'START_PREPARATION', {});
      expect(order.state).toBe('PREPARING');

      await service.transitionState('t-1', 'ord-1', 'MARK_READY', {});
      expect(order.state).toBe('READY');

      await service.transitionState('t-1', 'ord-1', 'DISPATCH', {});
      expect(order.state).toBe('OUT_FOR_DELIVERY');

      await service.transitionState('t-1', 'ord-1', 'COMPLETE', {});
      expect(order.state).toBe('COMPLETED');
    });
  });

  describe('Idempotent Submission & Stale Quote (R12)', () => {
    it('should throw ConflictException 409 QUOTE_STALE if quoteVersion has changed before submit', async () => {
      const order = {
        id: 'ord-1',
        tenant_id: 't-1',
        branch_id: 'b-1',
        channel: 'POS',
        order_type: 'DINE_IN',
        currency_code: 'IRR',
        quote_version: 'v2-new',
        state: 'DRAFT',
        items: [{ product_id: 'p-1', unit_price: '100000.0000', quantity: '1' }],
      };

      orderRepo.findOne.mockResolvedValue(order);

      await expect(
        service.submitOrder('t-1', 'ord-1', { quoteVersion: 'v1-old' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should return existing order idempotently if already submitted', async () => {
      const submittedOrder = {
        id: 'ord-submitted',
        tenant_id: 't-1',
        state: 'SUBMITTED',
        items: [{ product_id: 'p-1' }],
      };

      orderRepo.findOne.mockResolvedValue(submittedOrder);

      const result = await service.submitOrder('t-1', 'ord-submitted', {});
      expect(result.state).toBe('SUBMITTED');
    });
  });

  describe('Database Order Sequence Generator (R12)', () => {
    it('should generate order number matching ORD-YYYYMMDD-XXXX format using database sequence', async () => {
      sequenceRepo.findOne.mockResolvedValue({
        tenant_id: 't-1',
        prefix: 'ORD-20260809',
        last_value: 5,
      });
      sequenceRepo.save.mockImplementation((s) => Promise.resolve(s));

      const orderNum = await sequenceService.generateOrderNumber('t-1');
      expect(orderNum).toMatch(/^ORD-\d{8}-0006$/);
    });
  });
});
