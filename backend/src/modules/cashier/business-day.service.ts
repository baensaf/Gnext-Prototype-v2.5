import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In, IsNull } from 'typeorm';
import { BusinessDayClose } from '../../entities/BusinessDayClose.entity';
import { CashierShift } from '../../entities/CashierShift.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { Payment } from '../../entities/Payment.entity';
import { Refund } from '../../entities/Refund.entity';
import { TableSession } from '../../entities/TableSession.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { OrderTransitionRecorder } from '../order-lifecycle/order-transition-recorder.service';
import { BusinessDayCloseDto, BusinessDayReopenDto } from './dtos/shift.dto';

import { MoneyUtil } from '../../common/utils/money.util';
import {
  ORDER_BUSINESS_DATE_EXPR,
  REFUND_BUSINESS_DATE_EXPR,
  NON_REVENUE_ORDER_STATES,
  REVENUE_ORDER_PREDICATE,
} from '../../common/utils/business-date.util';
import { loadBusinessClock } from '../../common/utils/business-clock';
import { addDays, isBusinessDate, toMinutes } from '../../common/utils/business-day';
import {
  OPEN_ORDER_STATES,
  FINISHED_ORDER_STATES,
  OpenOrderIssue,
  DayCloseOpenOrder,
  ordersAwaitingCourier,
  openOrderIssue,
  openOrderView,
} from './open-orders';

export type { OpenOrderIssue, DayCloseOpenOrder } from './open-orders';

