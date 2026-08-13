import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { OrderHeader, OrderState } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { OrderItemOption } from '../../entities/OrderItemOption.entity';
import { OrderAdjustment } from '../../entities/OrderAdjustment.entity';
import { OrderNote } from '../../entities/OrderNote.entity';
import { OrderLink } from '../../entities/OrderLink.entity';
import { OrderStateEvent } from '../../entities/OrderStateEvent.entity';
import { Product } from '../../entities/Product.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { PricingService } from '../pricing/pricing.service';
import { DiscountEvaluationService } from '../discounts/discount-evaluation.service';
import { OrderSequenceService } from './order-sequence.service';
import { AuditWriter } from '../audit/audit-writer.service';
import { OutboxWriter } from '../outbox/outbox-writer.service';
import { KdsService } from '../kds/kds.service';
import { PrintQueueService } from '../printing/print-queue.service';
import { DeliveryService } from '../delivery/delivery.service';
import { CreditService } from '../customer/credit.service';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import Decimal from 'decimal.js';
import { MoneyUtil } from '../../common/utils/money.util';
import { DiningTable } from '../../entities/DiningTable.entity';
import { TableOccupancyEvent } from '../../entities/TableOccupancyEvent.entity';
import { SplitOrderDto, TransferItemsDto } from '../dine-in/dtos/dine-in.dto';
import {
  OrderCreateDto,
  OrderUpdateDto,
  OrderQuoteRequestDto,
  OrderSubmitDto,
  OrderTransitionDto,
  OrderEditDto,
  OrderItemReplaceDto,
  OrderCancelDto,
  OrderReopenDto,
} from './dtos/order.dto';

