import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
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
import { Payment } from '../src/entities/Payment.entity';
import { Refund } from '../src/entities/Refund.entity';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { OutboxWriter } from '../src/modules/outbox/outbox-writer.service';
import { ApprovalService } from '../src/modules/approval/approval.service';
import { KdsService } from '../src/modules/kds/kds.service';

const TENANT = 't-1';
const ORDER_ID = 'ord-1';
const REASON = 'reason-code-1';
const APPROVAL_ID = '11111111-1111-1111-1111-111111111111';

describe('Order edit command (spec 7.9)', () => {
  let service: OrderService;
  let approvalService: any;
  let kdsService: any;
  let stateEvents: any[];
  let order: any;
  let items: any[];
  let payments: any[];
  let refunds: any[];

  const minutesAgo = (n: number) => new Date(Date.now() - n * 60000);

  beforeEach(async () => {
    stateEvents = [];
    payments = [];
    refunds = [];
    order = {
      id: ORDER_ID,
      tenant_id: TENANT,
      order_number: 'ORD-100',
      state: 'CONFIRMED',
      status: 'CONFIRMED',
      submitted_at: minutesAgo(2),
      quote_version: 'v1',
      version: 1,
      currency_code: 'IRR',
      subtotal: '100000.0000',
      grand_total: '100000.0000',
      paid_total: '0.0000',
      discount_total: '0.0000',
      tax_total: '0.0000',
      business_date: '2026-09-09',
    };
    items = [
      {
        id: 'item-1', tenant_id: TENANT, order_id: ORDER_ID, line_number: 1, product_name: 'Burger',
        quantity: '1.0000', unit_price: '60000.0000', modifier_total: '0.0000', line_total: '60000.0000', state: 'ACTIVE',
      },
      {
        id: 'item-2', tenant_id: TENANT, order_id: ORDER_ID, line_number: 2, product_name: 'Fries',
        quantity: '1.0000', unit_price: '40000.0000', modifier_total: '0.0000', line_total: '40000.0000', state: 'ACTIVE',
      },
    ];

    const orderRepo = {
      findOne: jest.fn().mockImplementation(async () => order),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    const productRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'prod-9', tenant_id: TENANT, code: 'DESSERT', name: 'Baklava', base_price: '30000.0000',
      }),
    };

    const em: any = {
      create: jest.fn((_entityClass: any, data: any) => ({ ...data })),
      save: jest.fn(async (entityClass: any, data: any) => {
        if (entityClass === OrderStateEvent) stateEvents.push(data);
        if (entityClass === OrderItem && !items.find((i) => i.id === data.id)) {
          items.push({ ...data, id: data.id || `item-new-${items.length + 1}` });
        }
        return data;
      }),
      findOne: jest.fn(async (entityClass: any, opts: any) => {
        if (entityClass === OrderHeader) return order;
        if (entityClass === TenantSetting) {
          return { value: { editWindowMinutes: 10, cancelWindowMinutes: 10 } };
        }
        if (entityClass === OrderItem) {
          return (
            items.find(
              (i) =>
                (opts?.where?.id && i.id === opts.where.id) ||
                (opts?.where?.line_number && i.line_number === opts.where.line_number),
            ) || null
          );
        }
        return null;
      }),
      find: jest.fn(async (entityClass: any, opts: any) => {
        if (entityClass === OrderItem) {
          const state = opts?.where?.state;
          return state ? items.filter((i) => i.state === state) : items;
        }
        if (entityClass === Payment) return payments;
        if (entityClass === Refund) return refunds;
        return [];
      }),
      count: jest.fn(async () => payments.filter((p) => p.status === 'SUCCEEDED').length),
      delete: jest.fn(),
      getRepository: jest.fn().mockReturnValue({ findOne: jest.fn() }),
    };

    approvalService = { validateApprovedRequest: jest.fn().mockResolvedValue({ status: 'APPROVED' }) };
    kdsService = {
      cancelTicketItemsForOrderItem: jest.fn().mockResolvedValue({ cancelled: 1 }),
      generateTicketsForOrder: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        OrderSequenceService,
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), delete: jest.fn() } },
        { provide: getRepositoryToken(OrderItemOption), useValue: { create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(OrderAdjustment), useValue: {} },
        { provide: getRepositoryToken(OrderNote), useValue: {} },
        { provide: getRepositoryToken(OrderLink), useValue: {} },
        { provide: getRepositoryToken(OrderStateEvent), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(OrderSequence), useValue: {} },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(ProductVariant), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(OptionItem), useValue: { findOne: jest.fn() } },
        { provide: PricingService, useValue: {} },
        { provide: DiscountEvaluationService, useValue: {} },
        { provide: AuditWriter, useValue: { write: jest.fn() } },
        { provide: OutboxWriter, useValue: { enqueueInTransaction: jest.fn() } },
        { provide: ApprovalService, useValue: approvalService },
        { provide: KdsService, useValue: kdsService },
        { provide: DataSource, useValue: { transaction: jest.fn(async (cb: any) => cb(em)), manager: em } },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  describe('append-only line changes', () => {
    it('marks a removed line VOID instead of deleting it', async () => {
      await service.editOrder(TENANT, ORDER_ID, {
        changes: { void: [{ orderItemId: 'item-1', reasonCodeId: REASON }] },
      });

      expect(items.find((i) => i.id === 'item-1').state).toBe('VOID');
      expect(items).toHaveLength(2);
    });

    it('drops the voided line out of the order total', async () => {
      await service.editOrder(TENANT, ORDER_ID, {
        changes: { void: [{ orderItemId: 'item-1', reasonCodeId: REASON }] },
      });

      expect(order.subtotal).toBe('40000.0000');
      expect(order.grand_total).toBe('40000.0000');
    });

    it('appends new lines after the highest existing line number', async () => {
      await service.editOrder(TENANT, ORDER_ID, {
        changes: { add: [{ product_id: 'prod-9', quantity: '1.0000' } as any] },
      });

      const appended = items.find((i) => i.product_name === 'Baklava');
      expect(appended.line_number).toBe(3);
      expect(appended.state).toBe('ACTIVE');
    });

    it('records a before/after diff on the state event', async () => {
      await service.editOrder(TENANT, ORDER_ID, {
        changes: { void: [{ orderItemId: 'item-2', reasonCodeId: REASON }] },
      });

      const evt = stateEvents.find((e) => e.action === 'EDIT_ORDER');
      expect(evt.snapshot.before.find((l: any) => l.id === 'item-2').state).toBe('ACTIVE');
      expect(evt.snapshot.after.find((l: any) => l.id === 'item-2').state).toBe('VOID');
    });

    it('refuses an edit that changes nothing', async () => {
      await expect(service.editOrder(TENANT, ORDER_ID, { changes: {} })).rejects.toThrow(BadRequestException);
    });
  });

  describe('authority', () => {
    it('allows a cashier removal inside the window', async () => {
      await service.editOrder(TENANT, ORDER_ID, {
        changes: { void: [{ orderItemId: 'item-1', reasonCodeId: REASON }] },
      });

      expect(approvalService.validateApprovedRequest).not.toHaveBeenCalled();
    });

    it('demands an approval request once the window has elapsed', async () => {
      order.submitted_at = minutesAgo(30);

      await expect(
        service.editOrder(TENANT, ORDER_ID, {
          changes: { void: [{ orderItemId: 'item-1', reasonCodeId: REASON }] },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('accepts the edit when an approved request is supplied', async () => {
      order.submitted_at = minutesAgo(30);

      await service.editOrder(TENANT, ORDER_ID, {
        changes: { void: [{ orderItemId: 'item-1', reasonCodeId: REASON }] },
        approvalRequestId: APPROVAL_ID,
      });

      expect(approvalService.validateApprovedRequest).toHaveBeenCalledWith(TENANT, APPROVAL_ID, 'EDIT_ORDER');
    });

    it('refuses any edit on a completed order', async () => {
      order.state = 'COMPLETED';

      await expect(
        service.editOrder(TENANT, ORDER_ID, {
          changes: { void: [{ orderItemId: 'item-1', reasonCodeId: REASON }] },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('still lets a cashier append during preparation without a manager', async () => {
      order.state = 'PREPARING';

      await service.editOrder(TENANT, ORDER_ID, {
        changes: { add: [{ product_id: 'prod-9', quantity: '1.0000' } as any] },
      });

      expect(approvalService.validateApprovedRequest).not.toHaveBeenCalled();
    });
  });

  describe('reason codes and money', () => {
    it('requires a reason code to void a line', async () => {
      await expect(
        service.editOrder(TENANT, ORDER_ID, { changes: { void: [{ orderItemId: 'item-1' }] } }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to drop the total below money collected without a refund plan', async () => {
      payments.push({ status: 'SUCCEEDED', amount: '100000.0000' });

      await expect(
        service.editOrder(TENANT, ORDER_ID, {
          changes: { void: [{ orderItemId: 'item-1', reasonCodeId: REASON }] },
          approvalRequestId: APPROVAL_ID,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows the same edit once a refund plan is attached', async () => {
      payments.push({ status: 'SUCCEEDED', amount: '100000.0000' });

      await service.editOrder(TENANT, ORDER_ID, {
        changes: { void: [{ orderItemId: 'item-1', reasonCodeId: REASON }] },
        approvalRequestId: APPROVAL_ID,
        refundPlan: { amount: '60000.0000' },
      });

      expect(order.grand_total).toBe('40000.0000');
    });

    it('counts succeeded refunds against money collected', async () => {
      payments.push({ status: 'SUCCEEDED', amount: '100000.0000' });
      refunds.push({ status: 'SUCCEEDED', amount: '100000.0000' });

      await service.editOrder(TENANT, ORDER_ID, {
        changes: { void: [{ orderItemId: 'item-1', reasonCodeId: REASON }] },
      });

      expect(order.grand_total).toBe('40000.0000');
    });

    it('rejects an edit composed against a stale quote', async () => {
      await expect(
        service.editOrder(TENANT, ORDER_ID, {
          changes: { void: [{ orderItemId: 'item-1', reasonCodeId: REASON }] },
          quoteVersion: 'v0',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('kitchen sync', () => {
    it('retracts voided lines from the kitchen', async () => {
      await service.editOrder(TENANT, ORDER_ID, {
        changes: { void: [{ orderItemId: 'item-1', reasonCodeId: REASON }] },
      });

      expect(kdsService.cancelTicketItemsForOrderItem).toHaveBeenCalledWith(TENANT, 'item-1', undefined);
    });

    it('fires newly appended lines', async () => {
      await service.editOrder(TENANT, ORDER_ID, {
        changes: { add: [{ product_id: 'prod-9', quantity: '1.0000' } as any] },
      });

      expect(kdsService.generateTicketsForOrder).toHaveBeenCalledWith(TENANT, ORDER_ID);
    });

    it('does not roll the edit back when the kitchen call fails', async () => {
      kdsService.cancelTicketItemsForOrderItem.mockRejectedValue(new Error('KDS offline'));

      await service.editOrder(TENANT, ORDER_ID, {
        changes: { void: [{ orderItemId: 'item-1', reasonCodeId: REASON }] },
      });

      expect(items.find((i) => i.id === 'item-1').state).toBe('VOID');
    });
  });
});
