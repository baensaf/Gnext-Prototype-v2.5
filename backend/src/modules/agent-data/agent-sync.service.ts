import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { Agent } from '../../entities/Agent.entity';
import { AgentSyncOrder } from '../../entities/AgentSyncOrder.entity';
import { BusinessDayClose } from '../../entities/BusinessDayClose.entity';
import { loadBusinessClock } from '../../common/utils/business-clock';
import { CashierShift } from '../../entities/CashierShift.entity';
import { Courier } from '../../entities/Courier.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { Delivery } from '../../entities/Delivery.entity';
import { DeliveryAssignment } from '../../entities/DeliveryAssignment.entity';
import { DeliveryEvent } from '../../entities/DeliveryEvent.entity';
import { DiningArea } from '../../entities/DiningArea.entity';
import { DiningTable } from '../../entities/DiningTable.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { OrderItemOption } from '../../entities/OrderItemOption.entity';
import { OrderStateEvent } from '../../entities/OrderStateEvent.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentAttempt } from '../../entities/PaymentAttempt.entity';
import { PaymentDevice } from '../../entities/PaymentDevice.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { Product } from '../../entities/Product.entity';
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { inStorePrice } from '../../common/utils/price-list.util';
import { applyChannelRule } from '../../common/utils/channel-price.util';
import { TILL_EXPEDITIONS, sameSnappfoodLines, snappfoodOrderNumber } from '../../common/utils/snappfood-order.util';
import { AuditWriter } from '../audit/audit-writer.service';
import { CatalogService } from '../catalog/catalog.service';
import { PriceListService } from '../catalog/price-lists.service';
import { ShiftService } from '../cashier/shift.service';
import { CALL_NUMBER_SETTING_KEY, CallChannelGroup, readCallNumberRanges } from '../order/call-number';
import { OrderSequenceService } from '../order/order-sequence.service';
import { bookSucceededPayment } from '../payment/payment-settlement';
import { AgentDataService, BranchSnapshot } from './agent-data.service';

/** At most this many orders in one upload (§12.5). */
export const SYNC_BATCH_MAX = 50;
/** Marks an order the branch took while offline. */
export const AGENT_OFFLINE_SOURCE = 'AGENT_OFFLINE';

/** Why an order is held rather than booked (§12.6). */
export const HOLD_REASONS = new Set(['TOTAL_MISMATCH', 'PRICE_MISMATCH', 'ID_REUSED', 'SHIFT_UNKNOWN', 'INVALID_ORDER', 'PROCESSING_FAILED']);

