import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, IsNull } from 'typeorm';
import { BusinessDayClose } from '../../entities/BusinessDayClose.entity';
import { CashierShift } from '../../entities/CashierShift.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { TableSession } from '../../entities/TableSession.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { OrderTransitionRecorder } from '../order-lifecycle/order-transition-recorder.service';
import { BusinessDayCloseDto, BusinessDayReopenDto } from './dtos/shift.dto';

import { MoneyUtil } from '../../common/utils/money.util';
import {
  BusinessDateUtil,
  ORDER_BUSINESS_DATE_EXPR,
  NON_REVENUE_ORDER_STATES,
  REVENUE_ORDER_PREDICATE,
} from '../../common/utils/business-date.util';

/** Order states that are still open: anything not completed, cancelled or rejected. */
const OPEN_ORDER_STATES = ['DRAFT', 'PENDING_ACCEPTANCE', 'SUBMITTED', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'];

/** Where an order has finished; rows written straight to the table may say so only in `status`. */
const FINISHED_ORDER_STATES = ['COMPLETED', 'CANCELLED', 'REJECTED'];

/** Open states a paid order is simply completed from when its day closes. */
const COMPLETABLE_AT_DAY_CLOSE = ['SUBMITTED', 'CONFIRMED', 'PREPARING', 'READY'];

/** Why an open order cannot just be completed when the day closes. */
export type OpenOrderIssue = 'UNPAID' | 'NOT_SUBMITTED' | 'AWAITING_ACCEPTANCE' | 'DELIVERY_NOT_FINISHED';

export interface DayCloseOpenOrder {
  id: string;
  orderNumber: string;
  orderType: string;
  channel: string;
  state: string;
  businessDate: string | null;
  placedAt: Date;
  tableNumber: string | null;
  grandTotal: string;
  outstandingTotal: string;
  issue?: OpenOrderIssue;
}

export interface DayCloseOpenOrders {
  /** Paid and handed over in all but name; closing the day completes them. */
  toComplete: DayCloseOpenOrder[];
  /** Unpaid or unfinished; the day closes only once they are dealt with or carried over. */
  needsDecision: DayCloseOpenOrder[];
}

@Injectable()
export class BusinessDayService {
  constructor(
    @InjectRepository(BusinessDayClose) private readonly dayCloseRepo: Repository<BusinessDayClose>,
    @InjectRepository(CashierShift) private readonly shiftRepo: Repository<CashierShift>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    private readonly auditWriter: AuditWriter,
    private readonly dataSource: DataSource,
    private readonly transitionRecorder: OrderTransitionRecorder,
  ) {}

  async getBusinessDays(tenantId: string, query: any) {
    const qb = this.dayCloseRepo
      .createQueryBuilder('d')
      .where('d.tenant_id = :tenantId', { tenantId });

    // The screen sends `branch`; the branch-scope interceptor fills in `branchId` for an
    // account pinned to one shop. Reading only the first meant a branch manager asking for
    // nothing in particular was answered about the whole chain.
    const branch = query.branch || query.branchId;
    if (branch) qb.andWhere('d.branch_id = :branch', { branch });
    if (query.businessDate) qb.andWhere('d.business_date = :businessDate', { businessDate: query.businessDate });
    if (query.currency) qb.andWhere('d.currency_code = :currency', { currency: query.currency });
    if (query.status) qb.andWhere('d.status = :status', { status: query.status });

    qb.orderBy('d.closed_at', 'DESC');
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '50', 10);
    qb.skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  /** What closing this day would do with the branch's open orders, for the close dialog. */
  async getOpenOrders(
    tenantId: string,
    query: { branchId?: string; businessDate?: string; currencyCode?: string },
  ): Promise<DayCloseOpenOrders> {
    if (!query.branchId || !query.businessDate) {
      throw new BadRequestException('branchId and businessDate are required');
    }
    const orders = await this.findOpenOrders(
      this.dataSource.manager,
      tenantId,
      query.branchId,
      query.businessDate,
      query.currencyCode || 'IRR',
    );
    const { toComplete, needsDecision } = this.sortOpenOrders(
      orders,
      await this.ordersAwaitingCourier(this.dataSource.manager, tenantId, orders),
    );
    return {
      toComplete: toComplete.map((order) => this.toView(order)),
      needsDecision: needsDecision.map(({ order, issue }) => this.toView(order, issue)),
    };
  }

  async closeBusinessDay(tenantId: string, dto: BusinessDayCloseDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const currencyCode = dto.currencyCode || 'IRR';

      // Verify no open/closing shifts exist for this branch/date/currency
      const activeShifts = await em.find(CashierShift, {
        where: [
          { tenant_id: tenantId, branch_id: dto.branchId, business_date: dto.businessDate, currency_code: currencyCode, state: 'OPEN' },
          { tenant_id: tenantId, branch_id: dto.branchId, business_date: dto.businessDate, currency_code: currencyCode, state: 'CLOSING_REVIEW' },
        ],
      });

      if (activeShifts.length > 0) {
        throw new BadRequestException(
          `Cannot close business day ${dto.businessDate}: ${activeShifts.length} cashier shift(s) are still active`,
        );
      }

      // Check if business day already closed
      const existing = await em.findOne(BusinessDayClose, {
        where: {
          tenant_id: tenantId,
          branch_id: dto.branchId,
          business_date: dto.businessDate,
          currency_code: currencyCode,
          status: 'CLOSED',
        },
      });

      if (existing) {
        throw new ConflictException(`Business day ${dto.businessDate} is already closed`);
      }

      // Orders nobody closed off. Most kitchens never tap "handed over", so a paid order is
      // completed here; one still owing money or not yet finished needs a person to decide.
      const openOrders = await this.findOpenOrders(em, tenantId, dto.branchId, dto.businessDate, currencyCode);
      const { toComplete, needsDecision } = this.sortOpenOrders(
        openOrders,
        await this.ordersAwaitingCourier(em, tenantId, openOrders),
      );
      const carryOverReason = dto.carryOverReason?.trim() || null;

      if (needsDecision.length > 0 && !carryOverReason) {
        throw new ConflictException({
          code: 'OPEN_ORDERS_NEED_DECISION',
          message:
            `Cannot close business day ${dto.businessDate}: ${needsDecision.length} open order(s) are unpaid or unfinished. ` +
            'Settle, cancel or finish them, or carry them over with a reason.',
          context: { needsDecision: needsDecision.map(({ order, issue }) => this.toView(order, issue)) },
        });
      }

      for (const order of toComplete) {
        await this.completeAtDayClose(em, tenantId, order, dto.businessDate, userId, correlationId);
      }

      // Aggregate daily orders snapshot. Uses the same date expression and state
      // exclusions as the sales-summary report so the two cross-foot; matching on the
      // raw business_date column alone silently drops any order stamped before submit
      // began setting it.
      const orders = await em
        .createQueryBuilder(OrderHeader, 'o')
        .where('o.tenant_id = :tenantId', { tenantId })
        .andWhere('o.branch_id = :branchId', { branchId: dto.branchId })
        .andWhere(`${ORDER_BUSINESS_DATE_EXPR('o')} = :businessDate`, { businessDate: dto.businessDate })
        .andWhere(REVENUE_ORDER_PREDICATE('o'), { nonRevenueStates: NON_REVENUE_ORDER_STATES })
        .getMany();

      let totalSales = '0.0000';
      const orderCount = orders.length;
      for (const o of orders) {
        totalSales = MoneyUtil.add(totalSales, o.grand_total || '0', 4);
      }

      const dayClose = em.create(BusinessDayClose, {
        tenant_id: tenantId,
        branch_id: dto.branchId,
        business_date: dto.businessDate,
        currency_code: currencyCode,
        status: 'CLOSED',
        closed_by: userId || null,
        totals: {
          totalSales,
          orderCount,
          autoCompletedOrders: toComplete.length,
          carriedOverOrders: needsDecision.length,
          ...(needsDecision.length > 0 ? { carryOverReason } : {}),
        },
      });

      const savedClose = await em.save(BusinessDayClose, dayClose);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'BUSINESS_DAY_CLOSED',
        entityType: 'BusinessDayClose',
        entityId: savedClose.id,
        correlationId,
        afterData: savedClose,
        details: {
          autoCompletedOrderIds: toComplete.map((order) => order.id),
          carriedOverOrderIds: needsDecision.map(({ order }) => order.id),
          ...(needsDecision.length > 0 ? { carryOverReason } : {}),
        },
      });

      return savedClose;
    });
  }

  async reopenBusinessDay(tenantId: string, id: string, dto: BusinessDayReopenDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const dayClose = await em.findOne(BusinessDayClose, {
        where: { id, tenant_id: tenantId },
      });
      if (!dayClose) throw new NotFoundException(`Business day close ${id} not found`);

      if (dayClose.status !== 'CLOSED') {
        throw new BadRequestException(`Business day ${dayClose.business_date} is not closed`);
      }
      // The authority is the manager making the call (the route is manager-and-above); what
      // the record needs from them is why. It used to demand an approval id, which the
      // screen filled with a made-up string.
      if (!dto.reason || !dto.reason.trim()) {
        throw new BadRequestException('Reopening a closed business day requires a reason');
      }

      dayClose.status = 'REOPENED';
      dayClose.reopened_at = new Date();
      dayClose.reopened_by = userId || null;
      dayClose.approval_request_id = dto.approvalRequestId || null;

      const savedClose = await em.save(BusinessDayClose, dayClose);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'BUSINESS_DAY_REOPENED',
        entityType: 'BusinessDayClose',
        entityId: id,
        correlationId,
        details: { reason: dto.reason.trim(), businessDate: dayClose.business_date },
      });

      return savedClose;
    });
  }

  /**
   * Open orders of this branch dated on or before the day being closed. Earlier days count:
   * an order carried over, or left open before day closes looked, is still somebody's to
   * settle.
   */
  private async findOpenOrders(
    em: EntityManager,
    tenantId: string,
    branchId: string,
    businessDate: string,
    currencyCode: string,
  ): Promise<OrderHeader[]> {
    return await em
      .createQueryBuilder(OrderHeader, 'o')
      .where('o.tenant_id = :tenantId', { tenantId })
      .andWhere('o.branch_id = :branchId', { branchId })
      .andWhere('o.currency_code = :currencyCode', { currencyCode })
      .andWhere(`${ORDER_BUSINESS_DATE_EXPR('o')} <= :businessDate`, { businessDate })
      .andWhere('o.state IN (:...openStates)', { openStates: OPEN_ORDER_STATES })
      .andWhere('o.status NOT IN (:...finishedStates)', { finishedStates: FINISHED_ORDER_STATES })
      .orderBy('o.placed_at', 'ASC')
      .getMany();
  }

  /**
   * Open orders with a delivery still waiting for, or out with, a courier. Any kind of order can
   * have one: a Snappfood order our own couriers take, or one changed to a delivery after it was
   * sent. Completing it here would close the ride with nobody paid for it.
   */
  private async ordersAwaitingCourier(em: EntityManager, tenantId: string, orders: OrderHeader[]): Promise<Set<string>> {
    if (orders.length === 0) return new Set();
    const rows: Array<{ order_id: string }> = await em.query(
      `SELECT order_id FROM delivery
        WHERE tenant_id = $1 AND order_id = ANY($2::uuid[]) AND state NOT IN ('DELIVERED', 'CANCELLED')`,
      [tenantId, orders.map((o) => o.id)],
    );
    return new Set(rows.map((r) => r.order_id));
  }

  private sortOpenOrders(orders: OrderHeader[], awaitingCourier: Set<string> = new Set()) {
    const toComplete: OrderHeader[] = [];
    const needsDecision: { order: OrderHeader; issue: OpenOrderIssue }[] = [];

    for (const order of orders) {
      const issue = this.issueOf(order, awaitingCourier.has(order.id));
      if (issue) needsDecision.push({ order, issue });
      else toComplete.push(order);
    }
    return { toComplete, needsDecision };
  }

  private issueOf(order: OrderHeader, awaitingCourier = false): OpenOrderIssue | null {
    if (order.state === 'DRAFT') return 'NOT_SUBMITTED';
    if (order.state === 'PENDING_ACCEPTANCE') return 'AWAITING_ACCEPTANCE';
    if (MoneyUtil.greaterThan(order.outstanding_total || '0.0000', '0.0000')) return 'UNPAID';
    // A delivery is finished by its courier, whose cash and settlement hang off that step.
    if (order.order_type === 'DELIVERY' || order.state === 'OUT_FOR_DELIVERY' || awaitingCourier) return 'DELIVERY_NOT_FINISHED';
    if (!COMPLETABLE_AT_DAY_CLOSE.includes(order.state)) return 'DELIVERY_NOT_FINISHED';
    return null;
  }

  private async completeAtDayClose(
    em: EntityManager,
    tenantId: string,
    order: OrderHeader,
    businessDate: string,
    userId?: string,
    correlationId?: string,
  ) {
    const fromState = order.state;
    order.state = 'COMPLETED';
    order.status = 'COMPLETED';
    order.completed_at = new Date();
    await em.save(OrderHeader, order);

    // A dine-in check left open also left its table seated.
    if (order.table_id) {
      const sessions = await em.find(TableSession, {
        where: { tenant_id: tenantId, table_id: order.table_id, closed_at: IsNull() },
      });
      for (const session of sessions) {
        session.closed_at = new Date();
        session.status = 'AVAILABLE';
        await em.save(TableSession, session);
      }
    }

    await this.transitionRecorder.record(em, {
      tenantId,
      order,
      fromState,
      action: 'COMPLETE',
      userId,
      correlationId,
      reasonText: `Completed when business day ${businessDate} closed`,
    });
  }

  private toView(order: OrderHeader, issue?: OpenOrderIssue): DayCloseOpenOrder {
    return {
      id: order.id,
      orderNumber: order.order_number,
      orderType: order.order_type,
      channel: order.channel,
      state: order.state,
      businessDate: order.business_date || BusinessDateUtil.fromDate(order.placed_at),
      placedAt: order.placed_at,
      tableNumber: order.table_number || null,
      grandTotal: order.grand_total,
      outstandingTotal: order.outstanding_total,
      ...(issue ? { issue } : {}),
    };
  }
}
