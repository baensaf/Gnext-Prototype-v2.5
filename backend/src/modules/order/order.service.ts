import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In, IsNull } from 'typeorm';
import { CALENDAR_SETTING_KEY, formatBusinessDateTime, readCalendar } from '../../common/utils/calendar.util';
import { OrderHeader, OrderState } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { OperationalAlert } from '../../entities/OperationalAlert.entity';
import { OrderItemOption } from '../../entities/OrderItemOption.entity';
import { OrderAdjustment } from '../../entities/OrderAdjustment.entity';
import { OrderNote } from '../../entities/OrderNote.entity';
import { OrderLink } from '../../entities/OrderLink.entity';
import { OrderStateEvent } from '../../entities/OrderStateEvent.entity';
import { Product } from '../../entities/Product.entity';
import { Customer } from '../../entities/Customer.entity';
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { ProductOptionGroup } from '../../entities/ProductOptionGroup.entity';
import { DiscountEvaluationService } from '../discounts/discount-evaluation.service';
import { OrderSequenceService } from './order-sequence.service';
import { AuditWriter } from '../audit/audit-writer.service';
import { OutboxWriter } from '../outbox/outbox-writer.service';
import { OrderTransitionRecorder } from '../order-lifecycle/order-transition-recorder.service';
import { KdsService } from '../kds/kds.service';
import { PrintQueueService } from '../printing/print-queue.service';
import { SimulationService } from '../simulation/simulation.service';
import { CatalogService, REFUSED_SALE_CODES } from '../catalog/catalog.service';
import { PriceListService } from '../catalog/price-lists.service';
import { checkOptionChoices } from '../catalog/option-choices.util';
import { CreditService } from '../customer/credit.service';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { ReasonCode } from '../../entities/ReasonCode.entity';
import { assignCallNumber } from './call-number';
import {
  LIFECYCLE_SQL,
  LIFECYCLE_GROUPS,
  ORDER_EXPORT_LIMIT,
  UUID_PATTERN,
  applyOrderFilters,
  applyOrderSort,
  csvField,
  lifecycleGroupOf,
} from './order-list';
import Decimal from 'decimal.js';
import { MoneyUtil } from '../../common/utils/money.util';
import { pickSettingValue } from '../../common/utils/setting-scope.util';
import { BusinessDateUtil } from '../../common/utils/business-date.util';
import {
  SNAPPFOOD_DELAY_REASON_ID,
  SNAPPFOOD_REPORT_WINDOW_MINUTES,
  acceptNotice,
  isAggregatorOrder,
  maxPromiseMinutes,
  reportWindowEndsAt,
} from '../../common/utils/snappfood-order.util';
import { CashierShift } from '../../entities/CashierShift.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { currentTillTerminalId } from '../../common/utils/till-context';
import { Tenant } from '../../entities/Tenant.entity';
import { Branch } from '../../entities/Branch.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { DiningTable } from '../../entities/DiningTable.entity';
import { TableSession } from '../../entities/TableSession.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { DeliveryZone } from '../../entities/DeliveryZone.entity';
import { Delivery } from '../../entities/Delivery.entity';
import { DeliveryEvent } from '../../entities/DeliveryEvent.entity';
import { TableOccupancyEvent } from '../../entities/TableOccupancyEvent.entity';
import { Refund } from '../../entities/Refund.entity';
import { ApprovalService } from '../approval/approval.service';
import { RefundService } from '../refund/refund.service';
import {
  OrderActionConfig,
  OrderEditAction,
  resolveOrderActionConfig,
  resolveOrderEditDecision,
} from './order-edit-policy';
import { SplitOrderDto, TransferItemsDto } from '../dine-in/dtos/dine-in.dto';
import {
  OrderCreateDto,
  OrderUpdateDto,
  OrderQuoteRequestDto,
  OrderSubmitDto,
  OrderTransitionDto,
  OrderEditDto,
  OrderTypeChangeDto,
  OrderItemReplaceDto,
  OrderCancelDto,
  OrderReopenDto,
  OrderAcceptDto,
  OrderRejectDto,
  OrderSnappfoodReportDto,
} from './dtos/order.dto';

/**
 * OrderItem.state for a line that still counts. VOID lines were struck off by
 * an edit; REPLACED lines were superseded by a replacement. Both stay on the
 * order so history and reprints remain truthful, and both are excluded from
 * every total, quote, bill and receipt.
 */
const ACTIVE_LINE_STATE = 'ACTIVE';

const isActiveLine = (item: { state?: string }): boolean =>
  (item.state || ACTIVE_LINE_STATE) === ACTIVE_LINE_STATE;