export type SyncResult = { id: string; result: 'ACCEPTED' | 'DUPLICATE' | 'HELD'; order_number: string | null; flags: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RIALS = /^\d+$/;
const STATES = new Set(['COMPLETED', 'CANCELLED', 'OPEN']);
// AGGREGATOR: a Snappfood order the till took while the cloud was away (§17.6).
const ORDER_TYPES = new Set(['TAKEAWAY', 'DINE_IN', 'DELIVERY', 'AGGREGATOR']);
const SNAPPFOOD_CODE = /^[A-Za-z0-9-]{3,40}$/;
/** The product id a Snappfood line gets when Snappfood named no product of ours. */
const NO_PRODUCT = '00000000-0000-0000-0000-000000000001';

/** What the till knew of a Snappfood order, from Snappfood's panel (§17.4). */
interface TillSnappfood {
  code: string;
  expedition: 'DELIVERY' | 'RIDER' | 'PICKUP';
  payment: 'ONLINE' | 'CASH';
  customer: { name: string | null; phone: string | null; address: string | null } | null;
  courier_id: string | null;
}

/** The order as the till recorded it (§12.4), once its shape has been checked. */
interface OfflineLine {
  id?: string;
  product_id: string;
  product_name: string;
  variant_id: string | null;
  variant_name: string | null;
  quantity: string;
  unit_price: string;
  options: Array<{ option_item_id: string; name: string; group_name: string | null; price_delta: string }>;
  tax_rate: string;
  line_total: string;
  tax: string;
  notes: string | null;
}
interface OfflinePayment {
  id: string;
  method_id: string;
  method_kind: string;
  amount: string;
  status: 'APPROVED' | 'UNKNOWN';
  card: { terminal_id?: string; rrn?: string; stan?: string; card_pan_masked?: string; response_code?: string } | null;
  at: string;
}
interface OfflineOrder {
  id: string;
  data_version: string | null;
  state: 'COMPLETED' | 'CANCELLED' | 'OPEN';
  terminal_id: string | null;
  /** Null only for a Snappfood order, which lands in no drawer (§17.6). */
  shift_id: string | null;
  created_by: string | null;
  order_type: string;
  table_id: string | null;
  /** The table's number, looked up when the order is checked. */
  table_number?: string | null;
  guest_count: number | null;
  delivery_zone_id: string | null;
  call_number: number | null;
  business_date: string;
  placed_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_note: string | null;
  notes: string | null;
  lines: OfflineLine[];
  totals: { subtotal: string; delivery_fee: string; discount_total: string; tax_total: string; grand_total: string };
  payments: OfflinePayment[];
  /** §13.12: kept in the order's history and audit, not booked. */
  voided_lines: Array<Record<string, unknown>>;
  cancelled_by: string | null;
  approved_by: string | null;
  prints: Array<Record<string, unknown>>;
  /** A Snappfood order (§17.6); null for the till's own sales. */
  snappfood: TillSnappfood | null;
}

class Hold extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

const d = (v: unknown) => new Decimal(String(v ?? '0'));
const rial = (v: Decimal) => v.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
const money = (v: unknown) => MoneyUtil.format(v as any);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

/**
 * Offline orders (protocol §12.4–§12.6): the agent uploads what its branch sold while the
 * cloud was out of reach. Each order is saved as received first, then booked as the till
 * recorded it. Differences from the cloud are flagged for a person, never silently rewritten;
 * only an order whose own numbers do not add up, or that charged a price its till was never
 * given, is held back.
 */
@Injectable()
export class AgentSyncService {
  private readonly logger = new Logger(AgentSyncService.name);

  constructor(
    @InjectRepository(AgentSyncOrder) private readonly rows: Repository<AgentSyncOrder>,
    private readonly dataSource: DataSource,
    private readonly data: AgentDataService,
    private readonly catalog: CatalogService,
    private readonly priceLists: PriceListService,
    private readonly shifts: ShiftService,
    private readonly sequences: OrderSequenceService,
    private readonly auditWriter: AuditWriter,
  ) {}

  /** `POST /agent/sync/orders` (§12.5). */
  async receive(agent: Agent, body: unknown): Promise<{ results: SyncResult[] }> {
    const orders = (body as any)?.orders;
    if (!Array.isArray(orders) || orders.length === 0 || orders.length > SYNC_BATCH_MAX) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: `orders must hold 1 to ${SYNC_BATCH_MAX} orders` });
    }
    for (const o of orders) {
      if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !UUID.test(o.id)) {
        throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: 'every order needs a UUID id' });
      }
    }
    const results: SyncResult[] = [];
    for (const order of orders) results.push(await this.receiveOne(agent, order));
    return { results };
  }

  private async receiveOne(agent: Agent, payload: Record<string, any>): Promise<SyncResult> {
    const id = payload.id.toLowerCase();
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    let fresh = !(await this.rows.count({ where: { id } }));
    if (fresh) {
      try {
        await this.rows.insert({
          id,
          tenant_id: agent.tenant_id,
          branch_id: agent.branch_id,
          agent_id: agent.id,
          payload,
          payload_hash: hash,
          status: 'HELD',
          flags: ['PENDING'],
          received_at: new Date(),
        });
      } catch (err: any) {
        // The same order arriving twice at once: the other request saved it first.
        if (err?.code !== '23505') throw err;
        fresh = false;
      }
    }

    if (!fresh) {
      const existing = await this.rows.findOne({ where: { id } });
      if (existing && existing.tenant_id === agent.tenant_id && existing.payload_hash === hash) {
        return {
          id,
          result: existing.status === 'ACCEPTED' ? 'DUPLICATE' : 'HELD',
          order_number: existing.order_number ?? null,
          flags: existing.flags || [],
        };
      }
      // The first upload under this id stands; this one is kept only in the audit trail.
      await this.auditWriter.write({
        tenantId: agent.tenant_id,
        actorType: 'SYSTEM',
        action: 'AGENT_SYNC_ID_REUSED',
        entityType: 'AgentSyncOrder',
        entityId: id,
        branchId: agent.branch_id,
        details: { agent_id: agent.id, payload },
      });
      return { id, result: 'HELD', order_number: null, flags: ['ID_REUSED'] };
    }

    const row = await this.rows.findOneOrFail({ where: { id } });
    return await this.book(row);
  }

  /**
   * What the branches uploaded, newest first (§12.7). `attention` keeps the held orders and the
   * flagged ones nobody has reviewed yet.
   */
  async list(tenantId: string, query: { view?: string; branchId?: string; limit?: number } = {}) {
    const qb = this.rows
      .createQueryBuilder('s')
      .leftJoin('branch', 'b', 'b.id = s.branch_id')
      .select(['s.id', 's.branch_id', 's.status', 's.flags', 's.error', 's.order_number', 's.received_at', 's.booked_at', 's.reviewed_at', 's.reviewed_by'])
      .addSelect('b.name', 'branch_name')
      .addSelect(`s.payload->>'state'`, 'order_state')
      .addSelect(`s.payload->>'call_number'`, 'call_number')
      .addSelect(`s.payload->>'placed_at'`, 'placed_at')
      .addSelect(`s.payload->'totals'->>'grand_total'`, 'grand_total')
      .where('s.tenant_id = :tenantId', { tenantId })
      .orderBy('s.received_at', 'DESC')
      .limit(Math.min(Math.max(Number(query.limit) || 100, 1), 500));
    if (query.branchId) qb.andWhere('s.branch_id = :branchId', { branchId: query.branchId });
    if (query.view !== 'all') {
      qb.andWhere(`(s.status = 'HELD' OR (jsonb_array_length(s.flags) > 0 AND s.reviewed_at IS NULL))`);
    }
    const raw = await qb.getRawMany();
    return raw.map((r) => ({
      id: r.s_id,
      branch_id: r.s_branch_id,
      branch_name: r.branch_name ?? null,
      status: r.s_status,
      flags: r.s_flags || [],
      error: r.s_error ?? null,
      order_number: r.s_order_number ?? null,
      order_state: r.order_state ?? null,
      call_number: r.call_number ? Number(r.call_number) : null,
      placed_at: r.placed_at ?? null,
      grand_total: r.grand_total ?? null,
      received_at: r.s_received_at,
      booked_at: r.s_booked_at ?? null,
      reviewed_at: r.s_reviewed_at ?? null,
      reviewed_by: r.s_reviewed_by ?? null,
    }));
  }

  /** Someone at head office has looked at a flagged order (§12.7). */
  async markReviewed(tenantId: string, id: string, userId?: string) {
    const row = await this.rows.findOne({ where: { id, tenant_id: tenantId } });
    if (!row) throw new NotFoundException('No such uploaded order');
    if (row.status !== 'ACCEPTED') throw new BadRequestException({ code: 'NOT_BOOKED', message: 'A held order is retried, not reviewed' });
    row.reviewed_at = new Date();
    row.reviewed_by = userId ?? null;
    await this.rows.save(row);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: userId,
      action: 'AGENT_SYNC_ORDER_REVIEWED',
      entityType: 'AgentSyncOrder',
      entityId: id,
      branchId: row.branch_id,
      details: { flags: row.flags, order_number: row.order_number },
    });
    return { id, reviewed_at: row.reviewed_at };
  }

  /** Head office retries a held order, for example after restoring a missing product (§12.7). */
  async retry(tenantId: string, id: string, userId?: string): Promise<SyncResult> {
    const row = await this.rows.findOne({ where: { id, tenant_id: tenantId } });
    if (!row) throw new NotFoundException('No such uploaded order');
    if (row.status === 'ACCEPTED') return { id, result: 'DUPLICATE', order_number: row.order_number ?? null, flags: row.flags };
    const result = await this.book(row);
    await this.auditWriter.write({
      tenantId,
      actorType: userId ? 'ADMIN' : 'SYSTEM',
      actorId: userId,
      action: 'AGENT_SYNC_ORDER_RETRIED',
      entityType: 'AgentSyncOrder',
      entityId: id,
      branchId: row.branch_id,
      details: { result: result.result, flags: result.flags },
    });
    return result;
  }

  /** Checks the saved order and books it, or holds it with the reason. */
  private async book(row: AgentSyncOrder): Promise<SyncResult> {
    try {
      const order = parseOrder(row.payload);
      const flags = await this.check(row, order);
      const orderNumber = await this.dataSource.transaction((em) =>
        order.snappfood ? this.bookSnappfood(em, row, order, flags) : this.createOrder(em, row, order),
      );
      row.status = 'ACCEPTED';
      row.flags = flags;
      row.error = null;
      row.order_number = orderNumber;
      row.booked_at = new Date();
      await this.rows.save(row);
      return { id: row.id, result: 'ACCEPTED', order_number: orderNumber, flags };
    } catch (err: any) {
      const reason = err instanceof Hold ? err.reason : 'PROCESSING_FAILED';
      if (!(err instanceof Hold)) this.logger.error(`offline order ${row.id} could not be booked: ${err?.stack || err}`);
      row.status = 'HELD';
      row.flags = [reason];
      row.error = String(err?.message || err).slice(0, 2000);
      await this.rows.save(row);
      return { id: row.id, result: 'HELD', order_number: null, flags: [reason] };
    }
  }

  /**
   * §12.6: holds an order whose numbers do not add up or that charged a price its till never
   * had, and returns the flags for everything else a person should look at.
   */
  private async check(row: AgentSyncOrder, order: OfflineOrder): Promise<string[]> {
    const { tenant_id: tenantId, branch_id: branchId } = row;
    const flags = new Set<string>();
    if (await this.dataSource.getRepository(OrderHeader).count({ where: { id: order.id }, withDeleted: true })) {
      throw new Hold('ID_REUSED', 'An order with this id already exists');
    }

    // The till's own arithmetic.
    let subtotal = d(0);
    let tax = d(0);
    for (const [i, line] of order.lines.entries()) {
      const unit = d(line.unit_price).plus(line.options.reduce((s, o) => s.plus(d(o.price_delta)), d(0)));
      const expected = unit.times(d(line.quantity));
      if (!expected.equals(d(line.line_total))) throw new Hold('TOTAL_MISMATCH', `Line ${i + 1}: ${line.line_total} is not ${expected.toFixed(0)}`);
      if (rial(d(line.line_total).times(d(line.tax_rate))).minus(d(line.tax)).abs().greaterThan(1)) {
        throw new Hold('TOTAL_MISMATCH', `Line ${i + 1}: tax ${line.tax} does not match its rate`);
      }
      subtotal = subtotal.plus(d(line.line_total));
      tax = tax.plus(d(line.tax));
    }
    const t = order.totals;
    const grand = d(t.subtotal).plus(d(t.delivery_fee)).minus(d(t.discount_total)).plus(d(t.tax_total));
    if (!subtotal.equals(d(t.subtotal)) || !tax.equals(d(t.tax_total)) || !grand.equals(d(t.grand_total))) {
      throw new Hold('TOTAL_MISMATCH', 'The totals are not the sum of the lines');
    }
    const paid = order.payments.reduce((s, p) => s.plus(d(p.amount)), d(0));
    if (paid.greaterThan(d(t.grand_total))) throw new Hold('TOTAL_MISMATCH', 'More was paid than the order came to');

    // The prices the till was given: the in-store ones, or Snappfood's for a Snappfood order.
    const snapshot = order.data_version ? await this.data.findServed(tenantId, branchId, order.data_version) : null;
    if (!snapshot) flags.add('SNAPSHOT_UNKNOWN');
    else if (order.snappfood) checkAgainstSnappfoodPrices(order, snapshot);
    else checkAgainstSnapshot(order, snapshot);
    const sheet = order.snappfood ? await this.catalog.getChannelPriceSheet(tenantId, 'SNAPPFOOD', branchId) : null;

    // Today's catalog: what changed or went since.
    const productIds = [...new Set(order.lines.map((l) => l.product_id))];
    const variantIds = order.lines.map((l) => l.variant_id).filter((v): v is string => !!v);
    const optionIds = order.lines.flatMap((l) => l.options.map((o) => o.option_item_id));
    const em = this.dataSource.manager;
    const products: Product[] = await em.find(Product, { where: { id: In(productIds), tenant_id: tenantId }, withDeleted: true });
    const variants: ProductVariant[] = variantIds.length
      ? await em.find(ProductVariant, { where: { id: In(variantIds), tenant_id: tenantId }, withDeleted: true })
      : [];
    const options: OptionItem[] = optionIds.length ? await em.find(OptionItem, { where: { id: In(optionIds), tenant_id: tenantId }, withDeleted: true }) : [];
    const listed = await this.priceLists.pricesForBranch(tenantId, branchId);
    const productById = new Map<string, Product>(products.map((p) => [p.id, p]));
    const variantById = new Map<string, ProductVariant>(variants.map((v) => [v.id, v]));
    const optionById = new Map<string, OptionItem>(options.map((o) => [o.id, o]));
    // An add-on keeps the group name the till sold it under; an agent older than 1.6.0 sends
    // none, and the group's name here stands in for it.
    const groupIds = [...new Set(options.map((o) => o.option_group_id).filter(Boolean))];
    const groups: OptionGroup[] = groupIds.length ? await em.find(OptionGroup, { where: { id: In(groupIds), tenant_id: tenantId }, withDeleted: true }) : [];
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    for (const line of order.lines) {
      for (const o of line.options) o.group_name ??= groupName.get(optionById.get(o.option_item_id)?.option_group_id ?? '') ?? null;
    }
    for (const line of order.lines) {
      const product = productById.get(line.product_id);
      if (!product) throw new Hold('PRICE_MISMATCH', `Product ${line.product_id} was never on this menu`);
      const variant = line.variant_id ? variantById.get(line.variant_id) : null;
      const gone =
        !product.is_active ||
        !!(product as any).deleted_at ||
        (line.variant_id && (!variant || !variant.is_active || !!(variant as any).deleted_at)) ||
        line.options.some((o) => !optionById.get(o.option_item_id) || !!(optionById.get(o.option_item_id) as any)?.deleted_at);
      if (gone) {
        flags.add('ITEM_REMOVED');
        continue;
      }
      // Today's price where the till sold it: in store, or on Snappfood's price sheet.
      const todays = sheet
        ? sheet.items.find((r) => r.product_id === line.product_id && (r.variant_id ?? null) === (line.variant_id ?? null))?.price
        : inStorePrice(listed, product, variant ?? null);
      const addOn = (o: OfflineLine['options'][number]) => {
        const delta = optionById.get(o.option_item_id)!.price_delta || 0;
        return rial(d(sheet ? applyChannelRule(delta, sheet.rule) : delta));
      };
      const changed =
        todays === undefined ||
        !rial(d(todays)).equals(d(line.unit_price)) ||
        !d(product.tax_rate || 0).equals(d(line.tax_rate)) ||
        line.options.some((o) => !addOn(o).equals(d(o.price_delta)));
      if (changed) flags.add('PRICE_CHANGED');
    }

    // The shift and the day it belongs to. A Snappfood order is no register sale: it has no shift.
    if (!order.snappfood) {
      const shift = await em.findOne(CashierShift, { where: { id: order.shift_id!, tenant_id: tenantId } });
      if (!shift || shift.branch_id !== branchId) throw new Hold('SHIFT_UNKNOWN', 'The shift is not one of this branch');
      if (shift.state !== 'OPEN') flags.add('SHIFT_CLOSED');
    }
    const dayClosed = await em.findOne(BusinessDayClose, { where: { tenant_id: tenantId, branch_id: branchId, business_date: order.business_date, status: 'CLOSED' } });
    if (dayClosed) flags.add('DAY_CLOSED');
    // Every channel dates a sale by the branch's cutoff. The till's date is kept, as the branch
    // sold it, but one the rule would not give its placing time is for a person to look at.
    const clock = await loadBusinessClock(em, tenantId, branchId);
    if (clock.dateOf(order.placed_at) !== order.business_date) flags.add('BUSINESS_DATE_DIFFERS');

    // The table must be one of this branch's. An open dine-in order on it keeps it occupied on
    // the floor plan until staff finish it; one the branch no longer has is booked without a
    // table, for a person to seat.
    if (order.table_id) {
      const table = await em
        .createQueryBuilder(DiningTable, 't')
        .innerJoin(DiningArea, 'a', 'a.id = t.dining_area_id')
        .where('t.id = :id AND t.tenant_id = :tenantId AND a.branch_id = :branchId', { id: order.table_id, tenantId, branchId })
        .getOne();
      if (table) order.table_number = table.table_number;
      else {
        flags.add('TABLE_UNKNOWN');
        order.table_id = null;
      }
    }

    // Payment methods must be real ones.
    const methodIds = [...new Set(order.payments.map((p) => p.method_id))];
    if (methodIds.length) {
      const found = await em.count(PaymentMethod, { where: { id: In(methodIds), tenant_id: tenantId } });
      if (found !== methodIds.length) throw new Hold('INVALID_ORDER', 'A payment method is not one of this tenant');
    }

    // Stock counted for the day, which the order takes below zero.
    if (order.state !== 'CANCELLED') {
      const counts = await this.catalog.getDailyStock(tenantId, branchId, order.business_date);
      for (const count of counts) {
        const qty = order.lines
          .filter((l) => l.product_id === count.product_id && (!count.variant_id || l.variant_id === count.variant_id))
          .reduce((s, l) => s + Number(l.quantity), 0);
        if (qty > count.remaining) flags.add('STOCK_NEGATIVE');
      }
    }
    return [...flags];
  }

  /** Books the order as the till recorded it. Returns its order number. */
  private async createOrder(em: EntityManager, row: AgentSyncOrder, order: OfflineOrder): Promise<string> {
    const { tenant_id: tenantId, branch_id: branchId } = row;
    // A Snappfood order keeps the number every record of it shares (§17.7).
    const sf = order.snappfood;
    const orderNumber = sf ? snappfoodOrderNumber(sf.code) : await this.sequences.generateOrderNumber(tenantId, em);
    const placedAt = new Date(order.placed_at);
    const state = order.state === 'OPEN' ? 'CONFIRMED' : order.state;
    const t = order.totals;

    const header = await em.save(
      OrderHeader,
      em.create(OrderHeader, {
        id: order.id,
        tenant_id: tenantId,
        branch_id: branchId,
        terminal_id: order.terminal_id,
        shift_id: order.shift_id,
        order_number: orderNumber,
        call_number: order.call_number,
        order_type: order.order_type,
        channel: sf ? 'AGGREGATOR' : 'POS',
        state,
        status: state,
        currency_code: 'IRR',
        table_id: order.table_id,
        table_number: order.table_number ?? null,
        guest_count: order.guest_count,
        delivery_zone_id: order.delivery_zone_id,
        business_date: order.business_date,
        subtotal: money(t.subtotal),
        subtotal_amount: money(t.subtotal),
        modifier_total: money(order.lines.reduce((s, l) => s.plus(l.options.reduce((a, o) => a.plus(d(o.price_delta)), d(0)).times(d(l.quantity))), d(0))),
        delivery_fee: money(t.delivery_fee),
        discount_total: money(t.discount_total),
        discount_amount: money(t.discount_total),
        tax_total: money(t.tax_total),
        tax_amount: money(t.tax_total),
        grand_total: money(t.grand_total),
        total_amount: money(t.grand_total),
        paid_total: '0.0000',
        paid_amount: '0.0000',
        outstanding_total: money(t.grand_total),
        due_amount: money(t.grand_total),
        notes: sf ? tillSnappfoodNotes(order) : order.notes,
        submitted_at: placedAt,
        completed_at: order.completed_at ? new Date(order.completed_at) : null,
        cancelled_at: order.cancelled_at ? new Date(order.cancelled_at) : null,
        placed_at: placedAt,
        created_by: order.created_by,
        source: AGENT_OFFLINE_SOURCE,
        // Accepted when the till placed it; Snappfood's own record is still to come.
        ...(sf
          ? {
              accepted_at: state === 'CONFIRMED' ? placedAt : null,
              aggregator_expedition: TILL_EXPEDITIONS[sf.expedition],
              aggregator_match: 'TILL_ONLY',
              aggregator_match_at: new Date(),
            }
          : {}),
      } as Partial<OrderHeader>),
    );

    for (const [i, line] of order.lines.entries()) {
      const modifiers = line.options.reduce((s, o) => s.plus(d(o.price_delta)), d(0)).times(d(line.quantity));
      const base = d(line.unit_price).times(d(line.quantity));
      const item = await em.save(
        OrderItem,
        em.create(OrderItem, {
          tenant_id: tenantId,
          order_id: header.id,
          line_number: i + 1,
          product_id: line.product_id,
          product_name: line.product_name.slice(0, 160),
          variant_id: line.variant_id,
          variant_name: line.variant_name?.slice(0, 160) ?? null,
          quantity: MoneyUtil.format(line.quantity, 3),
          unit_price: money(line.unit_price),
          base_total: money(base),
          subtotal: money(base),
          modifier_total: money(modifiers),
          tax_total: money(line.tax),
          tax_amount: money(line.tax),
          line_total: money(line.line_total),
          total_amount: money(d(line.line_total).plus(d(line.tax))),
          notes: line.notes,
          state: 'ACTIVE',
        } as Partial<OrderItem>),
      );
      for (const opt of line.options) {
        await em.save(
          OrderItemOption,
          em.create(OrderItemOption, {
            tenant_id: tenantId,
            order_item_id: item.id,
            option_item_id: opt.option_item_id,
            option_group_name: (opt.group_name ?? '').slice(0, 160),
            option_item_name: opt.name.slice(0, 160),
            price_delta: money(opt.price_delta),
          } as Partial<OrderItemOption>),
        );
      }
    }

    await em.save(
      OrderStateEvent,
      em.create(OrderStateEvent, {
        tenant_id: tenantId,
        order_id: header.id,
        from_state: null,
        to_state: state,
        action: 'OFFLINE_SYNC',
        reason_text: order.cancellation_note,
        occurred_at: placedAt,
        occurred_by: order.cancelled_by ?? order.created_by,
        snapshot: {
          source: AGENT_OFFLINE_SOURCE,
          agent_id: row.agent_id,
          data_version: order.data_version,
          flags: row.flags,
          ...tillRecord(order),
        },
      } as Partial<OrderStateEvent>),
    );

    const deviceIds = order.payments.map((p) => p.card?.terminal_id).filter((v): v is string => typeof v === 'string' && UUID.test(v));
    const devices = new Set(
      deviceIds.length ? (await em.find(PaymentDevice, { where: { tenant_id: tenantId, id: In(deviceIds) } })).map((dv) => dv.id) : [],
    );
    let orderRow = header;
    for (const [i, p] of order.payments.entries()) {
      const at = new Date(p.at);
      const payment = await em.save(
        Payment,
        em.create(Payment, {
          id: p.id,
          tenant_id: tenantId,
          order_id: header.id,
          payment_number: `${orderNumber.replace(/^ORD-/, 'PAY-')}-${i + 1}`,
          method_id: p.method_id,
          method_kind: p.method_kind || 'CASH',
          status: 'PROCESSING',
          amount: money(p.amount),
          currency_code: 'IRR',
          device_id: p.card?.terminal_id && devices.has(p.card.terminal_id) ? p.card.terminal_id : null,
          reference: p.card?.rrn ?? null,
          shift_id: order.shift_id,
          business_date: order.business_date,
          idempotency_key: `offline:${p.id}`,
          initiated_at: at,
        } as Partial<Payment>),
      );
      await em.save(
        PaymentAttempt,
        em.create(PaymentAttempt, {
          tenant_id: tenantId,
          payment_id: payment.id,
          attempt_no: 1,
          // A card charge keeps the agent adapter, so an unconfirmed one can be checked and
          // resolved like any other (Checkout → Check terminal / Resolve).
          adapter: p.card ? 'AGENT' : AGENT_OFFLINE_SOURCE,
          status: p.status === 'APPROVED' ? 'SUCCEEDED' : 'UNKNOWN',
          external_reference: p.card?.rrn ?? null,
          response_snapshot: { offline: true, ...(p.card || {}) },
          started_at: at,
          finished_at: at,
        } as Partial<PaymentAttempt>),
      );
      if (p.status === 'APPROVED') {
        await bookSucceededPayment(em, this.auditWriter, payment, orderRow, {
          userId: order.created_by,
          correlationId: row.id,
          actorType: order.created_by ? 'ADMIN' : 'SYSTEM',
        });
        payment.posted_at = at;
        await em.save(Payment, payment);
        orderRow = (await em.findOne(OrderHeader, { where: { id: header.id } }))!;
        if ((p.method_kind || 'CASH') === 'CASH' && order.shift_id) {
          await this.shifts.recordCashPaymentMovement(tenantId, order.shift_id, payment.id, payment.amount, order.created_by || undefined, em);
        }
      } else {
        payment.needs_terminal_check = true;
        await em.save(Payment, payment);
      }
    }

    if (order.call_number) await this.raiseCallCounter(em, tenantId, branchId, order.business_date, order.call_number, sf ? 'ONLINE' : 'POS');

    await this.auditWriter.writeInTransaction(em, {
      tenantId,
      actorType: order.created_by ? 'ADMIN' : 'SYSTEM',
      actorId: order.created_by ?? undefined,
      action: 'ORDER_OFFLINE_SYNCED',
      entityType: 'Order',
      entityId: header.id,
      branchId,
      correlationId: row.id,
      details: { agent_id: row.agent_id, order_number: orderNumber, state, data_version: order.data_version, ...tillRecord(order) },
    });
    return orderNumber;
  }

  /**
   * The day's counter moves up to at least the numbers the till handed out offline: POS for its
   * own sales, ONLINE for the Snappfood orders it took (§17.5).
   */
  private async raiseCallCounter(
    em: EntityManager,
    tenantId: string,
    branchId: string,
    businessDate: string,
    callNumber: number,
    group: CallChannelGroup = 'POS',
  ) {
    const setting = await em.findOne(TenantSetting, { where: { tenant_id: tenantId, key: CALL_NUMBER_SETTING_KEY, branch_id: IsNull() } });
    const range = readCallNumberRanges(setting?.value)[group];
    if (callNumber < range.start || callNumber > range.end) return;
    const n = callNumber - range.start + 1;
    await em.query(
      `INSERT INTO "order_call_counter" ("tenant_id", "branch_id", "business_date", "channel_group", "last_value")
       VALUES ($1, $2, $3, $5, $4)
       ON CONFLICT ("tenant_id", "branch_id", "business_date", "channel_group")
       DO UPDATE SET "last_value" = GREATEST("order_call_counter"."last_value", EXCLUDED."last_value")`,
      [tenantId, branchId, businessDate, n, group],
    );
  }

  /**
   * A Snappfood order the till took while the cloud was away (§17.7). With no order of its code
   * yet, it is booked from the till and waits for Snappfood's record (`TILL_ONLY`). With one
   * already there (pulled, or brought by the webhook while only the branch was cut off),
   * Snappfood's lines and money stand, and the till adds what Snappfood cannot know.
   */
  private async bookSnappfood(em: EntityManager, row: AgentSyncOrder, order: OfflineOrder, flags: string[]): Promise<string> {
    const sf = order.snappfood!;
    const existing = await em
      .createQueryBuilder(OrderHeader, 'o')
      .setLock('pessimistic_write')
      .where('o.tenant_id = :tenantId AND o.order_number = :number', { tenantId: row.tenant_id, number: snappfoodOrderNumber(sf.code) })
      .getOne();
    if (!existing) {
      const orderNumber = await this.createOrder(em, row, order);
      const header = (await em.findOne(OrderHeader, { where: { id: order.id } }))!;
      await this.placeOnDeliveryBoard(em, header, order, flags);
      return orderNumber;
    }
    if (existing.branch_id !== row.branch_id) throw new Hold('INVALID_ORDER', `Snappfood order ${sf.code} belongs to another branch`);
    return await this.matchTillToSnappfood(em, row, order, existing, flags);
  }

  /** The till's record joins Snappfood's, already in the cloud (§17.7). */
  private async matchTillToSnappfood(em: EntityManager, row: AgentSyncOrder, order: OfflineOrder, existing: OrderHeader, flags: string[]): Promise<string> {
    const { tenant_id: tenantId, branch_id: branchId } = row;
    const placedAt = new Date(order.placed_at);
    const items = await em.find(OrderItem, { where: { tenant_id: tenantId, order_id: existing.id, state: 'ACTIVE' } });
    const theirs = items.map((i) => ({ product_id: i.product_id === NO_PRODUCT ? null : i.product_id, product_name: i.product_name, quantity: i.quantity }));
    if (!sameSnappfoodLines(order.lines, theirs)) flags.push('SNAPPFOOD_DIFFERS');
    const tillCancelled = order.state === 'CANCELLED';
    const cloudCancelled = ['CANCELLED', 'REJECTED'].includes(existing.state);
    if (tillCancelled !== cloudCancelled) flags.push('SNAPPFOOD_CANCELLED');
    // Accepted in the cloud as well as on the till: both kitchens' tickets may have gone out.
    if (!existing.aggregator_match && !['PENDING_ACCEPTANCE', 'CANCELLED', 'REJECTED'].includes(existing.state)) {
      flags.push('SNAPPFOOD_ACCEPTED_TWICE');
    }

    const fromState = existing.state;
    if (existing.state === 'PENDING_ACCEPTANCE' && !tillCancelled) {
      existing.state = 'CONFIRMED';
      existing.status = 'CONFIRMED';
      existing.accepted_at = placedAt;
      existing.submitted_at = existing.submitted_at || placedAt;
    }
    if (!existing.call_number && order.call_number) {
      existing.call_number = order.call_number;
      existing.business_date = existing.business_date || order.business_date;
      await this.raiseCallCounter(em, tenantId, branchId, order.business_date, order.call_number, 'ONLINE');
    }
    existing.source = existing.source || AGENT_OFFLINE_SOURCE;
    existing.aggregator_match = 'MATCHED';
    existing.aggregator_match_at = new Date();
    await em.save(OrderHeader, existing);

    await em.save(
      OrderStateEvent,
      em.create(OrderStateEvent, {
        tenant_id: tenantId,
        order_id: existing.id,
        from_state: fromState,
        to_state: existing.state,
        action: 'OFFLINE_SYNC_MATCHED',
        occurred_at: placedAt,
        occurred_by: order.cancelled_by ?? order.created_by,
        snapshot: {
          source: AGENT_OFFLINE_SOURCE,
          agent_id: row.agent_id,
          till_order_id: order.id,
          snappfood: order.snappfood,
          till_lines: order.lines.map((l) => ({ product_name: l.product_name, variant_name: l.variant_name, quantity: l.quantity, line_total: l.line_total })),
          flags,
          ...tillRecord(order),
        },
      } as Partial<OrderStateEvent>),
    );
    await this.placeOnDeliveryBoard(em, existing, order, flags);
    await this.auditWriter.writeInTransaction(em, {
      tenantId,
      actorType: order.created_by ? 'ADMIN' : 'SYSTEM',
      actorId: order.created_by ?? undefined,
      action: 'ORDER_OFFLINE_SYNCED',
      entityType: 'Order',
      entityId: existing.id,
      branchId,
      correlationId: row.id,
      details: { agent_id: row.agent_id, order_number: existing.order_number, matched: true, till_order_id: order.id, flags, ...tillRecord(order) },
    });
    return existing.order_number;
  }

  /**
   * A Snappfood order the store delivers itself goes on the delivery board, with the courier the
   * till picked (§17.1 decision 6). The address is Snappfood's when its record is in, else the
   * one typed on the till. The courier was chosen at the counter, so they are assigned whether or
   * not they checked in here; delivered, failed and their cash are recorded on Dispatch.
   */
  private async placeOnDeliveryBoard(em: EntityManager, header: OrderHeader, order: OfflineOrder, flags: string[]) {
    const sf = order.snappfood!;
    if (sf.expedition !== 'DELIVERY' || ['CANCELLED', 'REJECTED', 'COMPLETED'].includes(header.state)) return;
    const tenantId = header.tenant_id;
    const placedAt = new Date(order.placed_at);
    const reason = 'Snappfood order taken on the till while the cloud was away';
    let delivery = await em.findOne(Delivery, { where: { tenant_id: tenantId, order_id: header.id } });
    if (!delivery) {
      const address = header.customer_address_id
        ? await em.findOne(CustomerAddress, { where: { id: header.customer_address_id, tenant_id: tenantId } })
        : null;
      delivery = await em.save(
        Delivery,
        em.create(Delivery, {
          tenant_id: tenantId,
          order_id: header.id,
          zone_id: null,
          courier_id: null,
          state: 'UNASSIGNED',
          fee: header.delivery_fee || '0.0000',
          currency_code: header.currency_code || 'IRR',
          address_snapshot: address
            ? {
                address_id: address.id,
                title: address.title,
                address_text: address.address_text,
                postal_code: address.postal_code || null,
                customer_id: header.customer_id,
              }
            : {
                address_text: sf.customer?.address ?? null,
                customer_name: sf.customer?.name ?? null,
                phone: sf.customer?.phone ?? null,
                typed_on_till: true,
              },
        } as Partial<Delivery>),
      );
      await em.save(
        DeliveryEvent,
        em.create(DeliveryEvent, { tenant_id: tenantId, delivery_id: delivery.id, from_state: 'NONE', to_state: 'UNASSIGNED', reason, occurred_by: order.created_by }),
      );
    }
    if (!sf.courier_id || delivery.courier_id || delivery.state !== 'UNASSIGNED') return;
    const courier = await em.findOne(Courier, { where: { id: sf.courier_id, tenant_id: tenantId, branch_id: header.branch_id, is_active: true } });
    if (!courier) {
      flags.push('COURIER_UNKNOWN');
      return;
    }
    delivery.courier_id = courier.id;
    delivery.state = 'ASSIGNED';
    delivery.assigned_at = placedAt;
    await em.save(Delivery, delivery);
    await em.save(
      DeliveryEvent,
      em.create(DeliveryEvent, {
        tenant_id: tenantId,
        delivery_id: delivery.id,
        from_state: 'UNASSIGNED',
        to_state: 'ASSIGNED',
        reason: `Assigned to ${courier.name} on the till`,
        occurred_by: order.created_by,
      }),
    );
    await em.save(
      DeliveryAssignment,
      em.create(DeliveryAssignment, {
        tenant_id: tenantId,
        order_id: header.id,
        courier_id: courier.id,
        status: 'ASSIGNED',
        assigned_at: placedAt,
        delivery_fee: delivery.fee || '0.00',
        tip_amount: '0.00',
      }),
    );
  }
}

