import { Test, TestingModule } from '@nestjs/testing';
import { basePriceLists } from './utils/price-list-fakes';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderService } from '../src/modules/order/order.service';
import { OrderSequenceService } from '../src/modules/order/order-sequence.service';
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
import { Delivery } from '../src/entities/Delivery.entity';
import { DeliveryZone } from '../src/entities/DeliveryZone.entity';
import { CustomerAddress } from '../src/entities/CustomerAddress.entity';
import { DiningTable } from '../src/entities/DiningTable.entity';
import { TableSession } from '../src/entities/TableSession.entity';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { OutboxWriter } from '../src/modules/outbox/outbox-writer.service';
import { ApprovalService } from '../src/modules/approval/approval.service';
import { KdsService } from '../src/modules/kds/kds.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { RefundService } from '../src/modules/refund/refund.service';
import { PrintQueueService } from '../src/modules/printing/print-queue.service';
import { OrderTransitionRecorder } from '../src/modules/order-lifecycle/order-transition-recorder.service';

const TENANT = 't-1';
const ORDER_ID = 'ord-1';
const REASON = 'reason-code-1';
const APPROVAL_ID = '11111111-1111-1111-1111-111111111111';

describe('Order edit command (spec 7.9)', () => {
  let service: OrderService;
  let approvalService: any;
  let kdsService: any;
  let printQueueService: any;
  let stateEvents: any[];
  let order: any;
  let items: any[];
  let payments: any[];
  let refunds: any[];
  // Fixtures the order-type suite sets; null means "this record does not exist".
  let delivery: any;
  let zone: any;
  let address: any;
  let table: any;
  let tableSession: any;

  const minutesAgo = (n: number) => new Date(Date.now() - n * 60000);

  beforeEach(async () => {
    stateEvents = [];
    payments = [];
    refunds = [];
    delivery = null;
    zone = null;
    address = null;
    table = null;
    tableSession = null;
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
        // Populated only by the order-type suite. Null everywhere else, which is what the
        // line-edit suites above already assume.
        if (entityClass === Delivery) return delivery;
        if (entityClass === DeliveryZone) return zone;
        if (entityClass === CustomerAddress) return address;
        if (entityClass === DiningTable) return table;
        if (entityClass === TableSession) return tableSession;
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
    printQueueService = { enqueueKitchenChangeTicket: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        OrderSequenceService,
        // Only reached by cancel-paid, which these suites do not exercise.
        {
          provide: RefundService,
          useValue: { cancelPaidOrder: jest.fn() },
        },
        {
          provide: CatalogService,
          useValue: {
            assertLineSellable: jest.fn(),
            lockStockCounts: jest.fn().mockResolvedValue([]),
            recordRefusedSale: jest.fn(),
            getSuspension: jest
              .fn()
              .mockResolvedValue({ isSuspended: false, reason: null, suspendedUntil: null }),
          },
        },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), delete: jest.fn() } },
        { provide: getRepositoryToken(OrderItemOption), useValue: { create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(OrderAdjustment), useValue: {} },
        { provide: getRepositoryToken(OrderNote), useValue: {} },
        { provide: getRepositoryToken(OrderLink), useValue: {} },
        { provide: getRepositoryToken(OrderStateEvent), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(OrderSequence), useValue: {} },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(ProductVariant), useValue: { findOne: jest.fn(), count: jest.fn().mockResolvedValue(0) } },
        { provide: getRepositoryToken(OptionItem), useValue: { findOne: jest.fn() } },
        basePriceLists(),
        { provide: DiscountEvaluationService, useValue: {} },
        { provide: AuditWriter, useValue: { write: jest.fn(), writeInTransaction: jest.fn() } },
        { provide: OutboxWriter, useValue: { enqueueInTransaction: jest.fn() } },
        { provide: ApprovalService, useValue: approvalService },
        { provide: KdsService, useValue: kdsService },
        { provide: PrintQueueService, useValue: printQueueService },
        OrderTransitionRecorder,
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

  describe('kitchen change tickets', () => {
    it('prints a VOID chit for a struck line', async () => {
      await service.editOrder(TENANT, ORDER_ID, {
        changes: { void: [{ orderItemId: 'item-1', reasonCodeId: REASON, reason: 'Customer changed mind' }] },
      });

      expect(printQueueService.enqueueKitchenChangeTicket).toHaveBeenCalledWith(
        TENANT,
        ORDER_ID,
        { kind: 'AMENDED', voidedItemIds: ['item-1'], addedItemIds: [], reason: 'Customer changed mind' },
        undefined,
      );
    });

    it('prints an ADD chit for an appended line', async () => {
      await service.editOrder(TENANT, ORDER_ID, {
        changes: { add: [{ product_id: 'prod-9', quantity: '1.0000' } as any] },
      });

      const appended = items.find((i) => i.product_name === 'Baklava');
      expect(printQueueService.enqueueKitchenChangeTicket).toHaveBeenCalledWith(
        TENANT,
        ORDER_ID,
        expect.objectContaining({ kind: 'AMENDED', voidedItemIds: [], addedItemIds: [appended.id] }),
        undefined,
      );
    });

    it('still prints the chit when the station screens are down', async () => {
      kdsService.cancelTicketItemsForOrderItem.mockRejectedValue(new Error('KDS offline'));

      await service.editOrder(TENANT, ORDER_ID, {
        changes: { void: [{ orderItemId: 'item-1', reasonCodeId: REASON }] },
      });

      expect(printQueueService.enqueueKitchenChangeTicket).toHaveBeenCalled();
    });

    it('prints the replaced line as VOID and its replacement as ADD', async () => {
      await service.replaceItem(TENANT, ORDER_ID, {
        orderItemId: 'item-1',
        reasonCodeId: REASON,
        replacement: { productId: 'prod-9', quantity: '1.0000' },
      } as any);

      const replacement = items.find((i) => i.replaces_item_id === 'item-1');
      expect(printQueueService.enqueueKitchenChangeTicket).toHaveBeenCalledWith(
        TENANT,
        ORDER_ID,
        expect.objectContaining({ kind: 'AMENDED', voidedItemIds: ['item-1'], addedItemIds: [replacement.id] }),
        undefined,
      );
    });

    it('stops the kitchen when a submitted order is cancelled', async () => {
      order.items = items;

      await service.cancelOrder(TENANT, ORDER_ID, { reasonCodeId: REASON, reason: 'Walked out' } as any);

      expect(order.state).toBe('CANCELLED');
      expect(kdsService.cancelTicketItemsForOrderItem).toHaveBeenCalledWith(TENANT, 'item-1', undefined);
      expect(kdsService.cancelTicketItemsForOrderItem).toHaveBeenCalledWith(TENANT, 'item-2', undefined);
      expect(printQueueService.enqueueKitchenChangeTicket).toHaveBeenCalledWith(
        TENANT,
        ORDER_ID,
        { kind: 'CANCELLED', reason: 'Walked out' },
        undefined,
      );
    });

    it('sends nothing to the kitchen when a draft is discarded', async () => {
      order.state = 'DRAFT';
      order.submitted_at = null;
      order.items = items;

      await service.cancelOrder(TENANT, ORDER_ID, { reasonCodeId: REASON } as any);

      expect(kdsService.cancelTicketItemsForOrderItem).not.toHaveBeenCalled();
      expect(printQueueService.enqueueKitchenChangeTicket).not.toHaveBeenCalled();
    });
  });
/**
   * Rung up as the wrong kind of order. The type is what the delivery fee hangs off, so a
   * conversion moves money — these cover the fee, the table, and the things it must refuse.
   */
  describe('changing the order type', () => {
    const asDelivery = () => {
      order.order_type = 'DELIVERY';
      order.customer_id = 'cust-1';
      order.customer_address_id = 'addr-1';
      order.delivery_zone_id = 'zone-1';
      order.delivery_fee = '25000.0000';
      order.grand_total = '125000.0000';
    };
    const liveZone = () => {
      zone = { id: 'zone-1', tenant_id: TENANT, branch_id: order.branch_id, is_active: true, fee: '25000.0000' };
      address = { id: 'addr-1', tenant_id: TENANT, customer_id: 'cust-1' };
    };

    it('takes the delivery fee off when the customer decides to collect', async () => {
      asDelivery();

      await service.changeOrderType(TENANT, ORDER_ID, { orderType: 'TAKEAWAY' });

      expect(order.order_type).toBe('TAKEAWAY');
      expect(order.delivery_fee).toBe('0.0000');
      expect(order.delivery_zone_id).toBeNull();
      // 100000 of food, no fee.
      expect(order.grand_total).toBe('100000.0000');
    });

    it('puts the zone fee on when a walk-in turns out to be a delivery', async () => {
      order.order_type = 'TAKEAWAY';
      order.customer_id = 'cust-1';
      order.delivery_fee = '0.0000';
      liveZone();

      await service.changeOrderType(TENANT, ORDER_ID, {
        orderType: 'DELIVERY',
        deliveryAddressId: 'addr-1',
        deliveryZoneId: 'zone-1',
      });

      expect(order.order_type).toBe('DELIVERY');
      expect(order.delivery_fee).toBe('25000.0000');
      expect(order.grand_total).toBe('125000.0000');
    });

    it('will not make an order a delivery with nowhere to deliver it', async () => {
      order.order_type = 'TAKEAWAY';
      order.customer_id = 'cust-1';

      await expect(
        service.changeOrderType(TENANT, ORDER_ID, { orderType: 'DELIVERY' }),
      ).rejects.toThrow('DELIVERY_ADDRESS_REQUIRED');
    });

    it('frees the table when a dine-in check becomes a delivery', async () => {
      order.order_type = 'DINE_IN';
      order.table_id = 'tbl-1';
      order.table_number = '12';
      order.customer_id = 'cust-1';
      tableSession = { id: 'sess-1', table_id: 'tbl-1', status: 'OCCUPIED', closed_at: null };
      liveZone();

      await service.changeOrderType(TENANT, ORDER_ID, {
        orderType: 'DELIVERY',
        deliveryAddressId: 'addr-1',
        deliveryZoneId: 'zone-1',
      });

      expect(order.table_id).toBeNull();
      expect(tableSession.closed_at).toBeInstanceOf(Date);
      expect(tableSession.status).toBe('AVAILABLE');
    });

    it('seats the check when a takeaway becomes dine-in', async () => {
      order.order_type = 'TAKEAWAY';
      table = { id: 'tbl-7', tenant_id: TENANT, table_number: '7' };

      await service.changeOrderType(TENANT, ORDER_ID, { orderType: 'DINE_IN', tableId: 'tbl-7' });

      expect(order.order_type).toBe('DINE_IN');
      expect(order.table_id).toBe('tbl-7');
      expect(order.table_number).toBe('7');
    });

    it('refuses to take an order off a courier who is already carrying it', async () => {
      asDelivery();
      delivery = { id: 'dlv-1', order_id: ORDER_ID, state: 'PICKED_UP' };

      await expect(
        service.changeOrderType(TENANT, ORDER_ID, { orderType: 'TAKEAWAY' }),
      ).rejects.toThrow(ConflictException);
    });

    it('cancels an unassigned delivery on the way out', async () => {
      asDelivery();
      delivery = { id: 'dlv-1', order_id: ORDER_ID, state: 'UNASSIGNED' };

      await service.changeOrderType(TENANT, ORDER_ID, { orderType: 'TAKEAWAY' });

      expect(delivery.state).toBe('CANCELLED');
    });

    it('refuses a conversion that would drop the total below what was collected', async () => {
      asDelivery();
      payments.push({ id: 'pay-1', status: 'SUCCEEDED', amount: '125000.0000' });

      await expect(
        service.changeOrderType(TENANT, ORDER_ID, {
          orderType: 'TAKEAWAY',
          approvalRequestId: APPROVAL_ID,
        }),
      ).rejects.toMatchObject({ response: { code: 'REFUND_REQUIRED' } });
    });

    it('needs an approval once money has landed', async () => {
      asDelivery();
      payments.push({ id: 'pay-1', status: 'SUCCEEDED', amount: '10000.0000' });

      await expect(
        service.changeOrderType(TENANT, ORDER_ID, { orderType: 'TAKEAWAY' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses to convert a Snappfood order, which is not ours to change', async () => {
      order.channel = 'AGGREGATOR';
      order.order_number = 'SNP-5501';
      order.order_type = 'DELIVERY';

      await expect(
        service.changeOrderType(TENANT, ORDER_ID, { orderType: 'TAKEAWAY' }),
      ).rejects.toMatchObject({ response: { code: 'SNAPPFOOD_ORDER_LOCKED' } });
    });

    it('refuses a conversion to the type it already is', async () => {
      order.order_type = 'TAKEAWAY';

      await expect(
        service.changeOrderType(TENANT, ORDER_ID, { orderType: 'TAKEAWAY' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to act on totals the cashier never saw', async () => {
      asDelivery();

      await expect(
        service.changeOrderType(TENANT, ORDER_ID, { orderType: 'TAKEAWAY', quoteVersion: 'stale' }),
      ).rejects.toMatchObject({ response: { code: 'QUOTE_STALE' } });
    });

    it('records the conversion in the order history', async () => {
      asDelivery();

      await service.changeOrderType(TENANT, ORDER_ID, { orderType: 'TAKEAWAY', reason: 'Guest will collect' });

      const event = stateEvents.find((e) => e.action === 'CHANGE_ORDER_TYPE');
      expect(event).toBeDefined();
      expect(event.reason_text).toBe('Guest will collect');
      expect(event.snapshot.from).toBe('DELIVERY');
      expect(event.snapshot.to).toBe('TAKEAWAY');
    });

    it('leaves the kitchen alone: the lines have not changed', async () => {
      asDelivery();

      await service.changeOrderType(TENANT, ORDER_ID, { orderType: 'TAKEAWAY' });

      expect(kdsService.cancelTicketItemsForOrderItem).not.toHaveBeenCalled();
      expect(printQueueService.enqueueKitchenChangeTicket).not.toHaveBeenCalled();
    });
  });
});