// State Transition Matrix per Section 6.1
const ALLOWED_TRANSITIONS: Record<OrderState, OrderState[]> = {
  DRAFT: ['SUBMITTED', 'CONFIRMED', 'CANCELLED'],
  PENDING_ACCEPTANCE: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
  // A paid order may complete from any open state: a branch that prints kitchen tickets has
  // nothing that would ever move an order through PREPARING or READY first.
  SUBMITTED: ['CONFIRMED', 'COMPLETED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'COMPLETED', 'CANCELLED'],
  PREPARING: ['READY', 'COMPLETED', 'CANCELLED'],
  READY: ['OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['COMPLETED', 'READY', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: ['SUBMITTED'],
  REJECTED: [],
};

/** Actions that answer an order waiting in PENDING_ACCEPTANCE, and only such an order. */
const INCOMING_DECISIONS = ['ACCEPT', 'REJECT'];

/** Open states a takeaway order leaves by itself once it is paid in full. */
const PAID_TAKEAWAY_COMPLETES_FROM: OrderState[] = ['SUBMITTED', 'CONFIRMED', 'PREPARING', 'READY'];

/** States in which the kitchen has the order and has not yet handed it over. */
const KITCHEN_HOLDS_ORDER_STATES: OrderState[] = ['SUBMITTED', 'CONFIRMED', 'PREPARING', 'READY'];

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
    @InjectRepository(ProductVariant) private readonly variantRepo: Repository<ProductVariant>,
    @InjectRepository(OptionItem) private readonly optionItemRepo: Repository<OptionItem>,
    private readonly catalogService: CatalogService,
    private readonly priceLists: PriceListService,
    private readonly discountEngine: DiscountEvaluationService,
    private readonly sequenceService: OrderSequenceService,
    private readonly auditWriter: AuditWriter,
    private readonly outboxWriter: OutboxWriter,
    private readonly approvalService: ApprovalService,
    private readonly refundService: RefundService,
    private readonly dataSource: DataSource,
    private readonly transitionRecorder: OrderTransitionRecorder,
    @Optional() private readonly kdsService?: KdsService,
    @Optional() private readonly printQueueService?: PrintQueueService,
    @Optional() private readonly creditService?: CreditService,
    @Optional() @Inject(forwardRef(() => SimulationService)) private readonly simulationService?: SimulationService,
  ) {}

  /**
   * One page of the order book, filtered and sorted on the server (see `order-list.ts`).
   * Each row also carries its customer's name and mobile and, for a delivery, where it is
   * going and who has it, so the list needs no second lookup. `counts=1` adds the count of
   * every lifecycle group under the same filters, for the tabs.
   */
  async getOrders(tenantId: string, query: any) {
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.items', 'item')
      .leftJoinAndSelect('item.options', 'opt')
      .where('o.tenant_id = :tenantId', { tenantId });
    applyOrderFilters(qb, query, { currentAnyDate: true });
    applyOrderSort(qb, query);

    const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(query.limit || '50', 10) || 50));
    qb.skip((page - 1) * limit).take(limit);

    const [rows, total] = await qb.getManyAndCount();
    const data = await this.withListContext(tenantId, rows);
    const wantCounts = query.counts === '1' || query.counts === 'true';
    const counts = wantCounts ? await this.countOrderGroups(tenantId, query) : undefined;
    return { data, total, page, limit, ...(counts ? { counts } : {}) };
  }

  /** How many orders fall in each lifecycle group, under every filter but the group. */
  async countOrderGroups(tenantId: string, query: any): Promise<Record<string, number>> {
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .select(LIFECYCLE_SQL, 'grp')
      .addSelect('COUNT(*)', 'n')
      .where('o.tenant_id = :tenantId', { tenantId });
    applyOrderFilters(qb, query, { withGroup: false, currentAnyDate: true });
    const raw: Array<{ grp: string; n: string }> = await qb.groupBy('grp').getRawMany();

    const counts: Record<string, number> = { ALL: 0 };
    for (const group of LIFECYCLE_GROUPS) counts[group] = 0;
    for (const row of raw) {
      counts[row.grp] = Number(row.n);
      counts.ALL += Number(row.n);
    }
    return counts;
  }

  /** The names and places behind a page of orders: customer, delivery zone, delivery state, courier. */
  private async withListContext(tenantId: string, rows: OrderHeader[]) {
    if (rows.length === 0) return [];
    const orderIds = rows.map((o) => o.id);
    const customerIds = [...new Set(rows.map((o) => o.customer_id).filter(Boolean))];

    const [customers, deliveries] = await Promise.all([
      customerIds.length
        ? this.dataSource.query(
            `SELECT id,
                    COALESCE(NULLIF(concat_ws(' ', first_name, last_name), ''), full_name) AS name,
                    COALESCE(mobile, phone) AS mobile
               FROM customer WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
            [tenantId, customerIds],
          )
        : [],
      this.dataSource.query(
        `SELECT DISTINCT ON (d.order_id) d.order_id, d.state, d.zone_id, c.name AS courier_name,
                d.address_snapshot->>'address_text' AS address_text
           FROM delivery d LEFT JOIN courier c ON c.id = d.courier_id AND c.tenant_id = d.tenant_id
          WHERE d.tenant_id = $1 AND d.order_id = ANY($2::uuid[])
          ORDER BY d.order_id, d.created_at DESC`,
        [tenantId, orderIds],
      ),
    ]);

    const customerById = new Map<string, any>(customers.map((c: any) => [c.id, c]));
    const deliveryByOrder = new Map<string, any>(deliveries.map((d: any) => [d.order_id, d]));
    const zoneIds = [
      ...new Set(
        [...rows.map((o) => o.delivery_zone_id), ...deliveries.map((d: any) => d.zone_id)].filter(Boolean),
      ),
    ];
    const zones: Array<{ id: string; name: string }> = zoneIds.length
      ? await this.dataSource.query(`SELECT id, name FROM delivery_zone WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [
          tenantId,
          zoneIds,
        ])
      : [];
    const zoneById = new Map(zones.map((z) => [z.id, z.name]));

    return rows.map((o) => {
      const customer = o.customer_id ? customerById.get(o.customer_id) : null;
      const delivery = deliveryByOrder.get(o.id);
      const zoneId = delivery?.zone_id || o.delivery_zone_id;
      return {
        ...o,
        lifecycle: lifecycleGroupOf(o),
        customer_name: customer?.name || null,
        customer_mobile: customer?.mobile || null,
        delivery_zone_name: zoneId ? zoneById.get(zoneId) || null : null,
        delivery_state: delivery?.state || null,
        courier_name: delivery?.courier_name || null,
        delivery_address: delivery?.address_text || null,
      };
    });
  }

  /** The filtered order book as CSV, for head office to take into a spreadsheet. */
  async exportOrdersCsv(tenantId: string, query: any): Promise<string> {
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.items', 'item')
      .where('o.tenant_id = :tenantId', { tenantId });
    applyOrderFilters(qb, query);
    applyOrderSort(qb, query);
    qb.take(ORDER_EXPORT_LIMIT);
    const rows = await this.withListContext(tenantId, await qb.getMany());

    const branches: Array<{ id: string; name: string }> = await this.dataSource.query(
      `SELECT id, name FROM branch WHERE tenant_id = $1`,
      [tenantId],
    );
    const branchName = new Map(branches.map((b) => [b.id, b.name]));

    const header = [
      'order_number', 'call_number', 'branch', 'placed_at', 'business_date', 'channel', 'order_type',
      'status', 'lifecycle', 'customer', 'mobile', 'table', 'delivery_zone', 'courier', 'items',
      'grand_total', 'paid_total', 'refunded_total', 'outstanding_total', 'currency',
    ];
    const lines = rows.map((o) =>
      [
        o.order_number,
        o.call_number,
        branchName.get(o.branch_id) || o.branch_id,
        o.placed_at ? new Date(o.placed_at).toISOString() : '',
        o.business_date,
        o.channel,
        o.order_type,
        o.status,
        o.lifecycle,
        o.customer_name,
        o.customer_mobile,
        o.table_number,
        o.delivery_zone_name,
        o.courier_name,
        (o.items || []).filter(isActiveLine).reduce((sum, i) => sum + Number(i.quantity || 0), 0),
        o.grand_total,
        o.paid_total,
        o.refunded_total,
        o.outstanding_total,
        o.currency_code,
      ]
        .map(csvField)
        .join(','),
    );
    // The byte-order mark lets Excel read the Persian names as UTF-8.
    return String.fromCharCode(0xfeff) + [header.join(','), ...lines].join('\r\n') + '\r\n';
  }

  /**
   * What the order drawer shows beyond the order itself: where a delivery is going, the
   * register it was rung up on, the customer's mobile, and the names of the people in its
   * history.
   */
  async getOrderContext(tenantId: string, order: OrderHeader) {
    const [delivery, terminal, auditActors, customer] = await Promise.all([
      this.dataSource.query(
        `SELECT d.state, d.address_snapshot->>'address_text' AS address_text, d.zone_id
           FROM delivery d WHERE d.tenant_id = $1 AND d.order_id = $2
          ORDER BY d.created_at DESC LIMIT 1`,
        [tenantId, order.id],
      ),
      order.terminal_id
        ? this.dataSource.query(`SELECT name, code FROM terminal WHERE tenant_id = $1 AND id = $2`, [
            tenantId,
            order.terminal_id,
          ])
        : [],
      this.dataSource.query(
        `SELECT DISTINCT COALESCE(actor_id, user_id)::text AS id FROM audit_event
          WHERE tenant_id = $1 AND entity_id = $2 AND COALESCE(actor_id, user_id) IS NOT NULL`,
        [tenantId, order.id],
      ),
      order.customer_id
        ? this.dataSource.query(`SELECT COALESCE(mobile, phone) AS mobile FROM customer WHERE tenant_id = $1 AND id = $2`, [
            tenantId,
            order.customer_id,
          ])
        : [],
    ]);

    let address: string | null = delivery[0]?.address_text || null;
    if (!address && order.customer_address_id) {
      const rows = await this.dataSource.query(
        `SELECT address_text FROM customer_address WHERE tenant_id = $1 AND id = $2`,
        [tenantId, order.customer_address_id],
      );
      address = rows[0]?.address_text || null;
    }
    const zoneId = delivery[0]?.zone_id || order.delivery_zone_id;
    const zone = zoneId
      ? await this.dataSource.query(`SELECT name FROM delivery_zone WHERE tenant_id = $1 AND id = $2`, [tenantId, zoneId])
      : [];

    const actorIds = [
      ...new Set(
        [...(order.stateEvents || []).map((e) => e.occurred_by), ...auditActors.map((a: any) => a.id), order.created_by]
          .filter((id): id is string => !!id && UUID_PATTERN.test(id)),
      ),
    ];
    const actors: Array<{ id: string; name: string }> = actorIds.length
      ? await this.dataSource.query(
          `SELECT id, COALESCE(NULLIF(display_name, ''), username) AS name
             FROM admin_user WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tenantId, actorIds],
        )
      : [];

    return {
      delivery_address: address,
      delivery_zone_name: zone[0]?.name || null,
      delivery_state: delivery[0]?.state || null,
      terminal_name: terminal[0] ? terminal[0].name || terminal[0].code : null,
      customer_mobile: customer[0]?.mobile || null,
      actor_names: Object.fromEntries(actors.map((a) => [a.id, a.name])),
    };
  }

  async getOrderById(tenantId: string, id: string) {
    const order = await this.orderRepo.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['items', 'items.options', 'adjustments', 'stateEvents'],
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  /**
   * Who an order involves, by name: its customer, the account that took it, and the courier
   * who carried it. The delivery record names the current courier; an assignment row is only
   * consulted when there is no delivery, as on orders dispatched before deliveries existed.
   */
  async getOrderPeople(tenantId: string, order: { id: string; customer_id: string | null; created_by: string | null }) {
    const [customer, takenBy, courier] = await Promise.all([
      order.customer_id
        ? this.dataSource.query(
            `SELECT id, code, first_name, last_name FROM customer WHERE tenant_id = $1 AND id = $2`,
            [tenantId, order.customer_id],
          )
        : [],
      order.created_by
        ? this.dataSource.query(
            `SELECT id, username, display_name FROM admin_user WHERE tenant_id = $1 AND id = $2`,
            [tenantId, order.created_by],
          )
        : [],
      this.dataSource.query(
        `SELECT c.id, c.code, c.name
           FROM (
             SELECT d.courier_id, 0 AS preference, d.assigned_at FROM delivery d
              WHERE d.tenant_id = $1 AND d.order_id = $2 AND d.courier_id IS NOT NULL
             UNION ALL
             SELECT da.courier_id, 1 AS preference, da.assigned_at FROM delivery_assignment da
              WHERE da.tenant_id = $1 AND da.order_id = $2
           ) handed
           JOIN courier c ON c.id = handed.courier_id AND c.tenant_id = $1
          ORDER BY handed.preference, handed.assigned_at DESC NULLS LAST
          LIMIT 1`,
        [tenantId, order.id],
      ),
    ]);
    return { customer: customer[0] ?? null, taken_by: takenBy[0] ?? null, courier: courier[0] ?? null };
  }

  /**
   * The register an order is rung up on, and the shift open on it at the time.
   *
   * The POS never named either, so every order had a null shift: a shift statement always
   * showed zero orders, and nothing tied a sale to the drawer it was taken at. The register
   * is the one the order names or, failing that, the device the request came from; it must
   * stand in the order's branch, and a stray one is dropped rather than refusing the sale.
   * The shift is looked up here rather than taken from the client.
   */
  private async registerForNewOrder(
    em: EntityManager,
    tenantId: string,
    dto: OrderCreateDto,
  ): Promise<{ terminalId: string | null; shiftId: string | null }> {
    const terminalId = dto.terminal_id || currentTillTerminalId();
    if (!terminalId) return { terminalId: null, shiftId: dto.shift_id || null };

    const terminal = await em.findOne(Terminal, { where: { id: terminalId, tenant_id: tenantId } });
    if (!terminal || terminal.branch_id !== dto.branch_id) return { terminalId: null, shiftId: null };

    const shift = await em.findOne(CashierShift, {
      where: [
        { tenant_id: tenantId, terminal_id: terminal.id, state: 'OPEN' },
        { tenant_id: tenantId, terminal_id: terminal.id, state: 'CLOSING_REVIEW' },
      ],
    });
    return { terminalId: terminal.id, shiftId: shift?.id ?? null };
  }

  /**
   * A customer the chain has refused cannot be put on a new order — any channel, any
   * payment method. Blocking their credit account would only stop them paying on account;
   * this is the stronger statement, that we are not serving them at all.
   *
   * The reason travels in the error so the cashier facing the customer is told why, rather
   * than being left with a refusal they cannot explain.
   */
  private async assertCustomerServable(em: EntityManager, tenantId: string, customerId?: string | null) {
    if (!customerId) return;
    const customer = await em.findOne(Customer, { where: { id: customerId, tenant_id: tenantId } });
    if (!customer) return; // A missing customer is the existing foreign-key's complaint, not this one's.
    if (customer.is_blocked) {
      throw new BadRequestException(
        `CUSTOMER_BLOCKED: ${customer.first_name} ${customer.last_name} cannot be served${
          customer.blocked_reason ? ` (${customer.blocked_reason})` : ''
        }`,
      );
    }
  }

  async createDraft(tenantId: string, dto: OrderCreateDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      await this.assertCustomerServable(em, tenantId, dto.customer_id);
      const orderNumber = await this.sequenceService.generateOrderNumber(tenantId, em);
      const currencyCode = dto.currency_code || 'IRR';
      const channel = dto.channel || 'POS';
      const orderType = dto.order_type || 'DINE_IN';
      const register = await this.registerForNewOrder(em, tenantId, dto);

      const order = em.create(OrderHeader, {
        tenant_id: tenantId,
        branch_id: dto.branch_id,
        terminal_id: register.terminalId,
        shift_id: register.shiftId,
        order_number: orderNumber,
        channel,
        order_type: orderType,
        state: 'DRAFT' as OrderState,
        status: 'DRAFT',
        currency_code: currencyCode,
        quote_version: '1',
        customer_id: dto.customer_id || null,
        customer_address_id: dto.delivery_address_id || null,
        delivery_zone_id: dto.delivery_zone_id || null,
        table_id: dto.table_id || null,
        table_number: dto.table_number || null,
        guest_count: dto.guest_count || null,
        coupon_code: dto.coupon_code ? dto.coupon_code.toUpperCase() : null,
        notes: dto.notes || null,
        created_by: userId || null,
      });

      await this.applyDeliveryZoneFee(tenantId, order, em);
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

      // Attaching a customer to an existing draft is the other way one lands on an order.
      if (dto.customer_id !== undefined && dto.customer_id !== order.customer_id) {
        await this.assertCustomerServable(em, tenantId, dto.customer_id);
      }

      if (dto.branch_id !== undefined) order.branch_id = dto.branch_id;
      if (dto.order_type !== undefined) order.order_type = dto.order_type as any;
      if (dto.customer_id !== undefined) order.customer_id = dto.customer_id;
      if (dto.table_id !== undefined) order.table_id = dto.table_id;
      if (dto.table_number !== undefined) order.table_number = dto.table_number;
      if (dto.guest_count !== undefined) order.guest_count = dto.guest_count;
      if (dto.notes !== undefined) order.notes = dto.notes;
      if (dto.coupon_code !== undefined) order.coupon_code = dto.coupon_code;
      if (dto.terminal_id !== undefined) order.terminal_id = dto.terminal_id;
      if (dto.shift_id !== undefined) order.shift_id = dto.shift_id;
      if (dto.channel !== undefined) order.channel = dto.channel;
      if (dto.delivery_address_id !== undefined) order.customer_address_id = dto.delivery_address_id;
      if (dto.delivery_zone_id !== undefined) order.delivery_zone_id = dto.delivery_zone_id;
      if (dto.currency_code !== undefined) order.currency_code = dto.currency_code;

      await this.applyDeliveryZoneFee(tenantId, order, em);

      // Update quoteVersion
      order.quote_version = String(Date.now());
      order.updated_by = userId || null;

      // Persist header changes before replacing the loaded item relation. Saving
      // the aggregate after deleting its loaded children makes TypeORM try to
      // orphan those stale entities by setting order_id to NULL, which violates
      // the non-null foreign key on order_item.
      await em.save(OrderHeader, order);

      if (dto.items) {
        // Clear existing items and re-add
        await em.delete(OrderItem, { order_id: id });
        await this.addItemsToDraft(tenantId, order, dto.items, em);
      }

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

    const draftItems = (order.items || []).filter(isActiveLine).map((i) => {
      const modPerUnit = (i.quantity && Number(i.quantity) > 0 && i.modifier_total)
        ? MoneyUtil.divide(i.modifier_total, i.quantity)
        : '0.0000';
      const effectiveUnitPrice = MoneyUtil.add(i.unit_price || '0.0000', modPerUnit);
      return {
        productId: i.product_id,
        variantId: i.variant_id || undefined,
        unitPrice: effectiveUnitPrice,
        quantity: i.quantity,
      };
    });

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

      const deliveryContext = order.order_type === 'DELIVERY'
        ? await this.validateDeliveryContext(tenantId, order, em, true)
        : null;

      // Check stale quote if version provided
      if (dto.quoteVersion && dto.quoteVersion !== order.quote_version) {
        const freshQuote = await this.evaluateOrderQuote(tenantId, order, { couponCode: order.coupon_code });
        throw new ConflictException({
          statusCode: 409,
          code: 'QUOTE_STALE',
          message: 'Prices, discounts, or order totals have changed since the last quote',
          freshQuote,
        });
      }

      // Resolve the manual discount to price with. The client sends the discount the
      // cashier actually entered; approvalRequestIds carries the manager escalation for
      // it when one was needed. An approval id on its own is NOT a discount — it must
      // never be turned into an assumed value, or the order prices differently from the
      // quote the cashier saw and approved.
      const submittedManualDiscount = dto.manualDiscount
        ? {
            ...dto.manualDiscount,
            approvalRequestId: dto.manualDiscount.approvalRequestId || dto.approvalRequestIds?.[0],
          }
        : MoneyUtil.greaterThan(order.discount_total || order.discount_amount || '0.0000', '0.0000')
          ? {
              calculation_type: 'FIXED_AMOUNT' as const,
              value: order.discount_total || order.discount_amount,
              approvalRequestId: dto.approvalRequestIds?.[0],
            }
          : undefined;

      // Evaluate discounts & totals
      const quoteRes = await this.discountEngine.evaluateQuote(tenantId, {
        orderDraft: {
          branchId: order.branch_id,
          customerId: order.customer_id || undefined,
          channel: order.channel,
          orderType: order.order_type,
          currencyCode: order.currency_code,
          deliveryFee: order.delivery_fee,
          items: order.items.filter(isActiveLine).map((i) => {
            const modPerUnit = (i.quantity && Number(i.quantity) > 0 && i.modifier_total)
              ? MoneyUtil.divide(i.modifier_total, i.quantity)
              : '0.0000';
            const effectiveUnitPrice = MoneyUtil.add(i.unit_price || '0.0000', modPerUnit);
            return {
              productId: i.product_id,
              variantId: i.variant_id || undefined,
              unitPrice: effectiveUnitPrice,
              quantity: i.quantity,
            };
          }),
        },
        manualDiscount: submittedManualDiscount,
        couponCode: order.coupon_code || undefined,
      });

      // A coupon is the one discount with a use limit, so its redemption is counted here,
      // inside the transaction. Before this passed the coupon, only the hidden campaign
      // behind it was counted and the coupon's own uses never moved.
      const appliedCoupon = quoteRes.consideredDiscounts.find(
        (d) => d.status === 'APPLIED' && d.source === 'COUPON' && d.couponId,
      );
      if (appliedCoupon) {
        await this.discountEngine.consumeUsage(
          tenantId,
          order.id,
          order.customer_id || undefined,
          appliedCoupon.couponId!,
          appliedCoupon.amount,
          em,
        );
      }

      // Persist OrderAdjustment records for applied discounts
      const appliedDiscounts = quoteRes.consideredDiscounts.filter((d) => d.status === 'APPLIED');
      for (const disc of appliedDiscounts) {
        const adj = em.create(OrderAdjustment, {
          tenant_id: tenantId,
          order_id: order.id,
          type: 'DISCOUNT',
          source_type: disc.source,
          source_id: disc.couponId || null,
          code: disc.couponCode || (disc.source === 'MANUAL' ? 'MANUAL_DISCOUNT' : null),
          name: disc.name,
          amount: disc.amount,
          funding_source: 'MERCHANT',
          // A manual discount keeps the escalation that allowed it, so the manual-discounts
          // report can say who approved it instead of guessing.
          calculation_snapshot: {
            discountType: disc.discountType,
            amount: disc.amount,
            ...(disc.source === 'MANUAL' ? { approvalRequestId: submittedManualDiscount?.approvalRequestId || null } : {}),
          },
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

      // Stamp the operating day the order belongs to. Without this, business_date stays
      // NULL on every POS order and closeBusinessDay — which aggregates on business_date —
      // reports nothing. Prefer the open shift's date so the order, the shift and the day
      // close agree by construction rather than by coincidence of clock.
      if (!order.business_date) {
        const shiftForOrder = order.shift_id
          ? await em.findOne(CashierShift, { where: { id: order.shift_id, tenant_id: tenantId } })
          : null;
        order.business_date = shiftForOrder?.business_date || BusinessDateUtil.today();
      }

      // Determine state transition: POS/KIOSK can move directly to CONFIRMED
      const targetState: OrderState = (order.channel === 'POS' || order.channel === 'KIOSK') ? 'CONFIRMED' : 'SUBMITTED';
      const fromState = order.state;
      order.state = targetState;
      order.status = targetState;
      order.submitted_at = new Date();

      await em.save(OrderHeader, order);
      // The number the counter calls it by, given as it goes to the kitchen so an abandoned
      // cart does not use one up.
      await assignCallNumber(em, order);

      if (deliveryContext) {
        const existingDelivery = await em.findOne(Delivery, { where: { tenant_id: tenantId, order_id: order.id } });
        if (!existingDelivery) {
          const delivery = em.create(Delivery, {
            tenant_id: tenantId,
            order_id: order.id,
            zone_id: deliveryContext.zone.id,
            state: 'UNASSIGNED',
            fee: deliveryContext.zone.fee,
            currency_code: order.currency_code || 'IRR',
            address_snapshot: {
              address_id: deliveryContext.address.id,
              title: deliveryContext.address.title,
              address_text: deliveryContext.address.address_text,
              postal_code: deliveryContext.address.postal_code || null,
              customer_id: order.customer_id,
            },
          });
          const savedDelivery = await em.save(Delivery, delivery);
          await em.save(DeliveryEvent, em.create(DeliveryEvent, {
            tenant_id: tenantId,
            delivery_id: savedDelivery.id,
            from_state: 'NONE',
            to_state: 'UNASSIGNED',
            reason: 'Delivery order submitted',
            occurred_by: userId || null,
          }));
        }
      }

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
        await this.printQueueService.enqueueOrderPrintJobs(tenantId, id, 'KITCHEN_TICKET', false, undefined, userId);
        await this.printCustomerPaperwork(tenantId, id, userId);
      } catch (e) {
        // Printing side effect error must not fail submit
      }
    }

    return res;
  }

  /**
   * The paper that goes with an order once the kitchen has it: a courier slip for a delivery,
   * and the customer's receipt once it is paid for. A receipt printed at the till before the
   * money was taken said "unpaid" on a paid order, so an order paid later gets it from
   * `afterPaymentSucceeded`. Each prints once; a second copy is a reprint.
   */
  private async printCustomerPaperwork(tenantId: string, orderId: string, userId?: string) {
    if (!this.printQueueService) return;
    const order = await this.orderRepo.findOne({ where: { id: orderId, tenant_id: tenantId } });
    if (!order || ['DRAFT', 'PENDING_ACCEPTANCE', 'CANCELLED', 'REJECTED'].includes(order.state)) return;

    // A Snappfood order the store delivers itself needs the slip too: it is typed AGGREGATOR,
    // and only its expedition says whose rider is coming.
    const ownCourier = order.order_type === 'DELIVERY' || order.aggregator_expedition === 'DELIVERY';
    if (ownCourier && !(await this.printQueueService.hasPrinted(tenantId, orderId, 'COURIER_SLIP'))) {
      await this.printQueueService.enqueueOrderPrintJobs(tenantId, orderId, 'COURIER_SLIP', false, undefined, userId);
    }
    const paid = !MoneyUtil.greaterThan(order.outstanding_total || '0.0000', '0.0000');
    if (paid && !(await this.printQueueService.hasPrinted(tenantId, orderId, 'CUSTOMER_RECEIPT'))) {
      await this.printQueueService.enqueueOrderPrintJobs(tenantId, orderId, 'CUSTOMER_RECEIPT', false, undefined, userId);
    }
  }

  /**
   * A kiosk order waits for its guest's card before the kitchen sees it. Once it is paid in
   * full it is confirmed, numbered and fired, whether the card went through the branch's
   * terminal (the agent answers later) or the kiosk's simulator. One that the branch wants
   * staff to accept keeps waiting; accepting it does the same.
   */
  private async sendPaidKioskOrderToKitchen(tenantId: string, orderId: string, correlationId?: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId, tenant_id: tenantId } });
    if (!order || order.channel !== 'KIOSK' || order.state !== 'SUBMITTED') return;
    if (MoneyUtil.greaterThan(order.outstanding_total || '0.0000', '0.0000')) return;

    order.state = 'CONFIRMED';
    order.status = 'CONFIRMED';
    order.submitted_at = order.submitted_at || new Date();
    order.business_date = order.business_date || BusinessDateUtil.today();
    await this.orderRepo.save(order);
    await assignCallNumber(this.dataSource.manager, order);

    if (this.kdsService) {
      try {
        await this.kdsService.generateTicketsForOrder(tenantId, orderId, correlationId);
      } catch {
        // A kitchen-screen failure must not undo a payment the guest has already made.
      }
    }
    if (this.printQueueService) {
      await this.printQueueService.enqueueOrderPrintJobs(tenantId, orderId, 'KITCHEN_TICKET', false);
    }
  }

  /**
   * After a payment has committed: the receipt, once the order is paid in full, and a paid
   * takeaway closed. Both are side effects of money already taken, so neither may fail the
   * payment.
   */
  async afterPaymentSucceeded(tenantId: string, orderId: string, userId?: string, correlationId?: string) {
    try {
      await this.sendPaidKioskOrderToKitchen(tenantId, orderId, correlationId);
    } catch (err) {
      console.error(`Kiosk order ${orderId} could not be sent to the kitchen after payment`, err);
    }
    try {
      await this.printCustomerPaperwork(tenantId, orderId, userId);
    } catch {
      // A receipt that does not print is reprinted from the order; the payment stands.
    }
    return await this.completeWhenPaidInFull(tenantId, orderId, userId, correlationId);
  }

  /** Derive delivery cost from the selected active branch zone; never accept a client fee. */
  private async applyDeliveryZoneFee(tenantId: string, order: OrderHeader, em: EntityManager) {
    if (order.order_type !== 'DELIVERY') {
      order.delivery_fee = '0.0000';
      return;
    }
    if (!order.delivery_zone_id) {
      order.delivery_fee = '0.0000';
      return;
    }
    const zone = await em.findOne(DeliveryZone, {
      where: { id: order.delivery_zone_id, tenant_id: tenantId, branch_id: order.branch_id, is_active: true },
    });
    order.delivery_fee = zone?.fee || '0.0000';
  }

  private async validateDeliveryContext(tenantId: string, order: OrderHeader, em: EntityManager, requireComplete: boolean) {
    if (!order.customer_id) {
      if (requireComplete) throw new BadRequestException('DELIVERY_CUSTOMER_REQUIRED');
      return null;
    }
    if (!order.customer_address_id) {
      if (requireComplete) throw new BadRequestException('DELIVERY_ADDRESS_REQUIRED');
      return null;
    }
    if (!order.delivery_zone_id) {
      if (requireComplete) throw new BadRequestException('DELIVERY_ZONE_REQUIRED');
      return null;
    }
    const address = await em.findOne(CustomerAddress, {
      where: { id: order.customer_address_id, tenant_id: tenantId },
    });
    if (!address) throw new BadRequestException('DELIVERY_ADDRESS_NOT_FOUND');
    if (address.customer_id !== order.customer_id) throw new BadRequestException('DELIVERY_ADDRESS_CUSTOMER_MISMATCH');
    const zone = await em.findOne(DeliveryZone, {
      where: { id: order.delivery_zone_id, tenant_id: tenantId },
    });
    if (!zone) throw new BadRequestException('DELIVERY_ZONE_NOT_FOUND');
    if (!zone.is_active) throw new BadRequestException('DELIVERY_ZONE_INACTIVE');
    if (zone.branch_id !== order.branch_id) throw new BadRequestException('DELIVERY_ZONE_BRANCH_MISMATCH');
    order.delivery_fee = zone.fee;
    return { address, zone };
  }

  async transitionState(
    tenantId: string,
    id: string,
    action: string,
    // promisedMinutes rides along with an accept, and only an accept.
    dto: OrderTransitionDto & { promisedMinutes?: number },
    userId?: string,
    correlationId?: string,
  ) {
    const decidesIncoming = INCOMING_DECISIONS.includes(action.toUpperCase());
    return await this.dataSource.transaction(async (em) => {
      // Accept and reject lock the row: two cashiers on the same incoming order queue up
      // here, and the second finds it already decided.
      const order = await em.findOne(OrderHeader, {
        where: { id, tenant_id: tenantId },
        ...(decidesIncoming ? { lock: { mode: 'pessimistic_write' as const } } : {}),
      });
      if (!order) throw new NotFoundException(`Order ${id} not found`);

      if (decidesIncoming && order.state !== 'PENDING_ACCEPTANCE') {
        throw new ConflictException({
          code: 'ORDER_ALREADY_DECIDED',
          message: `Order ${order.order_number} is ${order.state}, not awaiting acceptance`,
        });
      }
      // Confirming a waiting order would skip the kitchen, and cancelling it would leave
      // Snappfood untold. The store answers it through accept or reject instead.
      if (!decidesIncoming && order.state === 'PENDING_ACCEPTANCE') {
        throw new ConflictException({
          code: 'ORDER_AWAITING_ACCEPTANCE',
          message: `Order ${order.order_number} is awaiting acceptance; accept or reject it`,
        });
      }

      const targetState = this.mapActionToTargetState(action);
      // Once the store has accepted a Snappfood order, only Snappfood cancels it, and a
      // cancelled one stays cancelled. The store reports a problem to Snappfood instead.
      if (targetState === 'CANCELLED' || order.state === 'CANCELLED') {
        this.refuseSnappfoodChange(order, 'cancel or reopen it');
      }
      const allowedNextStates = ALLOWED_TRANSITIONS[order.state] || [];

      if (!allowedNextStates.includes(targetState)) {
        throw new BadRequestException(`Cannot transition order ${order.order_number} from state ${order.state} to ${targetState} via action ${action}`);
      }

      // Completed means nothing is owed. Money still due is collected first, or the order
      // is cancelled; completing it would close the check with the balance unpaid.
      if (targetState === 'COMPLETED' && MoneyUtil.greaterThan(order.outstanding_total || '0.0000', '0.0000')) {
        throw new ConflictException({
          code: 'ORDER_HAS_BALANCE',
          message: `Order ${order.order_number} still has ${order.outstanding_total} to pay; take the payment before completing it`,
        });
      }

      const fromState = order.state;
      order.state = targetState;
      order.status = targetState;

      if (action.toUpperCase() === 'ACCEPT') {
        order.accepted_at = new Date();
        order.promised_minutes = dto.promisedMinutes ?? null;
      }

      if (targetState === 'COMPLETED') {
        order.completed_at = new Date();
      } else if (targetState === 'CANCELLED') {
        order.cancelled_at = new Date();
        order.cancellation_reason_code_id = dto.reasonCodeId || null;
      }

      await em.save(OrderHeader, order);

      // History, outbox event, audit and, on completion, the loyalty cashback. Tables, couriers
      // and the kitchen screen record their transitions through the same recorder.
      await this.transitionRecorder.record(em, {
        tenantId,
        order,
        fromState,
        action,
        userId,
        correlationId,
        reasonCodeId: dto.reasonCodeId,
        reasonText: dto.reasonText,
        approvalRequestId: dto.approvalRequestId,
      });

      return order;
    });
  }

  /**
   * A takeaway order is done once it is paid for: nobody taps "handed over" at a busy
   * counter, and an order left open never pays out its loyalty cashback. Dine-in waits for
   * the table to close and delivery for the courier, so both are left alone. Returns the
   * order when this completed it, otherwise null.
   */
  async completeWhenPaidInFull(
    tenantId: string,
    orderId: string,
    userId?: string,
    correlationId?: string,
  ): Promise<OrderHeader | null> {
    const order = await this.orderRepo.findOne({ where: { id: orderId, tenant_id: tenantId } });
    if (!order || order.order_type !== 'TAKEAWAY') return null;
    if (!PAID_TAKEAWAY_COMPLETES_FROM.includes(order.state)) return null;
    if (MoneyUtil.greaterThan(order.outstanding_total || '0.0000', '0.0000')) return null;

    return await this.transitionState(
      tenantId,
      orderId,
      'COMPLETE',
      { reasonText: 'Paid in full' },
      userId,
      correlationId,
    );
  }

  /**
   * The store takes an incoming order: confirm it, fire it to the kitchen and its printer,
   * then tell the aggregator. Local first, so the branch keeps serving when Snappfood is
   * slow or down; a failed notice does not undo the accept.
   */
  async acceptIncomingOrder(tenantId: string, id: string, dto: OrderAcceptDto, userId?: string, correlationId?: string) {
    // Snappfood refuses a promise past its limit for the order. Say so before the kitchen
    // has it, not after the store has already started cooking.
    const waiting = await this.orderRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (waiting && isAggregatorOrder(waiting) && dto.prepMinutes > maxPromiseMinutes(waiting)) {
      const maxMinutes = maxPromiseMinutes(waiting);
      throw new BadRequestException({
        code: 'PROMISE_OVER_SNAPPFOOD_LIMIT',
        message: `Snappfood takes at most ${maxMinutes} minutes for order ${waiting.order_number}`,
        maxMinutes,
      });
    }

    const order = await this.transitionState(
      tenantId,
      id,
      'ACCEPT',
      { reasonText: `Prep time ${dto.prepMinutes} min`, promisedMinutes: dto.prepMinutes },
      userId,
      correlationId,
    );
    // Numbered as it reaches the kitchen: a rejected order never takes one.
    await assignCallNumber(this.dataSource.manager, order);

    if (this.kdsService && isAggregatorOrder(order)) {
      try {
        // Snappfood support sent the order back changed after the kitchen had it. The lines
        // it struck off come off the tickets before the new ones go on.
        const struckOff = await this.itemRepo.find({ where: { tenant_id: tenantId, order_id: id, state: 'VOID' } });
        for (const line of struckOff) {
          await this.kdsService.cancelTicketItemsForOrderItem(tenantId, line.id, userId);
        }
      } catch (e) {
        // Like the tickets below, a kitchen side effect must not fail the accept
      }
    }

    if (this.kdsService) {
      try {
        await this.kdsService.generateTicketsForOrder(tenantId, id, correlationId);
      } catch (e) {
        // KDS side effect error must not fail the accept
      }
    }

    if (this.printQueueService) {
      try {
        await this.printQueueService.enqueueOrderPrintJobs(tenantId, id, 'KITCHEN_TICKET', false, undefined, userId);
        // An online order arrives paid: its receipt and slip go in the bag.
        await this.printCustomerPaperwork(tenantId, id, userId);
      } catch (e) {
        // Printing side effect error must not fail the accept
      }
    }

    await this.closeArrivalAlert(tenantId, order, userId);
    const snappfoodCode = this.snappfoodOrderCode(order);
    if (snappfoodCode && this.simulationService) {
      try {
        await this.simulationService.notifyAccepted(tenantId, snappfoodCode, acceptNotice(order, dto.prepMinutes));
      } catch (e) {
        // The accept stands. Retrying a missed notice through the outbox is not built yet.
      }
    }

    return order;
  }

  /**
   * The store turns an incoming order down. Nothing reaches the kitchen, and the reason must
   * be one of Snappfood's decline reasons, because that is what goes back to Snappfood.
   */
  async rejectIncomingOrder(tenantId: string, id: string, dto: OrderRejectDto, userId?: string, correlationId?: string) {
    const reason = (await this.getDeclineReasons()).find((r) => r.id === dto.reasonId);
    if (!reason) {
      throw new BadRequestException({ code: 'UNKNOWN_DECLINE_REASON', message: `No decline reason ${dto.reasonId}` });
    }
    const reasonText = [`${reason.id} ${reason.title}`, dto.comment].filter(Boolean).join(': ');
    return this.rejectWith(tenantId, id, reasonText, { reasonId: dto.reasonId, comment: dto.comment }, userId, correlationId);
  }

  /**
   * Nobody answered within the branch's time limit, so the system turns the order down.
   * No person acted: the state event carries no user and the audit entry reads SYSTEM.
   */
  async rejectUnanswered(tenantId: string, id: string, minutes: number, correlationId?: string) {
    const reasonText = `Not answered within ${minutes} min; rejected automatically`;
    // Snappfood refuses a reject that names none of its decline reasons. None of them says
    // nobody answered; 153, a delay in sending the order, is the nearest.
    return this.rejectWith(tenantId, id, reasonText, { reasonId: 153, comment: reasonText }, undefined, correlationId);
  }

  private async rejectWith(
    tenantId: string,
    id: string,
    reasonText: string,
    snappfoodNotice: Record<string, any>,
    userId?: string,
    correlationId?: string,
  ) {
    const order = await this.transitionState(tenantId, id, 'REJECT', { reasonText }, userId, correlationId);
    await this.closeArrivalAlert(tenantId, order, userId);

    const snappfoodCode = this.snappfoodOrderCode(order);
    if (snappfoodCode && this.simulationService) {
      try {
        await this.simulationService.notifyRejected(tenantId, snappfoodCode, snappfoodNotice);
      } catch (e) {
        // The rejection stands, as with accept.
      }
    }

    return order;
  }

  async getDeclineReasons(): Promise<{ id: number; title: string; level: number }[]> {
    return (await this.simulationService?.getDeclineReasons()) ?? [];
  }

  /**
   * After accepting a Snappfood order the store finds it needs more time, or cannot make it.
   * The annex has no call to change the promised time: within an hour of accepting, the store
   * rejects the order ("needs a call", 51) with a reason, 153 for a delay. The kitchen keeps
   * the order meanwhile. Snappfood support then cancels it (54) or sends it back (56), and the
   * store accepts it again with a new time.
   */
  async reportToSnappfood(
    tenantId: string,
    id: string,
    dto: OrderSnappfoodReportDto,
    userId?: string,
    correlationId?: string,
  ) {
    const order = await this.orderRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);

    const snappfoodCode = this.snappfoodOrderCode(order);
    if (!snappfoodCode) {
      throw new BadRequestException({ code: 'NOT_A_SNAPPFOOD_ORDER', message: `Order ${order.order_number} did not come from Snappfood` });
    }
    if (!order.accepted_at || !KITCHEN_HOLDS_ORDER_STATES.includes(order.state)) {
      throw new ConflictException({
        code: 'ORDER_NOT_IN_KITCHEN',
        message: `Order ${order.order_number} is ${order.state}; only an accepted order the kitchen still has can be reported`,
      });
    }
    if (order.aggregator_issue_at) {
      throw new ConflictException({
        code: 'SNAPPFOOD_REPORT_OPEN',
        message: `Order ${order.order_number} is already with Snappfood support`,
      });
    }
    if (Date.now() > reportWindowEndsAt(order)!.getTime()) {
      throw new ConflictException({
        code: 'SNAPPFOOD_REPORT_WINDOW_CLOSED',
        message: `Snappfood takes a report only within ${SNAPPFOOD_REPORT_WINDOW_MINUTES} minutes of accepting; call Snappfood support about order ${order.order_number}`,
      });
    }

    const reason = (await this.getDeclineReasons()).find((r) => r.id === dto.reasonId);
    if (!reason) {
      throw new BadRequestException({ code: 'UNKNOWN_DECLINE_REASON', message: `No decline reason ${dto.reasonId}` });
    }
    if (dto.reasonId === SNAPPFOOD_DELAY_REASON_ID && !dto.extraMinutes) {
      throw new BadRequestException({ code: 'EXTRA_MINUTES_REQUIRED', message: 'Say how many more minutes the order needs' });
    }

    const comment = [dto.extraMinutes && `Needs ${dto.extraMinutes} more minutes`, dto.comment?.trim()]
      .filter(Boolean)
      .join('. ');

    // Nothing has changed yet, so a refusal from Snappfood reaches the cashier as it is.
    await this.simulationService?.notifyRejected(tenantId, snappfoodCode, { reasonId: dto.reasonId, comment });

    order.aggregator_issue_at = new Date();
    order.aggregator_issue = [`${reason.id} ${reason.title}`, comment].filter(Boolean).join(': ').slice(0, 255);
    const saved = await this.orderRepo.save(order);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: userId,
      action: 'SNAPPFOOD_ORDER_REPORTED',
      entityType: 'ORDER',
      entityId: order.id,
      branchId: order.branch_id,
      correlationId,
      afterData: { reasonId: dto.reasonId, extraMinutes: dto.extraMinutes ?? null, comment },
    });

    return saved;
  }

  /**
   * Snappfood owns the lines and the money on one of its orders: the annex gives a store no
   * call to change, cancel or charge one, so doing it here would leave Snappfood untold.
   */
  private refuseSnappfoodChange(order: OrderHeader, change: string) {
    if (!isAggregatorOrder(order)) return;
    throw new ConflictException({
      code: 'SNAPPFOOD_ORDER_LOCKED',
      message: `Order ${order.order_number} came from Snappfood, which does not let a store ${change}. Report a problem to Snappfood instead.`,
    });
  }

  /** Snappfood's code for one of its orders: our order number without the SNP- prefix. */
  /**
   * The "waiting for acceptance" notice has done its job once the order is answered —
   * accepted, rejected, or answered by the timeout. Left open, the bell kept a manager
   * chasing orders that were long in the kitchen or long gone.
   */
  private async closeArrivalAlert(tenantId: string, order: OrderHeader, userId?: string) {
    const alerts = this.orderRepo.manager?.getRepository?.(OperationalAlert);
    if (!order?.order_number || !alerts) return;
    try {
      await alerts.update(
        { tenant_id: tenantId, type: 'INCOMING_ORDER', title: `New Snappfood order ${order.order_number}`, acknowledged: false },
        { acknowledged: true, acknowledged_at: new Date(), acknowledged_by: userId || null } as any,
      );
    } catch {
      // A notice left open is untidy, not wrong; the answer to the order stands.
    }
  }

  private snappfoodOrderCode(order: OrderHeader): string | null {
    if (order.channel !== 'AGGREGATOR' || !order.order_number?.startsWith('SNP-')) return null;
    return order.order_number.slice('SNP-'.length);
  }

  /**
   * Apply line changes to an order past DRAFT, per spec 7.9.
   *
   * Lines are never mutated or deleted: a removal flips the original to VOID
   * and leaves it queryable, an addition appends. Every requested change is put
   * to the edit policy first, and the most restrictive answer governs the whole
   * command - a single forbidden change refuses the batch rather than applying
   * a partial edit the caller did not ask for.
   */
  async editOrder(tenantId: string, id: string, dto: OrderEditDto, userId?: string, correlationId?: string) {
    const additions = dto.changes?.add || [];
    const removals = dto.changes?.void || [];
    if (additions.length === 0 && removals.length === 0) {
      throw new BadRequestException('An edit must add or void at least one line');
    }

    const result = await this.dataSource.transaction(async (em) => {
      const order = await em.findOne(OrderHeader, {
        where: { id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException(`Order ${id} not found`);
      this.refuseSnappfoodChange(order, 'change its lines');

      const items = await em.find(OrderItem, { where: { order_id: id, tenant_id: tenantId } });

      // Spec 7.9: a stale quote must not be edited against, or the cashier is
      // committing changes priced from figures they never saw.
      if (dto.quoteVersion && dto.quoteVersion !== order.quote_version) {
        throw new ConflictException({
          statusCode: 409,
          code: 'QUOTE_STALE',
          message: 'Order totals have changed since this edit was composed',
          currentQuoteVersion: order.quote_version,
        });
      }

      const netPaid = await this.calculateNetPaid(tenantId, id, em);
      const config = await this.getOrderActionConfig(tenantId, em, order.branch_id);
      const policyContext = { state: order.state, submittedAt: order.submitted_at || null, paidTotal: netPaid };
      const now = new Date();

      // Resolve every requested change before applying any of them.
      let requiresApproval = false;
      const escalations: string[] = [];
      const decide = (action: OrderEditAction, line?: { state: string }) => {
        const result = resolveOrderEditDecision(action, policyContext, config, now, line);
        if (result.decision === 'FORBID') {
          throw new BadRequestException(
            `Cannot ${action} on order ${order.order_number} in state ${order.state} (${result.reason})`,
          );
        }
        if (result.decision === 'REQUIRE_APPROVAL') {
          requiresApproval = true;
          escalations.push(`${action}:${result.reason}`);
        }
      };

      const linesToVoid: OrderItem[] = [];
      for (const removal of removals) {
        const line = items.find((i) => i.id === removal.orderItemId);
        if (!line) {
          throw new NotFoundException(`Order item ${removal.orderItemId} not found on order ${id}`);
        }
        decide('VOID_ITEM', line);
        linesToVoid.push(line);
      }
      if (additions.length > 0) decide('ADD_ITEM');

      if (requiresApproval) {
        if (!dto.approvalRequestId) {
          throw new ForbiddenException({
            statusCode: 403,
            code: 'APPROVAL_REQUIRED',
            message: `This edit is outside cashier authority and needs an approved request (${escalations.join(', ')})`,
            escalations,
          });
        }
        await this.approvalService.validateApprovedRequest(tenantId, dto.approvalRequestId, 'EDIT_ORDER');
      }

      // Spec 6.1: removals must carry a reason so void reporting can attribute
      // shrinkage. Additions raise the balance and need no justification.
      for (const removal of removals) {
        if (!removal.reasonCodeId && !dto.reasonCodeId) {
          throw new BadRequestException(`Voiding line ${removal.orderItemId} requires a reason code`);
        }
      }

      const before = this.snapshotLines(items);

      for (const line of linesToVoid) {
        line.state = 'VOID';
        await em.save(OrderItem, line);
      }

      if (additions.length > 0) {
        const nextLineNumber = items.reduce((max, i) => Math.max(max, i.line_number || 0), 0) + 1;
        await this.addItemsToDraft(tenantId, order, additions, em, nextLineNumber);
      }

      const recalculated = await this.recalculateOrderTotals(tenantId, order, em);

      // Spec 7.9: never leave the grand total below money already collected
      // without a linked refund. The refund orchestration is the caller's, so
      // the edit is refused rather than silently creating an unbacked credit.
      if (MoneyUtil.greaterThan(netPaid, recalculated.grand_total) && !dto.refundPlan) {
        throw new ConflictException({
          statusCode: 409,
          code: 'REFUND_PLAN_REQUIRED',
          message:
            `This edit lowers the order total to ${recalculated.grand_total}, below the ` +
            `${netPaid} already collected. Attach a refund plan for the difference.`,
          netPaid,
          newGrandTotal: recalculated.grand_total,
          refundDue: MoneyUtil.subtract(netPaid, recalculated.grand_total),
        });
      }

      recalculated.version += 1;
      await em.save(OrderHeader, recalculated);

      const after = this.snapshotLines(
        await em.find(OrderItem, { where: { order_id: id, tenant_id: tenantId } }),
      );

      await em.save(
        OrderStateEvent,
        em.create(OrderStateEvent, {
          tenant_id: tenantId,
          order_id: order.id,
          from_state: order.state,
          to_state: order.state,
          action: 'EDIT_ORDER',
          reason_code_id: dto.reasonCodeId || removals[0]?.reasonCodeId || null,
          reason_text: dto.reason || removals[0]?.reason || null,
          approval_request_id: dto.approvalRequestId || null,
          occurred_by: userId || null,
          snapshot: { before, after, escalations },
        }),
      );

      await this.outboxWriter.enqueueInTransaction(em, {
        tenantId,
        eventType: 'ORDER_UPDATED',
        aggregateType: 'Order',
        aggregateId: order.id,
        payload: {
          orderId: order.id,
          orderNumber: order.order_number,
          action: 'EDIT_ORDER',
          voidedItemIds: linesToVoid.map((l) => l.id),
          addedLineCount: additions.length,
          grandTotal: recalculated.grand_total,
        },
      });

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'ORDER_EDITED',
        entityType: 'Order',
        entityId: id,
        correlationId,
        beforeData: before,
        afterData: after,
      });

      return {
        order: await em.findOne(OrderHeader, {
          where: { id },
          relations: ['items', 'items.options', 'adjustments', 'stateEvents'],
        }),
        voidedItemIds: linesToVoid.map((l) => l.id),
        addedItemIds: after.filter((l) => !before.some((b) => b.id === l.id)).map((l) => l.id),
      };
    });

    // The kitchen has to learn about both halves of the edit: struck lines stop
    // being cooked, appended lines get fired. Deliberately outside the
    // transaction - see syncKitchenAfterEdit.
    await this.syncKitchenAfterEdit(
      tenantId,
      id,
      result.voidedItemIds,
      result.addedItemIds,
      await this.reasonText(tenantId, dto.reason || removals[0]?.reason, dto.reasonCodeId || removals[0]?.reasonCodeId),
      userId,
    );

    return result.order;
  }

  /**
   * The order was rung up as the wrong kind — a walk-in that turns out to be a delivery, a
   * delivery the customer decides to collect on the way home.
   *
   * This is not a field edit, because the type is what the money hangs off: the delivery fee
   * comes off or goes on, which moves the grand total and can take it below what has already
   * been collected. So it runs through the same machinery as a line edit — the edit policy,
   * the cashier window, the approval escalation, the quote version and the refund check —
   * rather than quietly assigning a column.
   *
   * What it will not do:
   *   - convert an aggregator order, because that order is Snappfood's, not ours
   *   - take a delivery away from a courier who is already carrying it
   *   - make an order a delivery without a customer, an address and a live zone
   *
   * The kitchen is deliberately not re-fired. The lines have not changed, and a station that
   * has already cooked them does not need to see them again; what the pass needs to know is
   * whether the food is being packed, and that is on the chit the operator reprints. Doing it
   * automatically would put a duplicate chit on every conversion.
   */
  async changeOrderType(
    tenantId: string,
    id: string,
    dto: OrderTypeChangeDto,
    userId?: string,
    correlationId?: string,
  ) {
    return await this.dataSource.transaction(async (em) => {
      const order = await em.findOne(OrderHeader, {
        where: { id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException(`Order ${id} not found`);

      const from = order.order_type;
      const to = dto.orderType;

      this.refuseSnappfoodChange(order, 'change what kind of order it is');
      if (from === to) {
        throw new BadRequestException(`Order ${order.order_number} is already a ${to} order`);
      }

      // Same staleness rule as a line edit: the cashier must be acting on the totals they
      // were shown, since this change moves them.
      if (dto.quoteVersion && dto.quoteVersion !== order.quote_version) {
        throw new ConflictException({
          statusCode: 409,
          code: 'QUOTE_STALE',
          message: 'Order totals have changed since this conversion was composed',
          currentQuoteVersion: order.quote_version,
        });
      }

      const netPaid = await this.calculateNetPaid(tenantId, id, em);
      const config = await this.getOrderActionConfig(tenantId, em, order.branch_id);
      const decision = resolveOrderEditDecision(
        'CHANGE_ORDER_TYPE',
        { state: order.state, submittedAt: order.submitted_at || null, paidTotal: netPaid },
        config,
        new Date(),
      );

      if (decision.decision === 'FORBID') {
        throw new BadRequestException(
          `Cannot change the type of order ${order.order_number} in state ${order.state} (${decision.reason})`,
        );
      }
      if (decision.decision === 'REQUIRE_APPROVAL') {
        if (!dto.approvalRequestId) {
          throw new ForbiddenException({
            statusCode: 403,
            code: 'APPROVAL_REQUIRED',
            message: `Changing this order from ${from} to ${to} is outside cashier authority and needs an approved request (${decision.reason})`,
            escalations: [`CHANGE_ORDER_TYPE:${decision.reason}`],
          });
        }
        await this.approvalService.validateApprovedRequest(tenantId, dto.approvalRequestId, 'EDIT_ORDER');
      }

      // A courier holding the food outranks everything above: there is no honest way to
      // call it a takeaway while it is on a motorbike.
      if (from === 'DELIVERY') {
        const delivery = await em.findOne(Delivery, { where: { tenant_id: tenantId, order_id: id } });
        if (delivery && !['UNASSIGNED', 'CANCELLED', 'FAILED'].includes(delivery.state)) {
          throw new ConflictException({
            code: 'DELIVERY_IN_PROGRESS',
            message: `Order ${order.order_number} is already with a courier (${delivery.state}) and cannot stop being a delivery`,
          });
        }
        if (delivery) {
          delivery.state = 'CANCELLED';
          await em.save(Delivery, delivery);
        }
      }

      const before = {
        order_type: from,
        delivery_fee: order.delivery_fee,
        grand_total: order.grand_total,
        table_id: order.table_id,
        delivery_zone_id: order.delivery_zone_id,
      };

      order.order_type = to;

      if (to === 'DELIVERY') {
        if (dto.deliveryAddressId) order.customer_address_id = dto.deliveryAddressId;
        if (dto.deliveryZoneId) order.delivery_zone_id = dto.deliveryZoneId;
        // Fails with the specific missing piece, so the cashier is told what to collect.
        await this.validateDeliveryContext(tenantId, order, em, true);
        // A check cannot be at a table and out for delivery at once.
        await this.releaseTableForOrder(tenantId, order, em);
      } else {
        // Leaving delivery: the fee and the zone go with it, or the next recalculation
        // would keep charging for a journey nobody is making.
        order.delivery_zone_id = null as any;
        order.delivery_fee = '0.0000';

        if (to === 'DINE_IN') {
          if (dto.tableId) {
            const table = await em.findOne(DiningTable, { where: { id: dto.tableId, tenant_id: tenantId } });
            if (!table) throw new BadRequestException(`Table ${dto.tableId} not found`);
            order.table_id = table.id;
            order.table_number = table.table_number;
          }
        } else {
          // TAKEAWAY: no table, no zone, collected at the counter.
          await this.releaseTableForOrder(tenantId, order, em);
        }
      }

      const recalculated = await this.recalculateOrderTotals(tenantId, order, em);

      // Dropping the delivery fee can take the total below what the guest already handed
      // over. Same rule as a line edit: the money owed back is settled deliberately, not
      // left as a negative balance nobody reconciles.
      if (MoneyUtil.greaterThan(netPaid, recalculated.grand_total)) {
        throw new ConflictException({
          statusCode: 409,
          code: 'REFUND_REQUIRED',
          message:
            `Changing this order to ${to} lowers its total to ${recalculated.grand_total}, ` +
            `below the ${netPaid} already collected. Refund the difference first.`,
          newGrandTotal: recalculated.grand_total,
          refundDue: MoneyUtil.subtract(netPaid, recalculated.grand_total),
        });
      }

      recalculated.version += 1;
      await em.save(OrderHeader, recalculated);

      // Same shape as a line edit: the order has not moved state, but the history needs a
      // row saying what happened and who approved it. Written directly rather than through
      // the transition recorder, which is for real state moves and would also try to settle
      // loyalty on a completed order.
      await em.save(
        OrderStateEvent,
        em.create(OrderStateEvent, {
          tenant_id: tenantId,
          order_id: recalculated.id,
          from_state: recalculated.state,
          to_state: recalculated.state,
          action: 'CHANGE_ORDER_TYPE',
          reason_text: dto.reason || `Converted from ${from} to ${to}`,
          approval_request_id: dto.approvalRequestId || null,
          occurred_by: userId || null,
          snapshot: { from, to, before, after: { grand_total: recalculated.grand_total } },
        }),
      );

      // The branch agent holds its own copy: a till that still thinks this is a delivery
      // would price the next quote with a fee that is no longer there.
      await this.outboxWriter.enqueueInTransaction(em, {
        tenantId,
        eventType: 'ORDER_UPDATED',
        aggregateType: 'Order',
        aggregateId: recalculated.id,
        payload: {
          orderId: recalculated.id,
          orderNumber: recalculated.order_number,
          action: 'CHANGE_ORDER_TYPE',
          fromType: from,
          toType: to,
          grandTotal: recalculated.grand_total,
        },
      });

      await this.auditWriter.writeInTransaction(em, {
        tenantId,
        actorType: 'ADMIN',
        actorId: userId,
        action: 'ORDER_TYPE_CHANGED',
        entityType: 'Order',
        entityId: id,
        correlationId,
        beforeData: before,
        afterData: {
          order_type: recalculated.order_type,
          delivery_fee: recalculated.delivery_fee,
          grand_total: recalculated.grand_total,
          table_id: recalculated.table_id,
          delivery_zone_id: recalculated.delivery_zone_id,
        },
        details: { from, to, reason: dto.reason || null, approvalRequestId: dto.approvalRequestId || null },
      });

      return await em.findOne(OrderHeader, {
        where: { id },
        relations: ['items', 'items.options', 'adjustments', 'stateEvents'],
      });
    });
  }

  /**
   * Let go of the table an order is sitting at, if it is sitting at one.
   *
   * The floor map treats a table as occupied whenever a live order names it, so clearing
   * the order's own columns is what actually frees it; the session row is closed too, so
   * the seating history is not left open forever.
   */
  private async releaseTableForOrder(tenantId: string, order: OrderHeader, em: EntityManager) {
    if (!order.table_id) return;

    const session = await em.findOne(TableSession, {
      where: { tenant_id: tenantId, table_id: order.table_id, closed_at: IsNull() },
    });
    if (session) {
      session.closed_at = new Date();
      session.status = 'AVAILABLE';
      await em.save(TableSession, session);
    }

    order.table_id = null as any;
    order.table_number = null as any;
  }

  /** Money actually collected: succeeded payments less succeeded refunds. */
  private async calculateNetPaid(tenantId: string, orderId: string, em: EntityManager): Promise<string> {
    const payments = await em.find(Payment, { where: { tenant_id: tenantId, order_id: orderId } });
    let collected = '0.0000';
    for (const p of payments) {
      if (p.status === 'SUCCEEDED' || (p.status as any) === 'COMPLETED') {
        collected = MoneyUtil.add(collected, p.amount);
      }
    }

    const refunds = await em.find(Refund, {
      where: { tenant_id: tenantId, order_id: orderId, status: 'SUCCEEDED' as any },
    });
    for (const r of refunds) {
      collected = MoneyUtil.subtract(collected, r.amount);
    }

    return MoneyUtil.greaterThan(collected, '0.0000') ? collected : '0.0000';
  }

  /**
   * Read the cashier authority windows in force at `branchId`, falling back to the
   * organization's own value and then to the spec defaults. A branch that has been given
   * a longer edit window must get it here, or the override would be visible in settings
   * and have no effect on the till.
   */
  private async getOrderActionConfig(
    tenantId: string,
    em: EntityManager,
    branchId?: string,
  ): Promise<OrderActionConfig> {
    const rows = await em.find(TenantSetting, {
      where: { tenant_id: tenantId, key: 'ORDER_ACTIONS' },
    });
    return resolveOrderActionConfig(pickSettingValue(rows, branchId));
  }

  /** Compact line snapshot for the edit history diff required by spec 7.9. */
  private snapshotLines(items: OrderItem[]) {
    return items
      .slice()
      .sort((a, b) => (a.line_number || 0) - (b.line_number || 0))
      .map((i) => ({
        id: i.id,
        lineNumber: i.line_number,
        productName: i.product_name,
        quantity: i.quantity,
        unitPrice: i.unit_price,
        lineTotal: i.line_total,
        state: i.state,
        replacesItemId: i.replaces_item_id || null,
      }));
  }

  /**
   * Retract voided lines from the kitchen and fire any newly appended ones, on both
   * the station screens and the kitchen printer.
   *
   * MUST be called after the edit transaction commits, never inside it. KdsService
   * works through its own repositories on a separate connection, so a line added
   * in an open transaction is invisible to it and would never reach a station.
   *
   * A kitchen that works from paper never sees the screens, so the change chit is
   * printed regardless of whether the KDS call succeeded.
   *
   * Best effort: a KDS hiccup must not fail an otherwise valid edit, since the
   * order and its money are already consistent by this point.
   */
  /**
   * The reason a cook reads on a change chit. The till sends a reason code more often than a
   * typed note, and a chit saying only "order cancelled" leaves the kitchen guessing.
   */
  private async reasonText(tenantId: string, text?: string, reasonCodeId?: string): Promise<string | undefined> {
    if (text?.trim()) return text.trim();
    if (!reasonCodeId) return undefined;
    try {
      const code = await this.dataSource.getRepository(ReasonCode).findOne({ where: { id: reasonCodeId, tenant_id: tenantId } });
      return code?.name || undefined;
    } catch {
      return undefined;
    }
  }

  private async syncKitchenAfterEdit(
    tenantId: string,
    orderId: string,
    voidedItemIds: string[],
    addedItemIds: string[],
    reason?: string,
    userId?: string,
  ) {
    if (this.kdsService) {
      try {
        for (const itemId of voidedItemIds) {
          await this.kdsService.cancelTicketItemsForOrderItem(tenantId, itemId, userId);
        }
        if (addedItemIds.length > 0) {
          await this.kdsService.generateTicketsForOrder(tenantId, orderId);
        }
      } catch (err) {
        console.error(`KDS sync after edit of order ${orderId} failed`, err);
      }
    }

    if (this.printQueueService && (voidedItemIds.length > 0 || addedItemIds.length > 0)) {
      await this.printQueueService.enqueueKitchenChangeTicket(
        tenantId,
        orderId,
        { kind: 'AMENDED', voidedItemIds, addedItemIds, reason },
        userId,
      );
    }
  }

  /**
   * Stop the kitchen on an order that was cancelled after it was sent there: every
   * line still on it comes off the station screens, and the printer gets a STOP chit.
   * A draft never reached the kitchen, and an order out for delivery has already left
   * it, so neither gets one.
   */
  private async stopKitchenAfterCancel(
    tenantId: string,
    orderId: string,
    stateBeforeCancel: OrderState,
    activeItemIds: string[],
    reason?: string,
    userId?: string,
  ) {
    if (!KITCHEN_HOLDS_ORDER_STATES.includes(stateBeforeCancel) || activeItemIds.length === 0) return;

    if (this.kdsService) {
      try {
        for (const itemId of activeItemIds) {
          await this.kdsService.cancelTicketItemsForOrderItem(tenantId, itemId, userId);
        }
      } catch (err) {
        console.error(`KDS stop after cancel of order ${orderId} failed`, err);
      }
    }

    if (this.printQueueService) {
      await this.printQueueService.enqueueKitchenChangeTicket(tenantId, orderId, { kind: 'CANCELLED', reason }, userId);
    }
  }

  /**
   * Supersede a line with a different product, variant or quantity, per spec 7.9.
   *
   * The original is marked REPLACED and the replacement links back to it, so the
   * supersession chain stays queryable. Price comes from the catalog at current
   * effective price, never from the request body: letting a caller name its own
   * unit price turns a correction into an unaudited discount.
   */
  async replaceItem(tenantId: string, id: string, dto: OrderItemReplaceDto, userId?: string, correlationId?: string) {
    if (!dto.replacement) {
      throw new BadRequestException('A replacement line is required; use the edit command to void without replacing');
    }

    const replaced = await this.dataSource.transaction(async (em) => {
      const order = await em.findOne(OrderHeader, {
        where: { id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException(`Order ${id} not found`);
      this.refuseSnappfoodChange(order, 'change its lines');

      const item = await em.findOne(OrderItem, {
        where: { id: dto.orderItemId, tenant_id: tenantId, order_id: id },
      });
      if (!item) throw new NotFoundException(`Order item ${dto.orderItemId} not found on order ${id}`);

      if (dto.quoteVersion && dto.quoteVersion !== order.quote_version) {
        throw new ConflictException({
          statusCode: 409,
          code: 'QUOTE_STALE',
          message: 'Order totals have changed since this replacement was composed',
          currentQuoteVersion: order.quote_version,
        });
      }

      const netPaid = await this.calculateNetPaid(tenantId, id, em);
      const config = await this.getOrderActionConfig(tenantId, em, order.branch_id);
      const decision = resolveOrderEditDecision(
        'REPLACE_ITEM',
        { state: order.state, submittedAt: order.submitted_at || null, paidTotal: netPaid },
        config,
        new Date(),
        item,
      );

      if (decision.decision === 'FORBID') {
        throw new BadRequestException(
          `Cannot replace a line on order ${order.order_number} in state ${order.state} (${decision.reason})`,
        );
      }
      if (decision.decision === 'REQUIRE_APPROVAL') {
        if (!dto.approvalRequestId) {
          throw new ForbiddenException({
            statusCode: 403,
            code: 'APPROVAL_REQUIRED',
            message: `Replacing this line is outside cashier authority (${decision.reason})`,
            escalations: [`REPLACE_ITEM:${decision.reason}`],
          });
        }
        await this.approvalService.validateApprovedRequest(tenantId, dto.approvalRequestId, 'REPLACE_ITEM');
      }

      if (!dto.reasonCodeId) {
        throw new BadRequestException('Replacing a line requires a reason code');
      }

      const before = this.snapshotLines(
        await em.find(OrderItem, { where: { order_id: id, tenant_id: tenantId } }),
      );

      item.state = 'REPLACED';
      await em.save(OrderItem, item);

      // Reuse the draft line builder so the replacement is priced, costed and
      // has its modifiers resolved exactly like any other line on the order.
      const nextLineNumber = before.reduce((max, l) => Math.max(max, l.lineNumber || 0), 0) + 1;
      await this.addItemsToDraft(
        tenantId,
        order,
        [
          {
            product_id: dto.replacement.productId || item.product_id,
            variant_id: dto.replacement.variantId || null,
            quantity: dto.replacement.quantity || item.quantity,
            options: dto.replacement.options || [],
            notes: dto.replacement.notes || item.notes || null,
          },
        ],
        em,
        nextLineNumber,
      );

      const replacement = await em.findOne(OrderItem, {
        where: { order_id: id, tenant_id: tenantId, line_number: nextLineNumber },
      });
      if (replacement) {
        replacement.replaces_item_id = item.id;
        await em.save(OrderItem, replacement);
      }

      const recalculated = await this.recalculateOrderTotals(tenantId, order, em);

      if (MoneyUtil.greaterThan(netPaid, recalculated.grand_total) && !dto.refundPlan) {
        throw new ConflictException({
          statusCode: 409,
          code: 'REFUND_PLAN_REQUIRED',
          message:
            `This replacement lowers the order total to ${recalculated.grand_total}, below the ` +
            `${netPaid} already collected. Attach a refund plan for the difference.`,
          netPaid,
          newGrandTotal: recalculated.grand_total,
          refundDue: MoneyUtil.subtract(netPaid, recalculated.grand_total),
        });
      }

      recalculated.version += 1;
      await em.save(OrderHeader, recalculated);

      const after = this.snapshotLines(
        await em.find(OrderItem, { where: { order_id: id, tenant_id: tenantId } }),
      );

      await em.save(
        OrderStateEvent,
        em.create(OrderStateEvent, {
          tenant_id: tenantId,
          order_id: order.id,
          from_state: order.state,
          to_state: order.state,
          action: 'REPLACE_ITEM',
          reason_code_id: dto.reasonCodeId,
          reason_text: dto.reason || null,
          approval_request_id: dto.approvalRequestId || null,
          occurred_by: userId || null,
          snapshot: { before, after, replacedItemId: item.id },
        }),
      );

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'ORDER_ITEM_REPLACED',
        entityType: 'OrderItem',
        entityId: dto.orderItemId,
        correlationId,
        beforeData: before,
        afterData: after,
      });

      return { replacedItemId: item.id, replacementItemId: replacement?.id };
    });

    // Outside the transaction so the replacement line is visible to KDS.
    await this.syncKitchenAfterEdit(
      tenantId,
      id,
      [replaced.replacedItemId],
      replaced.replacementItemId ? [replaced.replacementItemId] : [],
      await this.reasonText(tenantId, dto.reason, dto.reasonCodeId),
      userId,
    );

    return await this.getOrderById(tenantId, id);
  }

  async cancelOrder(tenantId: string, id: string, dto: OrderCancelDto, userId?: string, correlationId?: string) {
    const order = await this.orderRepo.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['items'],
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);

    // A waiting incoming order is turned down through reject, which tells Snappfood.
    if (order.state === 'PENDING_ACCEPTANCE') {
      throw new ConflictException({
        code: 'ORDER_AWAITING_ACCEPTANCE',
        message: `Order ${order.order_number} is awaiting acceptance; reject it instead of cancelling`,
      });
    }
    this.refuseSnappfoodChange(order, 'cancel it');

    const netPaid = await this.calculateNetPaid(tenantId, id, this.dataSource.manager);
    const config = await this.getOrderActionConfig(tenantId, this.dataSource.manager, order.branch_id);
    const decision = resolveOrderEditDecision(
      'CANCEL_ORDER',
      { state: order.state, submittedAt: order.submitted_at || null, paidTotal: netPaid },
      config,
      new Date(),
    );

    if (decision.decision === 'REQUIRE_APPROVAL') {
      if (!dto.approvalRequestId) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'APPROVAL_REQUIRED',
          message: `Cancelling this order is outside cashier authority (${decision.reason})`,
          escalations: [`CANCEL_ORDER:${decision.reason}`],
        });
      }
      await this.approvalService.validateApprovedRequest(tenantId, dto.approvalRequestId, 'CANCEL_ORDER');
    }
    // A FORBID here is left to transitionState, whose message names the states.

    // Spec 6.1: a DRAFT cancel needs a reason only once it has items on it, so
    // discarding an empty held draft stays a one-click action.
    // Captured before the cancel runs: after it, the order reads CANCELLED and no
    // longer says whether the kitchen ever had it.
    const stateBeforeCancel = order.state;
    const activeItemIds = (order.items || []).filter(isActiveLine).map((i) => i.id);
    if (activeItemIds.length > 0 && !dto.reasonCodeId) {
      throw new BadRequestException('Cancelling an order with items requires a reason code');
    }

    // Cancelling an order the customer has already paid for is not a state flip:
    // the tender has to go back the way it came, or the drawer keeps money
    // against a cancelled sale. That reversal is the refund module's
    // orchestration, which refunds same-tender and then cancels in one
    // transaction. The approval above is the gate for it.
    const cancelled = MoneyUtil.greaterThan(netPaid, '0.0000')
      ? await this.refundService.cancelPaidOrder(
          tenantId,
          id,
          {
            reason: dto.reason || 'Paid order cancellation',
            reasonCodeId: dto.reasonCodeId,
            approvalRequestId: dto.approvalRequestId,
          },
          userId,
          correlationId,
        )
      : await this.transitionState(
          tenantId,
          id,
          'CANCEL',
          { reasonCodeId: dto.reasonCodeId, reasonText: dto.reason, approvalRequestId: dto.approvalRequestId },
          userId,
          correlationId,
        );

    await this.stopKitchenAfterCancel(
      tenantId,
      id,
      stateBeforeCancel,
      activeItemIds,
      await this.reasonText(tenantId, dto.reason, dto.reasonCodeId),
      userId,
    );

    return cancelled;
  }

  /**
   * Reopen a cancelled order back to SUBMITTED, per spec 6.1.
   *
   * Always an approved action, never available once money moved, and confined
   * to the business day it was cancelled on so a reopen cannot reach back into
   * a closed and reconciled day.
   */
  async reopenOrder(tenantId: string, id: string, dto: OrderReopenDto, userId?: string, correlationId?: string) {
    const order = await this.orderRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    this.refuseSnappfoodChange(order, 'reopen it');

    if (!dto.approvalRequestId) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'APPROVAL_REQUIRED',
        message: 'Reopening a cancelled order requires an approved request',
      });
    }
    await this.approvalService.validateApprovedRequest(tenantId, dto.approvalRequestId, 'REOPEN_ORDER');

    const everPaid = await this.dataSource.manager.count(Payment, {
      where: [
        { tenant_id: tenantId, order_id: id, status: 'SUCCEEDED' as any },
        { tenant_id: tenantId, order_id: id, status: 'COMPLETED' as any },
      ],
    });
    if (everPaid > 0) {
      throw new BadRequestException(
        `Order ${order.order_number} took payment before it was cancelled and cannot be reopened. Raise a new order instead.`,
      );
    }

    const today = BusinessDateUtil.today();
    if (order.business_date && String(order.business_date) !== String(today)) {
      throw new BadRequestException(
        `Order ${order.order_number} belongs to business day ${order.business_date} and cannot be reopened on ${today}.`,
      );
    }

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
    startLineNumber = 1,
  ) {
    // Appending to an existing order must continue the numbering rather than
    // restart it. Line numbers are never reused, including by voided lines, so
    // a reprint of an old ticket still refers to the same line.
    let lineNo = startLineNumber;
    // Every item's stock count is locked up front, in one ordered statement, so two registers
    // adding the same items in a different order cannot deadlock on them line by line.
    if (order.branch_id) {
      const productIds = itemsDto.map((i) => i.product_id).filter(Boolean);
      await this.catalogService.lockStockCounts(em, tenantId, order.branch_id, BusinessDateUtil.today(), productIds);
    }
    for (const itemDto of itemsDto) {
      try {
        const product = await this.productRepo.findOne({ where: { id: itemDto.product_id, tenant_id: tenantId } });
        if (!product) throw new NotFoundException(`Product ${itemDto.product_id} not found`);
        if (product.is_active === false) {
          throw new BadRequestException({ statusCode: 400, code: 'PRODUCT_INACTIVE', message: `${product.name} is not on the menu` });
        }

        // Spec 4.7: an 86'd item is off sale everywhere it can be ordered. Register
        // orders land here, so the stop is enforced on the line rather than trusted to
        // the caller's catalog view; the kiosk runs the same rules through
        // CatalogService.assertBasketSellable.
        const suspension = await this.catalogService.getSuspension(tenantId, product.id, order.branch_id, new Date(), itemDto.variant_id || null);
        if (suspension.outOfSchedule) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'PRODUCT_OUT_OF_SCHEDULE',
            message: `${product.name} is not on sale now. ${suspension.reason}`,
          });
        }
        if (suspension.isSuspended) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'PRODUCT_SUSPENDED',
            message: `${product.name} is suspended from sale${suspension.reason ? ` (${suspension.reason})` : ''}`,
          });
        }

        const qty = itemDto.quantity || '1.0000';
        let variant: ProductVariant | null = null;
        if (itemDto.variant_id) {
          variant = await this.variantRepo.findOne({
            where: {
              id: itemDto.variant_id,
              tenant_id: tenantId,
              product_id: product.id,
              is_active: true,
            },
          });
          if (!variant) {
            throw new BadRequestException(`Variant ${itemDto.variant_id} is not available for product ${product.id}`);
          }
        } else if ((await this.variantRepo.count({ where: { tenant_id: tenantId, product_id: product.id, is_active: true } })) > 0) {
          // A product sold in sizes is sold as one of them. Without this, a line with no size
          // went out at the product's own price, and stopping every size did not stop the product.
          throw new BadRequestException({ statusCode: 400, code: 'VARIANT_REQUIRED', message: `Pick a size or type of ${product.name}` });
        }

        // The price is the branch's in-store price (its price list's, else base), never one the
        // caller sent: any register token could otherwise set its own price. Orders that keep
        // the price a channel charged (Snappfood) are written by the simulator, not here.
        const uPrice = await this.priceLists.resolveInStorePrice(tenantId, order.branch_id, product, variant);
        const sub = MoneyUtil.multiply(uPrice, qty);

        let modifierUnitDelta = '0.0000';
        const optionsToSave: { itemOpt: OrderItemOption }[] = [];

        const chosen: Array<{ optItem: OptionItem; optDto: any }> = [];
        for (const optDto of itemDto.options || []) {
          const optItem = await this.optionItemRepo.findOne({ where: { id: optDto.option_item_id, tenant_id: tenantId } });
          if (optItem) chosen.push({ optItem, optDto });
        }
        const groupNames = await this.checkChoices(tenantId, product, chosen.map((c) => c.optItem), em);
        await this.catalogService.assertLineSellable(em, tenantId, order, product, variant?.id || null, qty, chosen.map((c) => c.optItem));

        for (const { optItem, optDto } of chosen) {
          // A choice that is a dish of its own (a combo's drink) is off sale when that dish is.
          if (optItem.product_id) {
            const component = await this.productRepo.findOne({ where: { id: optItem.product_id, tenant_id: tenantId } });
            const componentStop = component ? await this.catalogService.getSuspension(tenantId, component.id, order.branch_id) : null;
            if (componentStop?.isSuspended) {
              throw new BadRequestException({
                statusCode: 400,
                // outOfSchedule arrives with selling windows (feat/scheduled-availability).
                code: (componentStop as { outOfSchedule?: boolean }).outOfSchedule ? 'PRODUCT_OUT_OF_SCHEDULE' : 'PRODUCT_SUSPENDED',
                message: `${component!.name} in ${product.name} is not on sale now${componentStop.reason ? ` (${componentStop.reason})` : ''}`,
              });
            }
          }
          const delta = optItem.price_delta ? MoneyUtil.format(optItem.price_delta) : '0.0000';
          modifierUnitDelta = MoneyUtil.add(modifierUnitDelta, delta);
          const itemOpt = em.create(OrderItemOption, {
            tenant_id: tenantId,
            order_item_id: '',
            option_item_id: optItem.id,
            option_group_name: groupNames.get(optItem.option_group_id) || optDto.option_group_name || '',
            option_item_name: optItem.name,
            price_delta: delta,
          });
          optionsToSave.push({ itemOpt });
        }

        const modifierTotal = MoneyUtil.multiply(modifierUnitDelta, qty);
        const totalLine = MoneyUtil.add(sub, modifierTotal);

        const orderItem = em.create(OrderItem, {
          tenant_id: tenantId,
          order_id: order.id,
          line_number: lineNo++,
          product_id: product.id,
          product_code: product.code,
          product_name: product.name,
          variant_id: variant?.id || null,
          variant_name: variant?.name || null,
          quantity: qty,
          unit_price: uPrice,
          base_total: sub,
          modifier_total: modifierTotal,
          subtotal: totalLine,
          line_total: totalLine,
          total_amount: totalLine,
          notes: itemDto.notes || null,
          state: 'ACTIVE',
        });
        const savedItem = await em.save(OrderItem, orderItem);

        for (const { itemOpt } of optionsToSave) {
          itemOpt.order_item_id = savedItem.id;
          await em.save(OrderItemOption, itemOpt);
        }
      } catch (err) {
        // A line refused because the item was off (86'd, outside its hours or sold out) is a
        // lost sale; the stop report counts them.
        const code = (err as { response?: { code?: string } })?.response?.code;
        if (code && REFUSED_SALE_CODES.includes(code) && itemDto?.product_id) {
          await this.catalogService.recordRefusedSale(tenantId, {
            branchId: order.branch_id,
            productId: itemDto.product_id,
            variantId: itemDto.variant_id || null,
            quantity: Number(itemDto.quantity || 1),
            code,
            channel: order.channel,
          });
        }
        throw err;
      }
    }
  }

  /**
   * A line's add-on choices against the groups on its product (a combo's slots are groups
   * too): each choice from one of them, each group filled within its limits. Answers the
   * group names, which the order line keeps with each choice.
   */
  private async checkChoices(tenantId: string, product: Product, choices: OptionItem[], em: EntityManager) {
    const links = (await em.find(ProductOptionGroup, { where: { tenant_id: tenantId, product_id: product.id } })) || [];
    const groups = links.length
      ? (await em.find(OptionGroup, { where: { tenant_id: tenantId, id: In(links.map((l) => l.option_group_id)) } })) || []
      : [];
    return checkOptionChoices(product, links, groups, choices);
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
      case 'ACCEPT':
        return 'CONFIRMED';
      case 'REJECT':
        return 'REJECTED';
      case 'REOPEN':
        return 'SUBMITTED';
      default:
        throw new BadRequestException(`Unknown order state action: ${action}`);
    }
  }

  public async recalculateOrderTotals(tenantId: string, order: OrderHeader, em: EntityManager): Promise<OrderHeader> {
    // Voided and superseded lines stay on the order for audit and reprints, but
    // they must never reach the money. Summing every row would bill the guest
    // for food that was struck off and for lines a replacement already covers.
    const items = await em.find(OrderItem, {
      where: { order_id: order.id, tenant_id: tenantId, state: ACTIVE_LINE_STATE },
    });
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

    // Tax has to move with the lines. Carrying order.tax_total forward would bill
    // the guest VAT on food that was voided off the order, which is the kind of
    // figure that stops a day reconciling. Per-product rate on the line total,
    // matching DiscountEvaluationService; order-level discounts are not
    // re-allocated per line here, so a discounted order's tax stays approximate
    // until the next full quote.
    const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))];
    const taxRateById = new Map<string, string>();
    if (productIds.length > 0) {
      const products = await em.find(Product, { where: { id: In(productIds) } });
      products.forEach((p) => taxRateById.set(p.id, p.tax_rate || '0.0000'));
    }

    let taxTotal = '0.0000';
    for (const item of items) {
      const rate = taxRateById.get(item.product_id) || '0.0000';
      taxTotal = MoneyUtil.add(taxTotal, MoneyUtil.multiply(item.line_total, rate));
    }
    order.tax_total = taxTotal;
    order.tax_amount = taxTotal;

    const netBeforeTax = MoneyUtil.subtract(
      MoneyUtil.add(MoneyUtil.add(order.subtotal, order.packaging_total || '0.0000'), order.delivery_fee || '0.0000'),
      order.discount_total || '0.0000',
    );
    const grandTotal = MoneyUtil.add(netBeforeTax, taxTotal);
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
      this.refuseSnappfoodChange(sourceOrder, 'split it');

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
        // The same table's food: the kitchen and the guests already know it by this number.
        call_number: sourceOrder.call_number ?? null,
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
          const origModifierTotal = sourceItem.modifier_total || '0.0000';
          const splitRatio = MoneyUtil.divide(MoneyUtil.format(splitQty, 4), MoneyUtil.format(currentQty, 4), 6);
          const newModifierTotal = MoneyUtil.multiply(origModifierTotal, splitRatio);
          const remainingModifierTotal = MoneyUtil.subtract(origModifierTotal, newModifierTotal);

          sourceItem.quantity = MoneyUtil.format(remainingQty, 4);
          sourceItem.base_total = MoneyUtil.multiply(sourceItem.unit_price, sourceItem.quantity);
          sourceItem.modifier_total = remainingModifierTotal;
          sourceItem.line_total = MoneyUtil.add(sourceItem.base_total, remainingModifierTotal);
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
            modifier_total: newModifierTotal,
            discount_total: '0.0000',
            tax_total: '0.0000',
            packaging_total: '0.0000',
            line_total: MoneyUtil.add(MoneyUtil.multiply(sourceItem.unit_price, MoneyUtil.format(splitQty, 4)), newModifierTotal),
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
      this.refuseSnappfoodChange(sourceOrder, 'move its lines');
      this.refuseSnappfoodChange(targetOrder, 'add lines to it');

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
          const origModifierTotal = sourceItem.modifier_total || '0.0000';
          const transferRatio = MoneyUtil.divide(MoneyUtil.format(qtyToTransfer, 4), MoneyUtil.format(currentQty, 4), 6);
          const transferModifierTotal = MoneyUtil.multiply(origModifierTotal, transferRatio);
          const remainingModifierTotal = MoneyUtil.subtract(origModifierTotal, transferModifierTotal);

          sourceItem.quantity = MoneyUtil.format(remainingQty, 4);
          sourceItem.base_total = MoneyUtil.multiply(sourceItem.unit_price, sourceItem.quantity);
          sourceItem.modifier_total = remainingModifierTotal;
          sourceItem.line_total = MoneyUtil.add(sourceItem.base_total, remainingModifierTotal);
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
            modifier_total: transferModifierTotal,
            discount_total: '0.0000',
            tax_total: '0.0000',
            packaging_total: '0.0000',
            line_total: MoneyUtil.add(MoneyUtil.multiply(sourceItem.unit_price, MoneyUtil.format(qtyToTransfer, 4)), transferModifierTotal),
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
    // The bill is dated in the chain's calendar (head office's CALENDAR setting), Jalali unless changed.
    let calendarSetting: Record<string, any> | undefined;
    try {
      const row = await this.dataSource
        .getRepository(TenantSetting)
        .findOne({ where: { tenant_id: tenantId, key: CALENDAR_SETTING_KEY, branch_id: IsNull() } });
      calendarSetting = row?.value;
    } catch {
      calendarSetting = undefined;
    }

    const formattedItems = (order.items || []).filter(isActiveLine)
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
            <p>${isFa ? 'تاریخ' : 'Date'}: ${formatBusinessDateTime(new Date(), readCalendar(calendarSetting), isFa)}</p>
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

    // A receipt is the artifact the customer walks away with. Inventing a business name,
    // address or phone when the lookup misses prints a plausible but false identity, so
    // these stay empty rather than falling back to a hardcoded Tehran branch.
    const tenant = await this.dataSource.manager.findOne(Tenant, { where: { id: tenantId } });
    const branch = order.branch_id
      ? await this.dataSource.manager.findOne(Branch, {
          where: { id: order.branch_id, tenant_id: tenantId },
        })
      : null;

    const branchName = branch?.name || '';
    const branchAddress = branch?.address || '';
    const branchPhone = branch?.phone || '';

    // Tenders drive the "paid by" lines. Swallowing a query failure here silently prints
    // a receipt with no payment lines at all, so let it surface instead.
    const payments = await this.dataSource.manager.find(Payment, {
      where: { tenant_id: tenantId, order_id: order.id, status: 'SUCCEEDED' },
      order: { initiated_at: 'ASC' },
    });
    const methodIds = [...new Set(payments.map((p) => p.method_id).filter(Boolean))];
    const methods = methodIds.length
      ? await this.dataSource.manager.find(PaymentMethod, {
          where: { tenant_id: tenantId, id: In(methodIds) },
        })
      : [];
    const methodNameById = new Map(methods.map((m) => [m.id, m.name]));

    const tenders = payments.map((p) => ({
      payment_method_name: methodNameById.get(p.method_id) || p.method_kind || '',
      amount: MoneyUtil.format(p.amount, 2),
      reference_number: p.reference || undefined,
    }));

    const items = (order.items || []).filter(isActiveLine).map((it) => ({
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
        tenant_name: tenant?.name || '',
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