/**
 * What the till recorded beyond the order itself (§13.12): lines voided after the kitchen had
 * them, who cancelled and who approved, and what printed. Kept with the order's history, not booked.
 */
function tillRecord(order: OfflineOrder) {
  return {
    voided_lines: order.voided_lines,
    cancelled_by: order.cancelled_by,
    approved_by: order.approved_by,
    prints: order.prints,
  };
}

/**
 * A Snappfood order's notes, as the cloud writes them for one the webhook brought: who, where,
 * how it travels and how it was paid, here as the cashier typed them from Snappfood's panel.
 */
function tillSnappfoodNotes(order: OfflineOrder): string {
  const sf = order.snappfood!;
  return [
    `Snappfood order ${sf.code} (typed on the till while the cloud was away)`,
    sf.customer?.name && `Customer: ${sf.customer.name}`,
    sf.customer?.phone && `Phone: ${sf.customer.phone}`,
    sf.customer?.address && `Address: ${sf.customer.address}`,
    `Delivery: ${TILL_EXPEDITIONS[sf.expedition]}`,
    `Payment: ${sf.payment}`,
    order.notes && `Note: ${order.notes}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** A Snappfood order's prices must be the ones its snapshot gave for Snappfood (§17.6). */
function checkAgainstSnappfoodPrices(order: OfflineOrder, snapshot: BranchSnapshot) {
  if (!snapshot.snappfood) throw new Hold('PRICE_MISMATCH', "The till's snapshot has no Snappfood prices");
  const products = new Map<string, any>((snapshot.products || []).map((p: any) => [p.id, p]));
  const prices = new Map<string, string>((snapshot.snappfood.prices || []).map((p: any) => [`${p.product_id}:${p.variant_id ?? ''}`, p.price]));
  const addOns = new Map<string, string>((snapshot.snappfood.add_ons || []).map((a: any) => [a.option_item_id, a.price_delta]));
  for (const [i, line] of order.lines.entries()) {
    const p = products.get(line.product_id);
    if (!p) throw new Hold('PRICE_MISMATCH', `Line ${i + 1}: the till's snapshot has no such product`);
    const price = prices.get(`${line.product_id}:${line.variant_id ?? ''}`);
    if (price === undefined || !d(price).equals(d(line.unit_price))) {
      throw new Hold('PRICE_MISMATCH', `Line ${i + 1}: charged ${line.unit_price}, Snappfood's price in the snapshot is ${price ?? 'nothing'}`);
    }
    if (!d(p.tax_rate).equals(d(line.tax_rate))) throw new Hold('PRICE_MISMATCH', `Line ${i + 1}: tax rate differs from the snapshot`);
    for (const o of line.options) {
      if (!addOns.has(o.option_item_id) || !d(addOns.get(o.option_item_id)).equals(d(o.price_delta))) {
        throw new Hold('PRICE_MISMATCH', `Line ${i + 1}: an add-on's Snappfood price differs from the snapshot`);
      }
    }
  }
}

