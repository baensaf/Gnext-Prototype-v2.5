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
import { ProductVariant } from '../src/entities/ProductVariant.entity';
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
  let variantRepo: any;
  let optionItemRepo: any;
  let priceService: any;
  let discountEngine: any;
  let auditWriter: any;
  let outboxWriter: any;
  let dataSource: any;
  let mockEntityManager: any;

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
    variantRepo = { findOne: jest.fn() };
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

    mockEntityManager = {
      create: jest.fn((entityClass, data) => ({ ...data })),
      save: jest.fn((entityClass, data) => Promise.resolve(data || entityClass)),
      findOne: jest.fn((entityClass, options) => orderRepo.findOne(options)),
      find: jest.fn((entityClass, options) => Promise.resolve([])),
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
        { provide: getRepositoryToken(ProductVariant), useValue: variantRepo },
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

  describe('FIN-03: Order Splits & Transfers Modifier Scaling (R12)', () => {
    it('should scale modifier_total proportionally when partially splitting an order item', async () => {
      const sourceItem: any = {
        id: 'item-1',
        product_id: 'prod-burger',
        product_name: 'Burger Deluxe',
        quantity: '2.0000',
        unit_price: '50000.0000',
        base_total: '100000.0000',
        modifier_total: '20000.0000', // 10,000 extra cheese per burger
        line_total: '120000.0000',
        options: [{ option_item_id: 'opt-cheese', price_delta: '10000.0000' }],
      };

      const sourceOrder: any = {
        id: 'ord-source',
        tenant_id: 't-1',
        order_number: 'ORD-001',
        state: 'SUBMITTED',
        items: [sourceItem],
      };

      orderRepo.findOne.mockResolvedValue(sourceOrder);
      sequenceRepo.findOne.mockResolvedValue({ tenant_id: 't-1', prefix: 'ORD-20260818', last_value: 1 });

      const childOrder = await service.splitOrder('t-1', 'ord-source', {
        lines: [{ orderItemId: 'item-1', quantity: '1.0000' }],
      });

      expect(childOrder).toBeDefined();
      // Source item remaining quantity = 1, modifier_total scaled to 10,000 (from 20,000)
      expect(sourceItem.quantity).toBe('1.0000');
      expect(sourceItem.base_total).toBe('50000.0000');
      expect(sourceItem.modifier_total).toBe('10000.0000');
      expect(sourceItem.line_total).toBe('60000.0000');
    });
  });

  describe('BUG-01: POS Held Order Updates (branch_id and order_type support)', () => {
    it('should successfully update draft order with branch_id, order_type, coupon_code and items containing variant_name', async () => {
      const draftOrder: any = {
        id: 'ord-draft-1',
        tenant_id: 't-1',
        order_number: 'ORD-001',
        state: 'DRAFT',
        branch_id: 'b1111111-1111-1111-1111-111111111111',
        order_type: 'TAKEAWAY',
        items: [{ id: 'old-item-1', order_id: 'ord-draft-1' }],
      };

      orderRepo.findOne.mockResolvedValue(draftOrder);
      productRepo.findOne.mockResolvedValue({
        id: 'p1111111-1111-1111-1111-111111111111',
        code: 'PIZZA',
        name: 'Pizza',
        base_price: '50000.0000',
      });
      variantRepo.findOne.mockResolvedValue({
        id: 'v1111111-1111-1111-1111-111111111111',
        product_id: 'p1111111-1111-1111-1111-111111111111',
        name: 'Large',
        base_price: '85000.0000',
        is_active: true,
      });
      priceService.resolvePrice.mockResolvedValue('85000.0000');

      const updated = await service.updateDraft('t-1', 'ord-draft-1', {
        branch_id: 'b2222222-2222-2222-2222-222222222222',
        order_type: 'DINE_IN',
        table_number: 'T-12',
        coupon_code: 'SUMMER20',
        items: [
          {
            product_id: 'p1111111-1111-1111-1111-111111111111',
            variant_id: 'v1111111-1111-1111-1111-111111111111',
            variant_name: 'Large',
            quantity: '1.0000',
          },
        ],
      });

      expect(updated).toBeDefined();
      expect(draftOrder.branch_id).toBe('b2222222-2222-2222-2222-222222222222');
      expect(draftOrder.order_type).toBe('DINE_IN');
      expect(draftOrder.table_number).toBe('T-12');
      expect(draftOrder.coupon_code).toBe('SUMMER20');
      expect(mockEntityManager.save.mock.invocationCallOrder[0])
        .toBeLessThan(mockEntityManager.delete.mock.invocationCallOrder[0]);
      expect(mockEntityManager.save).toHaveBeenCalledWith(
        OrderItem,
        expect.objectContaining({
          variant_id: 'v1111111-1111-1111-1111-111111111111',
          variant_name: 'Large',
          unit_price: '85000.0000',
          subtotal: '85000.0000',
        }),
      );
    });
  });
});