// State Transition Matrix per Section 6.1
const ALLOWED_TRANSITIONS: Record<OrderState, OrderState[]> = {
  DRAFT: ['SUBMITTED', 'CONFIRMED', 'CANCELLED'],
  SUBMITTED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['COMPLETED', 'READY', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: ['SUBMITTED'],
};

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(OrderItem) private readonly itemRepo: Repository<OrderItem>,
    @InjectRepository(OrderItemOption) private readonly optionRepo: Repository<OrderItemOption>,
    @InjectRepository(OrderAdjustment) private readonly adjustmentRepo: Repository<OrderAdjustment>,
    @InjectRepository(OrderNote) private readonly noteRepo: Repository<OrderNote>,
    @InjectRepository(OrderLink) private readonly linkRepo: Repository<OrderLink>,
    @InjectRepository(OrderStateEvent) private readonly stateEventRepo: Repository<OrderStateEvent>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(OptionItem) private readonly optionItemRepo: Repository<OptionItem>,
    private readonly priceService: PricingService,
    private readonly discountEngine: DiscountEvaluationService,
    private readonly sequenceService: OrderSequenceService,
    private readonly auditWriter: AuditWriter,
    private readonly outboxWriter: OutboxWriter,
    private readonly dataSource: DataSource,
    @Optional() private readonly kdsService?: KdsService,
    @Optional() private readonly printQueueService?: PrintQueueService,
    @Optional() private readonly deliveryService?: DeliveryService,
    @Optional() private readonly creditService?: CreditService,
  ) {}

  async getOrders(tenantId: string, query: any) {
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.items', 'item')
      .leftJoinAndSelect('item.options', 'opt')
      .where('o.tenant_id = :tenantId', { tenantId });

    const branchVal = query.branch || query.branch_id || query.branchId;
    if (branchVal) qb.andWhere('o.branch_id = :branch', { branch: branchVal });
    const stateVal = query.state || query.status;
    if (stateVal) qb.andWhere('(o.state = :state OR o.status = :state)', { state: stateVal });
    if (query.type) qb.andWhere('o.order_type = :type', { type: query.type });
    if (query.channel) qb.andWhere('o.channel = :channel', { channel: query.channel });
    if (query.customer) qb.andWhere('o.customer_id = :customer', { customer: query.customer });
    if (query.table) qb.andWhere('o.table_id = :table', { table: query.table });
    if (query.shift) qb.andWhere('o.shift_id = :shift', { shift: query.shift });
    if (query.q) {
      qb.andWhere('(o.order_number ILIKE :q OR o.notes ILIKE :q)', { q: `%${query.q}%` });
    }

    qb.orderBy('o.placed_at', 'DESC');
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '50', 10);
    qb.skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  async getOrderById(tenantId: string, id: string) {
    const order = await this.orderRepo.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['items', 'items.options', 'adjustments', 'stateEvents'],
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  async createDraft(tenantId: string, dto: OrderCreateDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const orderNumber = await this.sequenceService.generateOrderNumber(tenantId, em);
      const currencyCode = dto.currency_code || 'IRR';
      const channel = dto.channel || 'POS';
      const orderType = dto.order_type || 'DINE_IN';

      const order = em.create(OrderHeader, {
        tenant_id: tenantId,
        branch_id: dto.branch_id,
        terminal_id: dto.terminal_id || null,
        shift_id: dto.shift_id || null,
        order_number: orderNumber,
        channel,
        order_type: orderType,
        state: 'DRAFT' as OrderState,
        status: 'DRAFT',
        currency_code: currencyCode,
        quote_version: '1',
        customer_id: dto.customer_id || null,
        delivery_address_id: dto.delivery_address_id || null,
        table_id: dto.table_id || null,
        table_number: dto.table_number || null,
        guest_count: dto.guest_count || null,
        coupon_code: dto.coupon_code ? dto.coupon_code.toUpperCase() : null,
        notes: dto.notes || null,
        created_by: userId || null,
      });

      const savedOrder = await em.save(OrderHeader, order);

      // Add initial items if provided
      if (dto.items && dto.items.length > 0) {
        await this.addItemsToDraft(tenantId, savedOrder, dto.items, em);
      }

      // Record state event
      const stateEvt = em.create(OrderStateEvent, {
        tenant_id: tenantId,
        order_id: savedOrder.id,
        from_state: null,
        to_state: 'DRAFT',
        action: 'CREATE_DRAFT',
        occurred_by: userId || null,
      });
      await em.save(OrderStateEvent, stateEvt);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'ORDER_CREATED',
        entityType: 'Order',
        entityId: savedOrder.id,
        correlationId,
        afterData: savedOrder,
      });

      return await em.findOne(OrderHeader, {
        where: { id: savedOrder.id },
        relations: ['items', 'items.options', 'adjustments', 'stateEvents'],
      });
    });
  }

  async updateDraft(tenantId: string, id: string, dto: OrderUpdateDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const order = await em.findOne(OrderHeader, {
        where: { id, tenant_id: tenantId },
        relations: ['items', 'items.options'],
      });
      if (!order) throw new NotFoundException(`Order ${id} not found`);
      if (order.state !== 'DRAFT') {
        throw new BadRequestException(`Only DRAFT orders can be updated via generic patch. Submitted orders require edit command.`);
      }

      if (dto.customer_id !== undefined) order.customer_id = dto.customer_id;
      if (dto.table_id !== undefined) order.table_id = dto.table_id;
      if (dto.table_number !== undefined) order.table_number = dto.table_number;
      if (dto.guest_count !== undefined) order.guest_count = dto.guest_count;
      if (dto.notes !== undefined) order.notes = dto.notes;

      if (dto.items) {
        // Clear existing items and re-add
        await em.delete(OrderItem, { order_id: id });
        await this.addItemsToDraft(tenantId, order, dto.items, em);
      }

      // Update quoteVersion
      order.quote_version = String(Date.now());
      order.updated_by = userId || null;
      await em.save(OrderHeader, order);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'ORDER_UPDATED',
        entityType: 'Order',
        entityId: id,
        correlationId,
      });

      return await em.findOne(OrderHeader, {
        where: { id },
        relations: ['items', 'items.options', 'adjustments', 'stateEvents'],
      });
    });
  }

  async getQuote(tenantId: string, id: string, request?: OrderQuoteRequestDto) {
    const order = await this.getOrderById(tenantId, id);
    return await this.evaluateOrderQuote(tenantId, order, request);
  }

  private async evaluateOrderQuote(tenantId: string, order: OrderHeader, request?: OrderQuoteRequestDto) {
    const couponCode = request?.couponCode || order.coupon_code;

    const draftItems = (order.items || []).map((i) => ({
      productId: i.product_id,
      variantId: i.variant_id || undefined,
      unitPrice: i.unit_price,
      quantity: i.quantity,
    }));

    const quoteRes = await this.discountEngine.evaluateQuote(tenantId, {
      orderDraft: {
        branchId: order.branch_id,
        customerId: order.customer_id || undefined,
        channel: order.channel,
        orderType: order.order_type,
        currencyCode: order.currency_code,
        deliveryFee: order.delivery_fee,
        items: draftItems,
      },
      manualDiscount: request?.manualDiscount,
      couponCode: couponCode || undefined,
    });

    return {
      orderId: order.id,
      orderNumber: order.order_number,
      quoteVersion: order.quote_version,
      ...quoteRes,
    };
  }

  async submitOrder(tenantId: string, id: string, dto: OrderSubmitDto, userId?: string, correlationId?: string) {
    const res = await this.dataSource.transaction(async (em) => {
      const order = await em.findOne(OrderHeader, {
        where: { id, tenant_id: tenantId },
        relations: ['items', 'items.options'],
      });
      if (!order) throw new NotFoundException(`Order ${id} not found`);

      // Idempotency check: if already submitted, return current order cleanly
      if (order.state !== 'DRAFT') {
        return order;
      }

      if (!order.items || order.items.length === 0) {
        throw new BadRequestException('Cannot submit an order with zero items');
      }

      // Check stale quote if version provided
      if (dto.quoteVersion && dto.quoteVersion !== order.quote_version) {
        const freshQuote = await this.evaluateOrderQuote(tenantId, order, { couponCode: order.coupon_code });
        throw new ConflictException({
          statusCode: 409,
          error: 'QUOTE_STALE',
          message: 'Prices, discounts, or order totals have changed since the last quote',
          freshQuote,
        });
      }

      // Evaluate discounts & totals
      const quoteRes = await this.discountEngine.evaluateQuote(tenantId, {
        orderDraft: {
          branchId: order.branch_id,
          customerId: order.customer_id || undefined,
          channel: order.channel,
          orderType: order.order_type,
          currencyCode: order.currency_code,
          deliveryFee: order.delivery_fee,
          items: order.items.map((i) => ({
            productId: i.product_id,
            variantId: i.variant_id || undefined,
            unitPrice: i.unit_price,
            quantity: i.quantity,
          })),
        },
        manualDiscount: dto.manualDiscount || (dto.approvalRequestIds?.[0] ? { approvalRequestId: dto.approvalRequestIds[0], calculation_type: 'PERCENTAGE', value: '10' } : undefined),
        couponCode: order.coupon_code || undefined,
      });

      // Consume discounts inside transaction
      const appliedCampaignIds = quoteRes.consideredDiscounts
        .filter((d) => d.status === 'APPLIED' && d.campaignId)
        .map((d) => d.campaignId!);

      if (appliedCampaignIds.length > 0) {
        await this.discountEngine.consumeUsage(
          tenantId,
          order.id,
          order.customer_id || undefined,
          appliedCampaignIds,
          undefined,
          quoteRes.discountTotal,
          em,
        );
      }

      // Persist OrderAdjustment records for applied discounts
      const appliedDiscounts = quoteRes.consideredDiscounts.filter((d) => d.status === 'APPLIED');
      for (const disc of appliedDiscounts) {
        const isManual = disc.campaignName.toLowerCase().includes('manual');
        const adj = em.create(OrderAdjustment, {
          tenant_id: tenantId,
          order_id: order.id,
          type: 'DISCOUNT',
          source_type: isManual ? 'MANUAL' : 'CAMPAIGN',
          source_id: disc.campaignId || null,
          code: disc.campaignCode || (isManual ? 'MANUAL_DISCOUNT' : null),
          name: disc.campaignName,
          amount: disc.amount,
          funding_source: 'MERCHANT',
          calculation_snapshot: { discountType: disc.discountType, amount: disc.amount },
        });
        await em.save(OrderAdjustment, adj);
      }

      // Snapshot totals
      order.subtotal = quoteRes.subtotal;
      order.subtotal_amount = quoteRes.subtotal;
      order.delivery_fee = quoteRes.deliveryFee;
      order.discount_total = quoteRes.discountTotal;
      order.discount_amount = quoteRes.discountTotal;
      order.tax_total = quoteRes.taxTotal;
      order.tax_amount = quoteRes.taxTotal;
      order.grand_total = quoteRes.grandTotal;
      order.total_amount = quoteRes.grandTotal;
      order.outstanding_total = quoteRes.grandTotal;
      order.due_amount = quoteRes.grandTotal;

      // Determine state transition: POS/KIOSK can move directly to CONFIRMED
      const targetState: OrderState = (order.channel === 'POS' || order.channel === 'KIOSK') ? 'CONFIRMED' : 'SUBMITTED';
      const fromState = order.state;
      order.state = targetState;
      order.status = targetState;
      order.submitted_at = new Date();

      await em.save(OrderHeader, order);

      // Write OrderStateEvent
      const stateEvt = em.create(OrderStateEvent, {
        tenant_id: tenantId,
        order_id: order.id,
        from_state: fromState,
        to_state: targetState,
        action: 'SUBMIT',
        occurred_by: userId || null,
        snapshot: {
          subtotal: order.subtotal,
          discountTotal: order.discount_total,
          grandTotal: order.grand_total,
          consideredDiscounts: quoteRes.consideredDiscounts,
        },
      });
      await em.save(OrderStateEvent, stateEvt);

      // Write Outbox Event
      await this.outboxWriter.enqueueInTransaction(em, {
        tenantId,
        eventType: 'ORDER_SUBMITTED',
        aggregateType: 'Order',
        aggregateId: order.id,
        payload: {
          orderId: order.id,
          orderNumber: order.order_number,
          branchId: order.branch_id,
          channel: order.channel,
          state: targetState,
          grandTotal: order.grand_total,
        },
      });

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'ORDER_SUBMITTED',
        entityType: 'Order',
        entityId: order.id,
        correlationId,
        afterData: order,
      });

      return await em.findOne(OrderHeader, {
        where: { id: order.id },
        relations: ['items', 'items.options', 'adjustments', 'stateEvents'],
      });
    });

    if (this.kdsService) {
      try {
        await this.kdsService.generateTicketsForOrder(tenantId, id, correlationId);
      } catch (e) {
        // KDS side effect error must not fail submit
      }
    }

    if (this.printQueueService) {
      try {
        await this.printQueueService.enqueueOrderPrintJobs(tenantId, id, 'CUSTOMER_RECEIPT', false, undefined, userId);
        await this.printQueueService.enqueueOrderPrintJobs(tenantId, id, 'KITCHEN_TICKET', false, undefined, userId);
      } catch (e) {
        // Printing side effect error must not fail submit
      }
    }

    if (this.deliveryService && res && res.order_type === 'DELIVERY') {
      try {
        await this.deliveryService.createDeliveryForOrder(tenantId, id);
      } catch (e) {
        // Delivery side effect error must not fail submit
      }
    }

    return res;
  }

  async transitionState(
    tenantId: string,
    id: string,
    action: string,
    dto: OrderTransitionDto,
    userId?: string,
    correlationId?: string,
  ) {
    return await this.dataSource.transaction(async (em) => {
      const order = await em.findOne(OrderHeader, { where: { id, tenant_id: tenantId } });
      if (!order) throw new NotFoundException(`Order ${id} not found`);

      const targetState = this.mapActionToTargetState(action);
      const allowedNextStates = ALLOWED_TRANSITIONS[order.state] || [];

      if (!allowedNextStates.includes(targetState)) {
        throw new BadRequestException(`Cannot transition order ${order.order_number} from state ${order.state} to ${targetState} via action ${action}`);
      }

      const fromState = order.state;
      order.state = targetState;
      order.status = targetState;

      if (targetState === 'COMPLETED') {
        order.completed_at = new Date();
        if (order.customer_id && this.creditService) {
          const eligiblePaidSubtotal = MoneyUtil.subtract(order.subtotal, order.discount_total);
          if (MoneyUtil.greaterThan(eligiblePaidSubtotal, '0.0000')) {
            const settingRepo = em.getRepository(TenantSetting);
            const setting = await settingRepo.findOne({ where: { tenant_id: tenantId, key: 'CUSTOMER_CLUB' } });
            const cashbackPct = (setting?.value as any)?.cashback_percentage ?? '5.00';
            await this.creditService.awardLoyaltyCashback(
              tenantId,
              order.customer_id,
              order.id,
              eligiblePaidSubtotal,
              cashbackPct,
              order.currency_code || 'IRR',
              em,
            );
          }
        }
      } else if (targetState === 'CANCELLED') {
        order.cancelled_at = new Date();
        order.cancellation_reason_code_id = dto.reasonCodeId || null;
      }

      await em.save(OrderHeader, order);

      // Record state event
      const stateEvt = em.create(OrderStateEvent, {
        tenant_id: tenantId,
        order_id: order.id,
        from_state: fromState,
        to_state: targetState,
        action,
        reason_code_id: dto.reasonCodeId || null,
        reason_text: dto.reasonText || null,
        approval_request_id: dto.approvalRequestId || null,
        occurred_by: userId || null,
      });
      await em.save(OrderStateEvent, stateEvt);

      // Write Outbox Event
      await this.outboxWriter.enqueueInTransaction(em, {
        tenantId,
        eventType: targetState === 'CANCELLED' ? 'ORDER_CANCELLED' : 'ORDER_UPDATED',
        aggregateType: 'Order',
        aggregateId: order.id,
        payload: {
          orderId: order.id,
          orderNumber: order.order_number,
          fromState,
          toState: targetState,
          action,
        },
      });

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: `ORDER_${action.toUpperCase()}`,
        entityType: 'Order',
        entityId: order.id,
        correlationId,
      });

      return order;
    });
  }

  async editOrder(tenantId: string, id: string, dto: OrderEditDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const order = await em.findOne(OrderHeader, {
        where: { id, tenant_id: tenantId },
        relations: ['items'],
      });
      if (!order) throw new NotFoundException(`Order ${id} not found`);
      if (['COMPLETED', 'CANCELLED'].includes(order.state)) {
        throw new BadRequestException(`Cannot edit order in state ${order.state}`);
      }

      order.version += 1;
      order.quote_version = String(Date.now());
      await em.save(OrderHeader, order);

      const stateEvt = em.create(OrderStateEvent, {
        tenant_id: tenantId,
        order_id: order.id,
        from_state: order.state,
        to_state: order.state,
        action: 'EDIT_ORDER',
        occurred_by: userId || null,
        snapshot: dto.changes,
      });
      await em.save(OrderStateEvent, stateEvt);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'ORDER_EDITED',
        entityType: 'Order',
        entityId: id,
        correlationId,
      });

      return await em.findOne(OrderHeader, {
        where: { id },
        relations: ['items', 'items.options', 'adjustments', 'stateEvents'],
      });
    });
  }

  async replaceItem(tenantId: string, id: string, dto: OrderItemReplaceDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const item = await em.findOne(OrderItem, { where: { id: dto.orderItemId, tenant_id: tenantId } });
      if (!item) throw new NotFoundException(`Order item ${dto.orderItemId} not found`);

      item.state = 'REPLACED';
      await em.save(OrderItem, item);

      // Create replacement line item
      if (dto.replacement) {
        const newItem = em.create(OrderItem, {
          tenant_id: tenantId,
          order_id: id,
          product_id: dto.replacement.productId || item.product_id,
          product_name: dto.replacement.productName || item.product_name,
          quantity: dto.replacement.quantity || item.quantity,
          unit_price: dto.replacement.unitPrice || item.unit_price,
          subtotal: MoneyUtil.multiply(dto.replacement.unitPrice || item.unit_price, dto.replacement.quantity || item.quantity),
          line_total: MoneyUtil.multiply(dto.replacement.unitPrice || item.unit_price, dto.replacement.quantity || item.quantity),
          state: 'ACTIVE',
          replaces_item_id: item.id,
        });
        await em.save(OrderItem, newItem);
      }

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'ORDER_ITEM_REPLACED',
        entityType: 'OrderItem',
        entityId: dto.orderItemId,
        correlationId,
      });

      return await this.getOrderById(tenantId, id);
    });
  }

  async cancelOrder(tenantId: string, id: string, dto: OrderCancelDto, userId?: string, correlationId?: string) {
    return await this.transitionState(
      tenantId,
      id,
      'CANCEL',
      { reasonCodeId: dto.reasonCodeId, reasonText: dto.reason },
      userId,
      correlationId,
    );
  }

  async reopenOrder(tenantId: string, id: string, dto: OrderReopenDto, userId?: string, correlationId?: string) {
    return await this.transitionState(
      tenantId,
      id,
      'REOPEN',
      { reasonCodeId: dto.reasonCodeId, reasonText: dto.reason, approvalRequestId: dto.approvalRequestId },
      userId,
      correlationId,
    );
  }

  async getOrderHistory(tenantId: string, id: string) {
    const order = await this.getOrderById(tenantId, id);
    const events = await this.stateEventRepo.find({
      where: { tenant_id: tenantId, order_id: id },
      order: { occurred_at: 'ASC' },
    });
    return {
      orderId: order.id,
      orderNumber: order.order_number,
      currentState: order.state,
      events,
    };
  }

  private async addItemsToDraft(
    tenantId: string,
    order: OrderHeader,
    itemsDto: any[],
    em: EntityManager,
  ) {
    let lineNo = 1;
    for (const itemDto of itemsDto) {
      const product = await this.productRepo.findOne({ where: { id: itemDto.product_id, tenant_id: tenantId } });
      if (!product) throw new NotFoundException(`Product ${itemDto.product_id} not found`);

      const qty = itemDto.quantity || '1.0000';
      const uPrice = itemDto.unit_price ? MoneyUtil.format(itemDto.unit_price) : MoneyUtil.format(product.base_price);
      const sub = MoneyUtil.multiply(uPrice, qty);

      const orderItem = em.create(OrderItem, {
        tenant_id: tenantId,
        order_id: order.id,
        line_number: lineNo++,
        product_id: product.id,
        product_code: product.code,
        product_name: product.name,
        variant_id: itemDto.variant_id || null,
        quantity: qty,
        unit_price: uPrice,
        base_total: sub,
        subtotal: sub,
        line_total: sub,
        total_amount: sub,
        notes: itemDto.notes || null,
        state: 'ACTIVE',
      });
      const savedItem = await em.save(OrderItem, orderItem);

      if (itemDto.options && itemDto.options.length > 0) {
        for (const optDto of itemDto.options) {
          const optItem = await this.optionItemRepo.findOne({ where: { id: optDto.option_item_id } });
          if (optItem) {
            const itemOpt = em.create(OrderItemOption, {
              tenant_id: tenantId,
              order_item_id: savedItem.id,
              option_item_id: optItem.id,
              option_group_name: '',
              option_item_name: optItem.name,
              price_delta: optItem.price_delta || '0.0000',
            });
            await em.save(OrderItemOption, itemOpt);
          }
        }
      }
    }
  }

  private mapActionToTargetState(action: string): OrderState {
    const act = action.toUpperCase();
    switch (act) {
      case 'SUBMIT':
        return 'SUBMITTED';
      case 'CONFIRM':
        return 'CONFIRMED';
      case 'START_PREPARATION':
      case 'PREPARE':
        return 'PREPARING';
      case 'MARK_READY':
      case 'READY':
        return 'READY';
      case 'DISPATCH':
        return 'OUT_FOR_DELIVERY';
      case 'COMPLETE':
        return 'COMPLETED';
      case 'CANCEL':
        return 'CANCELLED';
      case 'REOPEN':
        return 'SUBMITTED';
      default:
        throw new BadRequestException(`Unknown order state action: ${action}`);
    }
  }

  public async recalculateOrderTotals(tenantId: string, order: OrderHeader, em: EntityManager): Promise<OrderHeader> {
    const items = await em.find(OrderItem, { where: { order_id: order.id, tenant_id: tenantId } });
    let subtotal = '0.0000';
    let modifierTotal = '0.0000';

    for (const item of items) {
      const lineBase = MoneyUtil.multiply(item.unit_price, item.quantity);
      item.base_total = lineBase;
      item.line_total = MoneyUtil.add(lineBase, item.modifier_total || '0.0000');
      subtotal = MoneyUtil.add(subtotal, item.line_total);
      modifierTotal = MoneyUtil.add(modifierTotal, item.modifier_total || '0.0000');
      await em.save(OrderItem, item);
    }

    order.subtotal = subtotal;
    order.subtotal_amount = subtotal;
    order.modifier_total = modifierTotal;

    const netBeforeTax = MoneyUtil.subtract(
      MoneyUtil.add(MoneyUtil.add(order.subtotal, order.packaging_total || '0.0000'), order.delivery_fee || '0.0000'),
      order.discount_total || '0.0000',
    );
    const grandTotal = MoneyUtil.add(netBeforeTax, order.tax_total || '0.0000');
    order.grand_total = MoneyUtil.greaterThan(grandTotal, '0.0000') ? grandTotal : '0.0000';
    order.total_amount = order.grand_total;

    const outstanding = MoneyUtil.subtract(order.grand_total, order.paid_total || '0.0000');
    order.outstanding_total = MoneyUtil.greaterThan(outstanding, '0.0000') ? outstanding : '0.0000';
    order.due_amount = order.outstanding_total;
    order.quote_version = String(Date.now());

    return await em.save(OrderHeader, order);
  }

  async splitOrder(tenantId: string, sourceOrderId: string, dto: SplitOrderDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const lockIds = Array.from(new Set([sourceOrderId, dto.targetTableId].filter(Boolean) as string[])).sort();
      for (const id of lockIds) {
        if (id === sourceOrderId) {
          await em.findOne(OrderHeader, { where: { id, tenant_id: tenantId }, lock: { mode: 'pessimistic_write' } });
        } else {
          await em.findOne(DiningTable, { where: { id, tenant_id: tenantId }, lock: { mode: 'pessimistic_write' } });
        }
      }

      const sourceOrder = await em.findOne(OrderHeader, {
        where: { id: sourceOrderId, tenant_id: tenantId },
        relations: ['items', 'items.options'],
      });
      if (!sourceOrder) throw new NotFoundException(`Order ${sourceOrderId} not found`);

      if (['COMPLETED', 'CANCELLED'].includes(sourceOrder.state)) {
        throw new BadRequestException(`Cannot split order in state ${sourceOrder.state}`);
      }

      if (!dto.lines || dto.lines.length === 0) {
        throw new BadRequestException('At least one item line must be specified to split order');
      }

      const childOrderNumber = await this.sequenceService.generateOrderNumber(tenantId, em);

      let targetTableNumber = sourceOrder.table_number;
      if (dto.targetTableId) {
        const targetTbl = await em.findOne(DiningTable, { where: { id: dto.targetTableId, tenant_id: tenantId } });
        if (targetTbl) targetTableNumber = targetTbl.table_number;
      }

      const childOrder = em.create(OrderHeader, {
        tenant_id: tenantId,
        branch_id: sourceOrder.branch_id,
        terminal_id: sourceOrder.terminal_id,
        shift_id: sourceOrder.shift_id,
        order_number: childOrderNumber,
        channel: sourceOrder.channel,
        order_type: 'DINE_IN',
        state: 'DRAFT' as OrderState,
        status: 'DRAFT',
        currency_code: sourceOrder.currency_code,
        quote_version: '1',
        customer_id: sourceOrder.customer_id,
        table_id: dto.targetTableId || sourceOrder.table_id,
        table_number: targetTableNumber,
        guest_count: sourceOrder.guest_count,
        business_date: sourceOrder.business_date,
        parent_order_id: sourceOrder.id,
        created_by: userId || null,
      });
      const savedChildOrder = await em.save(OrderHeader, childOrder);

      let newLineNo = 1;
      for (const splitLine of dto.lines) {
        const sourceItem = (sourceOrder.items || []).find((i) => i.id === splitLine.orderItemId);
        if (!sourceItem) {
          throw new BadRequestException(`Order item ${splitLine.orderItemId} not found on order ${sourceOrderId}`);
        }

        const splitQty = new Decimal(splitLine.quantity);
        const currentQty = new Decimal(sourceItem.quantity);

        if (splitQty.lte(0) || splitQty.gt(currentQty)) {
          throw new BadRequestException(`Invalid split quantity ${splitLine.quantity} for item ${sourceItem.id} (current: ${sourceItem.quantity})`);
        }

        if (splitQty.equals(currentQty)) {
          sourceItem.order_id = savedChildOrder.id;
          sourceItem.line_number = newLineNo++;
          await em.save(OrderItem, sourceItem);
        } else {
          const remainingQty = currentQty.minus(splitQty);
          sourceItem.quantity = MoneyUtil.format(remainingQty, 4);
          sourceItem.base_total = MoneyUtil.multiply(sourceItem.unit_price, sourceItem.quantity);
          sourceItem.line_total = MoneyUtil.add(sourceItem.base_total, sourceItem.modifier_total || '0.0000');
          await em.save(OrderItem, sourceItem);

          const newItem = em.create(OrderItem, {
            tenant_id: tenantId,
            order_id: savedChildOrder.id,
            line_number: newLineNo++,
            product_id: sourceItem.product_id,
            variant_id: sourceItem.variant_id,
            product_code: sourceItem.product_code,
            product_name: sourceItem.product_name,
            variant_name: sourceItem.variant_name,
            quantity: MoneyUtil.format(splitQty, 4),
            unit_price: sourceItem.unit_price,
            base_total: MoneyUtil.multiply(sourceItem.unit_price, MoneyUtil.format(splitQty, 4)),
            modifier_total: sourceItem.modifier_total,
            discount_total: '0.0000',
            tax_total: '0.0000',
            packaging_total: '0.0000',
            line_total: MoneyUtil.add(MoneyUtil.multiply(sourceItem.unit_price, MoneyUtil.format(splitQty, 4)), sourceItem.modifier_total || '0.0000'),
            notes: sourceItem.notes,
            state: sourceItem.state,
          });
          const savedNewItem = await em.save(OrderItem, newItem);

          if (sourceItem.options && sourceItem.options.length > 0) {
            for (const opt of sourceItem.options) {
              const newOpt = em.create(OrderItemOption, {
                tenant_id: tenantId,
                order_item_id: savedNewItem.id,
                option_item_id: opt.option_item_id,
                option_group_name: opt.option_group_name || '',
                option_item_name: opt.option_item_name || '',
                price_delta: opt.price_delta || '0.0000',
              });
              await em.save(OrderItemOption, newOpt);
            }
          }
        }
      }

      const link = em.create(OrderLink, {
        tenant_id: tenantId,
        from_order_id: sourceOrder.id,
        to_order_id: savedChildOrder.id,
        link_type: 'SPLIT',
        details: { splitLines: dto.lines },
      });
      await em.save(OrderLink, link);

      const updatedSource = await this.recalculateOrderTotals(tenantId, sourceOrder, em);
      const updatedChild = await this.recalculateOrderTotals(tenantId, savedChildOrder, em);

      if (dto.targetTableId) {
        const occ = em.create(TableOccupancyEvent, {
          tenant_id: tenantId,
          table_id: dto.targetTableId,
          order_id: savedChildOrder.id,
          from_table_id: sourceOrder.table_id || undefined,
          event_type: 'SPLIT',
          guest_count: sourceOrder.guest_count || 1,
          occurred_by: userId || null,
          details: { sourceOrderId: sourceOrder.id, newOrderId: savedChildOrder.id },
        });
        await em.save(TableOccupancyEvent, occ);
      }

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'ORDER_SPLIT',
        entityType: 'Order',
        entityId: sourceOrder.id,
        correlationId,
        details: { childOrderId: savedChildOrder.id, childOrderNumber },
      });

      return { source: updatedSource, newOrder: updatedChild };
    });
  }

  async transferItems(tenantId: string, dto: TransferItemsDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const sortedOrderIds = [dto.sourceOrderId, dto.targetOrderId].sort();
      for (const id of sortedOrderIds) {
        await em.findOne(OrderHeader, { where: { id, tenant_id: tenantId }, lock: { mode: 'pessimistic_write' } });
      }

      const sourceOrder = await em.findOne(OrderHeader, {
        where: { id: dto.sourceOrderId, tenant_id: tenantId },
        relations: ['items', 'items.options'],
      });
      const targetOrder = await em.findOne(OrderHeader, {
        where: { id: dto.targetOrderId, tenant_id: tenantId },
        relations: ['items', 'items.options'],
      });

      if (!sourceOrder || !targetOrder) {
        throw new NotFoundException('Source or target order not found');
      }

      if (sourceOrder.branch_id !== targetOrder.branch_id || sourceOrder.currency_code !== targetOrder.currency_code) {
        throw new BadRequestException('Source and target orders must have the same branch and currency');
      }

      if (['COMPLETED', 'CANCELLED'].includes(sourceOrder.state) || ['COMPLETED', 'CANCELLED'].includes(targetOrder.state)) {
        throw new BadRequestException('Cannot transfer items to/from completed or cancelled orders');
      }

      let targetLineNo = (targetOrder.items || []).length + 1;
      for (const transferLine of dto.lines) {
        const sourceItem = (sourceOrder.items || []).find((i) => i.id === transferLine.orderItemId);
        if (!sourceItem) {
          throw new BadRequestException(`Item ${transferLine.orderItemId} not found on source order`);
        }

        const qtyToTransfer = new Decimal(transferLine.quantity);
        const currentQty = new Decimal(sourceItem.quantity);

        if (qtyToTransfer.lte(0) || qtyToTransfer.gt(currentQty)) {
          throw new BadRequestException(`Invalid transfer quantity ${transferLine.quantity}`);
        }

        if (qtyToTransfer.equals(currentQty)) {
          sourceItem.order_id = targetOrder.id;
          sourceItem.line_number = targetLineNo++;
          await em.save(OrderItem, sourceItem);
        } else {
          const remainingQty = currentQty.minus(qtyToTransfer);
          sourceItem.quantity = MoneyUtil.format(remainingQty, 4);
          sourceItem.base_total = MoneyUtil.multiply(sourceItem.unit_price, sourceItem.quantity);
          sourceItem.line_total = MoneyUtil.add(sourceItem.base_total, sourceItem.modifier_total || '0.0000');
          await em.save(OrderItem, sourceItem);

          const newItem = em.create(OrderItem, {
            tenant_id: tenantId,
            order_id: targetOrder.id,
            line_number: targetLineNo++,
            product_id: sourceItem.product_id,
            variant_id: sourceItem.variant_id,
            product_code: sourceItem.product_code,
            product_name: sourceItem.product_name,
            variant_name: sourceItem.variant_name,
            quantity: MoneyUtil.format(qtyToTransfer, 4),
            unit_price: sourceItem.unit_price,
            base_total: MoneyUtil.multiply(sourceItem.unit_price, MoneyUtil.format(qtyToTransfer, 4)),
            modifier_total: sourceItem.modifier_total,
            discount_total: '0.0000',
            tax_total: '0.0000',
            packaging_total: '0.0000',
            line_total: MoneyUtil.add(MoneyUtil.multiply(sourceItem.unit_price, MoneyUtil.format(qtyToTransfer, 4)), sourceItem.modifier_total || '0.0000'),
            notes: sourceItem.notes,
            state: sourceItem.state,
          });
          const savedNewItem = await em.save(OrderItem, newItem);

          if (sourceItem.options && sourceItem.options.length > 0) {
            for (const opt of sourceItem.options) {
              const newOpt = em.create(OrderItemOption, {
                tenant_id: tenantId,
                order_item_id: savedNewItem.id,
                option_item_id: opt.option_item_id,
                option_group_name: opt.option_group_name || '',
                option_item_name: opt.option_item_name || '',
                price_delta: opt.price_delta || '0.0000',
              });
              await em.save(OrderItemOption, newOpt);
            }
          }
        }
      }

      const link = em.create(OrderLink, {
        tenant_id: tenantId,
        from_order_id: sourceOrder.id,
        to_order_id: targetOrder.id,
        link_type: 'TRANSFER',
        details: { lines: dto.lines, reason: dto.reason },
      });
      await em.save(OrderLink, link);

      const updatedSource = await this.recalculateOrderTotals(tenantId, sourceOrder, em);
      const updatedTarget = await this.recalculateOrderTotals(tenantId, targetOrder, em);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'ORDER_ITEMS_TRANSFERRED',
        entityType: 'Order',
        entityId: sourceOrder.id,
        correlationId,
        details: { targetOrderId: targetOrder.id, reason: dto.reason },
      });

      return { source: updatedSource, target: updatedTarget };
    });
  }

  async getGuestBill(tenantId: string, id: string, locale: string = 'en') {
    const order = await this.getOrderById(tenantId, id);
    const isFa = locale === 'fa';

    const formattedItems = (order.items || [])
      .map((i) => {
        return `
          <tr>
            <td style="padding:8px; border-bottom:1px solid #eee;">${i.product_name} ${i.variant_name ? `(${i.variant_name})` : ''}</td>
            <td style="padding:8px; border-bottom:1px solid #eee; text-align:center;">${i.quantity}</td>
            <td style="padding:8px; border-bottom:1px solid #eee; text-align:right;">${i.unit_price} ${order.currency_code}</td>
            <td style="padding:8px; border-bottom:1px solid #eee; text-align:right;">${i.line_total} ${order.currency_code}</td>
          </tr>
        `;
      })
      .join('');

    const html = `
      <!DOCTYPE html>
      <html dir="${isFa ? 'rtl' : 'ltr'}">
      <head>
        <meta charset="utf-8" />
        <title>${isFa ? 'صورتحساب مشتری' : 'Guest Bill'} #${order.order_number}</title>
        <style>
          body { font-family: system-ui, sans-serif; padding: 20px; color: #333; }
          .bill-card { max-width: 450px; margin: 0 auto; border: 1px solid #ccc; padding: 20px; border-radius: 8px; }
          .header { text-align: center; border-bottom: 2px dashed #bbb; padding-bottom: 15px; margin-bottom: 15px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
          .totals-row { display: flex; justify-content: space-between; padding: 4px 0; }
          .grand-total { font-weight: bold; font-size: 1.2em; border-top: 2px solid #333; padding-top: 8px; margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="bill-card">
          <div class="header">
            <h2>${isFa ? 'پیش‌فاکتور میز' : 'Guest Bill'}</h2>
            <p>${isFa ? 'شماره سفارش' : 'Order'}: #${order.order_number}</p>
            ${order.table_number ? `<p>${isFa ? 'شماره میز' : 'Table'}: ${order.table_number}</p>` : ''}
            <p>${isFa ? 'تاریخ' : 'Date'}: ${new Date().toLocaleString()}</p>
          </div>
          <table>
            <thead>
              <tr>
                <th style="text-align:${isFa ? 'right' : 'left'};">${isFa ? 'کالا' : 'Item'}</th>
                <th>${isFa ? 'تعداد' : 'Qty'}</th>
                <th style="text-align:right;">${isFa ? 'قیمت' : 'Price'}</th>
                <th style="text-align:right;">${isFa ? 'جمع' : 'Total'}</th>
              </tr>
            </thead>
            <tbody>
              ${formattedItems}
            </tbody>
          </table>
          <div class="totals-row">
            <span>${isFa ? 'جمع کل' : 'Subtotal'}:</span>
            <span>${order.subtotal} ${order.currency_code}</span>
          </div>
          ${order.discount_total && order.discount_total !== '0.0000' ? `
          <div class="totals-row" style="color:red;">
            <span>${isFa ? 'تخفیف' : 'Discount'}:</span>
            <span>-${order.discount_total} ${order.currency_code}</span>
          </div>` : ''}
          ${order.tax_total && order.tax_total !== '0.0000' ? `
          <div class="totals-row">
            <span>${isFa ? 'مالیات' : 'Tax'}:</span>
            <span>+${order.tax_total} ${order.currency_code}</span>
          </div>` : ''}
          <div class="totals-row grand-total">
            <span>${isFa ? 'مبلغ قابل پرداخت' : 'Grand Total'}:</span>
            <span>${order.grand_total} ${order.currency_code}</span>
          </div>
        </div>
      </body>
      </html>
    `;

    return { html, order };
  }

  async getReceiptData(tenantId: string, id: string) {
    const order = await this.getOrderById(tenantId, id);

    let branchName = 'Tehran Central';
    let branchAddress = 'Tehran, Iran';
    let branchPhone = '+98 21 88000000';

    if (order.branch_id) {
      try {
        const branchRes = await this.dataSource.query(
          `SELECT name, address, phone FROM "branch" WHERE id = $1 LIMIT 1`,
          [order.branch_id],
        );
        if (branchRes && branchRes[0]) {
          branchName = branchRes[0].name || branchName;
          branchAddress = branchRes[0].address || branchAddress;
          branchPhone = branchRes[0].phone || branchPhone;
        }
      } catch {
        // Fallback to default branch info
      }
    }

    let tenders: any[] = [];
    try {
      const pays = await this.dataSource.query(
        `SELECT p.amount, p.reference_number, pm.name as method_name
         FROM "payment" p
         LEFT JOIN "payment_method" pm ON p.payment_method_id = pm.id
         WHERE p.order_id = $1 AND p.status = 'SUCCEEDED'`,
        [order.id],
      );
      tenders = pays.map((p: any) => ({
        payment_method_name: p.method_name || 'Card / Cash',
        amount: MoneyUtil.format(p.amount, 2),
        reference_number: p.reference_number || undefined,
      }));
    } catch {
      // Fallback
    }

    const items = (order.items || []).map((it) => ({
      product_name: it.product_name,
      quantity: MoneyUtil.format(it.quantity, 4),
      subtotal: MoneyUtil.format(it.line_total, 2),
      options: (it.options || []).map((opt) => ({
        name: opt.option_item_name,
        price_delta: MoneyUtil.format(opt.price_delta || '0', 2),
      })),
    }));

    return {
      receipt_header: {
        tenant_name: 'Gnext Retail System',
        branch_name: branchName,
        branch_address: branchAddress,
        branch_phone: branchPhone,
        order_number: order.order_number,
        order_type: order.order_type,
        table_number: order.table_number || undefined,
        placed_at: order.placed_at || (order as any).created_at || new Date().toISOString(),
      },
      items,
      totals: {
        subtotal_amount: MoneyUtil.format(order.subtotal || '0', 2),
        tax_amount: MoneyUtil.format(order.tax_total || '0', 2),
        discount_amount: MoneyUtil.format(order.discount_total || '0', 2),
        total_amount: MoneyUtil.format(order.total_amount || '0', 2),
        paid_amount: MoneyUtil.format(order.paid_amount || '0', 2),
      },
      tenders,
      receipt_footer: {
        bilingual_note_fa: 'از خرید شما متشکریم! لطفا فاکتور خود را نگهداری کنید.',
        bilingual_note_en: 'Thank you for your business! Please keep your receipt.',
      },
    };
  }
}