/** The Snappfood block of an uploaded order (§17.6). */
function parseSnappfood(raw: any, bad: (why: string) => never, uuidOrNull: (v: unknown, name: string) => string | null): TillSnappfood {
  if (!raw || typeof raw !== 'object') bad('a Snappfood order needs its snappfood block');
  const code = typeof raw.code === 'string' ? raw.code.trim() : '';
  if (!SNAPPFOOD_CODE.test(code)) bad('snappfood.code must be 3 to 40 letters, digits or -');
  if (!Object.prototype.hasOwnProperty.call(TILL_EXPEDITIONS, raw.expedition)) bad('snappfood.expedition must be DELIVERY, RIDER or PICKUP');
  const payment = raw.payment ?? 'ONLINE';
  if (payment !== 'ONLINE' && payment !== 'CASH') bad('snappfood.payment must be ONLINE or CASH');
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const c = raw.customer && typeof raw.customer === 'object' ? raw.customer : null;
  return {
    code,
    expedition: raw.expedition,
    payment,
    customer: c ? { name: text(c.name, 120), phone: text(c.phone, 40), address: text(c.address, 500) } : null,
    courier_id: uuidOrNull(raw.courier_id, 'snappfood.courier_id'),
  };
}

/** The price the till charged must be one its snapshot gave it. */
function checkAgainstSnapshot(order: OfflineOrder, snapshot: BranchSnapshot) {
  const products = new Map<string, any>((snapshot.products || []).map((p: any) => [p.id, p]));
  for (const [i, line] of order.lines.entries()) {
    const p = products.get(line.product_id);
    if (!p) throw new Hold('PRICE_MISMATCH', `Line ${i + 1}: the till's snapshot has no such product`);
    const price = line.variant_id ? (p.variants || []).find((v: any) => v.id === line.variant_id)?.price : p.price;
    if (price === undefined || !d(price).equals(d(line.unit_price))) {
      throw new Hold('PRICE_MISMATCH', `Line ${i + 1}: charged ${line.unit_price}, the snapshot says ${price ?? 'nothing'}`);
    }
    if (!d(p.tax_rate).equals(d(line.tax_rate))) throw new Hold('PRICE_MISMATCH', `Line ${i + 1}: tax rate differs from the snapshot`);
    const offered = new Map<string, string>();
    for (const g of p.option_groups || []) for (const it of g.items || []) offered.set(it.id, it.price_delta);
    for (const o of line.options) {
      if (!offered.has(o.option_item_id) || !d(offered.get(o.option_item_id)).equals(d(o.price_delta))) {
        throw new Hold('PRICE_MISMATCH', `Line ${i + 1}: an add-on's price differs from the snapshot`);
      }
    }
  }
}