/** How a close came about. A person closing a day decides about its open orders; auto-close does not. */
export interface DayCloseOptions {
  /** Closed by the system after the cutoff, once the day's shifts were counted. */
  automatic?: boolean;
  /** Leave open orders dated before this day alone (auto-close never reaches into old days). */
  ordersFrom?: string | null;
  /** The instant to judge "has this day happened" against (tests; auto-close passes its own). */
  now?: Date;
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
      await ordersAwaitingCourier(this.dataSource.manager, tenantId, orders),
    );
    return {
      toComplete: toComplete.map((order) => openOrderView(order)),
      needsDecision: needsDecision.map(({ order, issue }) => openOrderView(order, issue)),
    };
  }

  /**
   * Which business day it is at a branch and when it turns over. The screens ask rather than
   * work it out, because the cutoff, the hours and the time zone are the branch's.
   */
  async getCurrentBusinessDay(tenantId: string, branchId?: string | null) {
    const clock = await loadBusinessClock(this.dataSource.manager, tenantId, branchId);
    return { branchId: branchId || null, ...clock.describe() };
  }

  /**
   * What the branch's current rule would have dated differently, over a window of past days.
   * Read only: stored dates are what reports, closes and call numbers were built on, and they
   * stay as they are. This is how a manager sees what the overnight business day would have
   * moved (a sale at 01:30 that the midnight rule put on the next day) before deciding
   * whether anything needs correcting by hand.
   */
  async reviewStoredDates(tenantId: string, query: { branchId?: string; from?: string; to?: string }) {
    if (!query.branchId) throw new BadRequestException('branchId is required');
    const clock = await loadBusinessClock(this.dataSource.manager, tenantId, query.branchId);
    const today = clock.today();
    const to = isBusinessDate(query.to) ? query.to : addDays(today, -1);
    const from = isBusinessDate(query.from) ? query.from : addDays(to, -89);
    if (from > to) throw new BadRequestException('from must not be after to');

    const zone = clock.policy.timeZone;
    const cutoff = toMinutes(clock.policy.cutoff);
    const underRule = (ts: string) => `((${ts} AT TIME ZONE $3) - make_interval(mins => $4))::date::text`;
    const params = [tenantId, query.branchId, zone, cutoff, clock.startOf(from), clock.endOf(to)];
    const run = async (sql: string) => {
      const rows: any[] = await this.dataSource.query(`${sql} ORDER BY at ASC LIMIT 501`, params);
      return { count: rows.length > 500 ? '500+' : rows.length, rows: rows.slice(0, 500) };
    };

    const orders = await run(`
      SELECT o.id, o.order_number AS reference, o.placed_at AS at,
             ${ORDER_BUSINESS_DATE_EXPR('o')} AS stored_date, ${underRule('o.placed_at')} AS rule_date
        FROM order_header o
       WHERE o.tenant_id = $1 AND o.branch_id = $2 AND o.placed_at BETWEEN $5 AND $6
         AND ${ORDER_BUSINESS_DATE_EXPR('o')} <> ${underRule('o.placed_at')}`);
    const payments = await run(`
      SELECT p.id, p.payment_number AS reference, p.initiated_at AS at,
             p.business_date AS stored_date, ${underRule('p.initiated_at')} AS rule_date
        FROM payment p JOIN order_header o ON o.id = p.order_id
       WHERE p.tenant_id = $1 AND o.branch_id = $2 AND p.initiated_at BETWEEN $5 AND $6
         AND p.business_date <> ${underRule('p.initiated_at')}`);
    const refunds = await run(`
      SELECT r.id, r.refund_number AS reference, r.initiated_at AS at,
             ${REFUND_BUSINESS_DATE_EXPR('r')} AS stored_date, ${underRule('r.initiated_at')} AS rule_date
        FROM refund r JOIN order_header o ON o.id = r.order_id
       WHERE r.tenant_id = $1 AND o.branch_id = $2 AND r.initiated_at BETWEEN $5 AND $6
         AND ${REFUND_BUSINESS_DATE_EXPR('r')} <> ${underRule('r.initiated_at')}`);
    const shifts = await run(`
      SELECT s.id, s.shift_number AS reference, s.opened_at AS at,
             s.business_date AS stored_date, ${underRule('s.opened_at')} AS rule_date
        FROM cashier_shift s
       WHERE s.tenant_id = $1 AND s.branch_id = $2 AND s.opened_at BETWEEN $5 AND $6
         AND s.business_date <> ${underRule('s.opened_at')}`);

    return {
      branchId: query.branchId,
      from,
      to,
      rule: { cutoff: clock.policy.cutoff, timeZone: zone },
      changesStoredDates: false,
      orders,
      payments,
      refunds,
      shifts,
    };
  }

  /**
   * Moves what reviewStoredDates lists onto the business date the current rule gives it: an
   * order sold on the 22nd but stored on the 11th, because it was rung up on a shift left open
   * since then, goes to the 22nd. Only when a manager asks, with a reason, and every row moved
   * is audited with its old and new date. Orders, payments and refunds only: a shift's date is
   * the day its drawer was opened, and its count was made against it.
   *
   * Refused, moving nothing, when a row would leave or join a day the branch has closed (reopen
   * that day first), or when the window lists more rows than the review shows.
   */
  async applyDateCorrections(
    tenantId: string,
    dto: { branchId?: string; from?: string; to?: string; reason?: string },
    userId?: string,
    correlationId?: string,
  ) {
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('Correcting stored business dates requires a reason');
    const review = await this.reviewStoredDates(tenantId, dto);
    const sections = { orders: review.orders, payments: review.payments, refunds: review.refunds };
    for (const [kind, section] of Object.entries(sections)) {
      if (section.count === '500+') {
        throw new BadRequestException(`More than 500 ${kind} to correct; narrow the window with from and to`);
      }
    }

    const touched = new Set<string>();
    for (const section of Object.values(sections)) {
      for (const row of section.rows) touched.add(row.stored_date).add(row.rule_date);
    }
    if (touched.size) {
      const closed = await this.dayCloseRepo.find({
        where: { tenant_id: tenantId, branch_id: review.branchId, business_date: In([...touched]), status: 'CLOSED' },
      });
      if (closed.length) {
        throw new ConflictException({
          code: 'DAY_CLOSED',
          message: `Business day(s) ${closed.map((d) => d.business_date).sort().join(', ')} are closed. Reopen them before moving anything in or out.`,
        });
      }
    }

    const tables = { orders: OrderHeader, payments: Payment, refunds: Refund } as const;
    const moved = await this.dataSource.transaction(async (em) => {
      const counts = { orders: 0, payments: 0, refunds: 0 };
      for (const kind of Object.keys(tables) as (keyof typeof tables)[]) {
        for (const row of sections[kind].rows) {
          await em.update(tables[kind] as any, { id: row.id, tenant_id: tenantId }, { business_date: row.rule_date });
          counts[kind] += 1;
          await this.auditWriter.write({
            tenantId,
            actorType: userId ? 'ADMIN' : 'SYSTEM',
            actorId: userId,
            action: 'BUSINESS_DATE_CORRECTED',
            entityType: tables[kind].name,
            entityId: row.id,
            correlationId,
            beforeData: { business_date: row.stored_date },
            afterData: { business_date: row.rule_date },
            details: { reference: row.reference, at: row.at, reason, branchId: review.branchId, rule: review.rule },
          });
        }
      }
      return counts;
    });

    return { branchId: review.branchId, from: review.from, to: review.to, rule: review.rule, reason, moved };
  }

  /**
   * Closing a day is optional housekeeping, not a gate: the date moves on at the cutoff and a
   * new shift opens on the new day whether or not anyone has closed the last one. By default
   * the system closes a day itself once it has ended and its shifts are counted (auto-close).
   */
  async closeBusinessDay(
    tenantId: string,
    dto: BusinessDayCloseDto,
    userId?: string,
    correlationId?: string,
    options: DayCloseOptions = {},
  ) {
    // "not-a-date" went through as a date and was answered with 41 open orders; 2026-12-31
    // closed a day that had not happened yet, so nothing could be sold on it.
    const date = dto.businessDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      throw new BadRequestException('businessDate must be a date written YYYY-MM-DD');
    }
    const clock = await loadBusinessClock(this.dataSource.manager, tenantId, dto.branchId);
    if (date > clock.today(options.now)) {
      throw new BadRequestException(`Business day ${date} has not happened yet and cannot be closed`);
    }
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
      const openOrders = await this.findOpenOrders(em, tenantId, dto.branchId, dto.businessDate, currencyCode, options.ordersFrom);
      const { toComplete, needsDecision } = this.sortOpenOrders(
        openOrders,
        await ordersAwaitingCourier(em, tenantId, openOrders),
      );
      // Nobody is there to decide at 04:00: auto-close carries what is still owed or unfinished
      // over to the next day, and says so, rather than leaving the day open.
      const carryOverReason =
        dto.carryOverReason?.trim() ||
        (options.automatic
          ? `Carried over automatically when business day ${dto.businessDate} closed after its ${clock.policy.cutoff} cutoff`
          : null);

      if (needsDecision.length > 0 && !carryOverReason) {
        throw new ConflictException({
          code: 'OPEN_ORDERS_NEED_DECISION',
          message:
            `Cannot close business day ${dto.businessDate}: ${needsDecision.length} open order(s) are unpaid or unfinished. ` +
            'Settle, cancel or finish them, or carry them over with a reason.',
          context: { needsDecision: needsDecision.map(({ order, issue }) => openOrderView(order, issue)) },
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

      // A reopened day keeps its row; closing it again used to insert a second one and hit
      // the one-close-per-day unique key as a 500.
      const reopened = await em.findOne(BusinessDayClose, {
        where: { tenant_id: tenantId, branch_id: dto.branchId, business_date: dto.businessDate, currency_code: currencyCode },
      });
      const fields = {
        tenant_id: tenantId,
        branch_id: dto.branchId,
        business_date: dto.businessDate,
        currency_code: currencyCode,
        status: 'CLOSED' as const,
        closed_by: userId || null,
        totals: {
          totalSales,
          orderCount,
          autoCompletedOrders: toComplete.length,
          carriedOverOrders: needsDecision.length,
          ...(options.automatic ? { closedAutomatically: true } : {}),
          ...(needsDecision.length > 0 ? { carryOverReason } : {}),
        },
      };
      const dayClose = reopened
        ? Object.assign(reopened, fields, { closed_at: new Date() })
        : em.create(BusinessDayClose, fields);

      const savedClose = await em.save(BusinessDayClose, dayClose);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: options.automatic ? 'BUSINESS_DAY_AUTO_CLOSED' : 'BUSINESS_DAY_CLOSED',
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
    ordersFrom?: string | null,
  ): Promise<OrderHeader[]> {
    const qb = em
      .createQueryBuilder(OrderHeader, 'o')
      .where('o.tenant_id = :tenantId', { tenantId })
      .andWhere('o.branch_id = :branchId', { branchId })
      .andWhere('o.currency_code = :currencyCode', { currencyCode })
      .andWhere(`${ORDER_BUSINESS_DATE_EXPR('o')} <= :businessDate`, { businessDate })
      .andWhere('o.state IN (:...openStates)', { openStates: OPEN_ORDER_STATES })
      .andWhere('o.status NOT IN (:...finishedStates)', { finishedStates: FINISHED_ORDER_STATES });
    if (ordersFrom) qb.andWhere(`${ORDER_BUSINESS_DATE_EXPR('o')} >= :ordersFrom`, { ordersFrom });
    return await qb.orderBy('o.placed_at', 'ASC').getMany();
  }

  private sortOpenOrders(orders: OrderHeader[], awaitingCourier: Set<string> = new Set()) {
    const toComplete: OrderHeader[] = [];
    const needsDecision: { order: OrderHeader; issue: OpenOrderIssue }[] = [];

    for (const order of orders) {
      const issue = openOrderIssue(order, awaitingCourier.has(order.id));
      if (issue) needsDecision.push({ order, issue });
      else toComplete.push(order);
    }
    return { toComplete, needsDecision };
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
}