/** Checks the shape of an uploaded order (§12.4). A malformed one is held, not refused. */
export function parseOrder(raw: Record<string, any>): OfflineOrder {
  const bad = (why: string): never => {
    throw new Hold('INVALID_ORDER', why);
  };
  const uuidOrNull = (v: unknown, name: string) => (v === null || v === undefined ? null : typeof v === 'string' && UUID.test(v) ? v : bad(`${name} is not a UUID`));
  const amount = (v: unknown, name: string) => (typeof v === 'string' && RIALS.test(v) ? v : bad(`${name} is not whole rials`));
  const time = (v: unknown, name: string) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : bad(`${name} is not a time`));

  if (!STATES.has(raw.state)) bad('state must be COMPLETED, CANCELLED or OPEN');
  if (!ORDER_TYPES.has(raw.order_type)) bad('order_type must be TAKEAWAY, DINE_IN, DELIVERY or AGGREGATOR');
  if (typeof raw.business_date !== 'string' || !DATE.test(raw.business_date)) bad('business_date is not YYYY-MM-DD');
  // A Snappfood order (§17.6): no shift, no payments, and never finished on the till.
  const isSnappfood = raw.order_type === 'AGGREGATOR';
  if (isSnappfood !== (raw.channel === 'AGGREGATOR')) bad('a Snappfood order has channel and order_type AGGREGATOR');
  if (!isSnappfood && raw.snappfood !== undefined && raw.snappfood !== null) bad('only a Snappfood order has a snappfood block');
  if (isSnappfood && raw.state === 'COMPLETED') bad('a Snappfood order goes up OPEN or CANCELLED');
  if (isSnappfood && (raw.payments || []).length) bad('a Snappfood order carries no payments');
  const shiftId = uuidOrNull(raw.shift_id, 'shift_id');
  if (!shiftId && !isSnappfood) bad('shift_id is required');
  const snappfood = isSnappfood ? parseSnappfood(raw.snappfood, bad, uuidOrNull) : null;
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) bad('an order needs lines');
  if (!raw.totals || typeof raw.totals !== 'object') bad('totals are missing');
  if (raw.payments !== undefined && !Array.isArray(raw.payments)) bad('payments must be a list');
  if (raw.totals.discount_total !== undefined && raw.totals.discount_total !== '0') bad('discounts are not taken offline');
  if (raw.state === 'CANCELLED' && (raw.payments || []).length) bad('a cancelled order has no payments');

  const lines: OfflineLine[] = raw.lines.map((l: any, i: number) => {
    if (!l || typeof l !== 'object') bad(`line ${i + 1} is not an object`);
    const q = String(l.quantity ?? '');
    if (!/^[1-9]\d*$/.test(q)) bad(`line ${i + 1}: quantity is not a whole number`);
    if (!Array.isArray(l.options ?? [])) bad(`line ${i + 1}: options must be a list`);
    return {
      id: str(l.id) ?? undefined,
      product_id: uuidOrNull(l.product_id, `line ${i + 1} product_id`) ?? bad(`line ${i + 1}: product_id is required`),
      product_name: str(l.product_name) ?? bad(`line ${i + 1}: product_name is required`),
      variant_id: uuidOrNull(l.variant_id, `line ${i + 1} variant_id`),
      variant_name: str(l.variant_name),
      quantity: q,
      unit_price: amount(l.unit_price, `line ${i + 1} unit_price`),
      options: (l.options ?? []).map((o: any, j: number) => ({
        option_item_id: uuidOrNull(o?.option_item_id, `line ${i + 1} option ${j + 1}`) ?? bad(`line ${i + 1}: option ${j + 1} has no id`),
        name: str(o?.name) ?? '',
        group_name: str(o?.group_name),
        price_delta: amount(o?.price_delta, `line ${i + 1} option ${j + 1} price_delta`),
      })),
      tax_rate: typeof l.tax_rate === 'string' && /^\d+(\.\d+)?$/.test(l.tax_rate) ? l.tax_rate : bad(`line ${i + 1}: tax_rate is not a decimal`),
      line_total: amount(l.line_total, `line ${i + 1} line_total`),
      tax: amount(l.tax, `line ${i + 1} tax`),
      notes: str(l.notes),
    };
  });

  const payments: OfflinePayment[] = (raw.payments || []).map((p: any, i: number) => {
    if (!p || typeof p !== 'object') bad(`payment ${i + 1} is not an object`);
    if (p.status !== 'APPROVED' && p.status !== 'UNKNOWN') bad(`payment ${i + 1}: status must be APPROVED or UNKNOWN`);
    if (p.status === 'UNKNOWN' && !p.card) bad(`payment ${i + 1}: only a card charge can be UNKNOWN`);
    return {
      id: uuidOrNull(p.id, `payment ${i + 1} id`) ?? bad(`payment ${i + 1}: id is required`),
      method_id: uuidOrNull(p.method_id, `payment ${i + 1} method_id`) ?? bad(`payment ${i + 1}: method_id is required`),
      method_kind: str(p.method_kind) ?? 'CASH',
      amount: amount(p.amount, `payment ${i + 1} amount`),
      status: p.status,
      card: p.card && typeof p.card === 'object' ? p.card : null,
      at: time(p.at, `payment ${i + 1} at`),
    };
  });

  const callNumber = raw.call_number === null || raw.call_number === undefined ? null : Number(raw.call_number);
  if (callNumber !== null && (!Number.isInteger(callNumber) || callNumber < 1)) bad('call_number is not a positive whole number');
  const guests = raw.guest_count === null || raw.guest_count === undefined ? null : Number(raw.guest_count);
  // Records kept for people to read, not booked: taken as they come, within reason.
  const records = (v: unknown, name: string) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => !x || typeof x !== 'object' || Array.isArray(x))) bad(`${name} must be a list of objects`);
    return (v as Array<Record<string, unknown>>).slice(0, 200);
  };

  return {
    id: String(raw.id).toLowerCase(),
    data_version: str(raw.data_version),
    state: raw.state,
    terminal_id: uuidOrNull(raw.terminal_id, 'terminal_id'),
    shift_id: shiftId,
    created_by: uuidOrNull(raw.created_by, 'created_by'),
    order_type: raw.order_type,
    table_id: uuidOrNull(raw.table_id, 'table_id'),
    guest_count: guests !== null && Number.isInteger(guests) && guests > 0 ? guests : null,
    delivery_zone_id: uuidOrNull(raw.delivery_zone_id, 'delivery_zone_id'),
    call_number: callNumber,
    business_date: raw.business_date,
    placed_at: time(raw.placed_at, 'placed_at'),
    completed_at: raw.state === 'COMPLETED' ? time(raw.completed_at ?? raw.placed_at, 'completed_at') : null,
    cancelled_at: raw.state === 'CANCELLED' ? time(raw.cancelled_at ?? raw.placed_at, 'cancelled_at') : null,
    cancellation_note: str(raw.cancellation_note),
    notes: str(raw.notes),
    lines,
    totals: {
      subtotal: amount(raw.totals.subtotal, 'totals.subtotal'),
      delivery_fee: amount(raw.totals.delivery_fee ?? '0', 'totals.delivery_fee'),
      discount_total: '0',
      tax_total: amount(raw.totals.tax_total, 'totals.tax_total'),
      grand_total: amount(raw.totals.grand_total, 'totals.grand_total'),
    },
    payments,
    voided_lines: records(raw.voided_lines, 'voided_lines'),
    cancelled_by: uuidOrNull(raw.cancelled_by, 'cancelled_by'),
    approved_by: uuidOrNull(raw.approved_by, 'approved_by'),
    prints: records(raw.prints, 'prints'),
    snappfood,
  };
}
