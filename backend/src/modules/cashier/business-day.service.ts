import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { BusinessDayClose } from '../../entities/BusinessDayClose.entity';
import { CashierShift } from '../../entities/CashierShift.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { OrderTransitionRecorder } from '../order-lifecycle/order-transition-recorder.service';

import { MoneyUtil } from '../../common/utils/money.util';
import {
  ORDER_BUSINESS_DATE_EXPR,
  NON_REVENUE_ORDER_STATES,
  REVENUE_ORDER_PREDICATE,
} from '../../common/utils/business-date.util';
import { loadBusinessClock } from '../../common/utils/business-clock';
import {
  OPEN_ORDER_STATES,
  FINISHED_ORDER_STATES,
  ordersAwaitingCourier,
  openOrderIssue,
} from './open-orders';

export type { OpenOrderIssue, DayCloseOpenOrder } from './open-orders';

export interface DayCloseOptions {
  /** Leave open orders dated before this day alone (auto-close never reaches into old days). */
  ordersFrom?: string | null;
  /** The instant to judge "has this day happened" against (tests; auto-close passes its own). */
  now?: Date;
}

/**
 * The business day closes by itself (P-08): once a day has ended at the cutoff and every shift
 * on it is counted, auto-close completes the paid orders still open, carries the unpaid or
 * unfinished ones over, and keeps the day's totals. Nobody closes or reopens a day by hand,
 * as with Toast's nightly closeout; the date moves on at the cutoff whether or not it is closed.
 */
@Injectable()
export class BusinessDayService {
  constructor(
    @InjectRepository(BusinessDayClose) private readonly dayCloseRepo: Repository<BusinessDayClose>,
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

    qb.orderBy('d.business_date', 'DESC');
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '50', 10);
    qb.skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  /**
   * Which business day it is at a branch and when it turns over. The screens ask rather than
   * work it out, because the cutoff is the chain's and the time zone the branch's.
   */
  async getCurrentBusinessDay(tenantId: string, branchId?: string | null) {
    const clock = await loadBusinessClock(this.dataSource.manager, tenantId, branchId);
    return { branchId: branchId || null, ...clock.describe() };
  }

  /** Closes an ended business day at a branch. Called by auto-close once its shifts are counted. */
  async closeBusinessDay(tenantId: string, branchId: string, businessDate: string, options: DayCloseOptions = {}) {
    const clock = await loadBusinessClock(this.dataSource.manager, tenantId, branchId);
    if (businessDate >= clock.today(options.now)) {
      throw new BadRequestException(`Business day ${businessDate} has not ended yet and cannot be closed`);
    }
    return await this.dataSource.transaction(async (em) => {
      const activeShifts = await em.count(CashierShift, {
        where: { tenant_id: tenantId, branch_id: branchId, business_date: businessDate, state: 'OPEN' },
      });
      if (activeShifts > 0) {
        throw new BadRequestException(`Cannot close business day ${businessDate}: ${activeShifts} cashier shift(s) are still active`);
      }

      const existing = await em.findOne(BusinessDayClose, {
        where: { tenant_id: tenantId, branch_id: branchId, business_date: businessDate },
      });
      if (existing) throw new ConflictException(`Business day ${businessDate} is already closed`);

      // Orders nobody closed off. Most kitchens never tap "handed over", so a paid order is
      // completed here; one still owing money or not yet finished is carried over to the next
      // day, and the close says so.
      const openOrders = await this.findOpenOrders(em, tenantId, branchId, businessDate, options.ordersFrom);
      const awaitingCourier = await ordersAwaitingCourier(em, tenantId, openOrders);
      const toComplete = openOrders.filter((order) => !openOrderIssue(order, awaitingCourier.has(order.id)));
      const carriedOver = openOrders.filter((order) => !toComplete.includes(order));

      for (const order of toComplete) {
        await this.completeAtDayClose(em, tenantId, order, businessDate);
      }

      // The day's totals use the same date expression and state exclusions as the sales
      // report, so the two cross-foot.
      const orders = await em
        .createQueryBuilder(OrderHeader, 'o')
        .where('o.tenant_id = :tenantId', { tenantId })
        .andWhere('o.branch_id = :branchId', { branchId })
        .andWhere(`${ORDER_BUSINESS_DATE_EXPR('o')} = :businessDate`, { businessDate })
        .andWhere(REVENUE_ORDER_PREDICATE('o'), { nonRevenueStates: NON_REVENUE_ORDER_STATES })
        .getMany();
      const totalSales = orders.reduce((sum, o) => MoneyUtil.add(sum, o.grand_total || '0', 4), '0.0000');

      const savedClose = await em.save(
        BusinessDayClose,
        em.create(BusinessDayClose, {
          tenant_id: tenantId,
          branch_id: branchId,
          business_date: businessDate,
          totals: {
            totalSales,
            orderCount: orders.length,
            autoCompletedOrders: toComplete.length,
            carriedOverOrders: carriedOver.length,
          },
        }),
      );

      await this.auditWriter.write({
        tenantId,
        actorType: 'SYSTEM',
        action: 'BUSINESS_DAY_AUTO_CLOSED',
        entityType: 'BusinessDayClose',
        entityId: savedClose.id,
        correlationId: `auto-close:${branchId}:${businessDate}`,
        afterData: savedClose,
        details: {
          autoCompletedOrderIds: toComplete.map((order) => order.id),
          carriedOverOrderIds: carriedOver.map((order) => order.id),
        },
      });

      return savedClose;
    });
  }

  /**
   * Open orders of this branch dated on or before the day being closed. Earlier days count:
   * an order carried over is still somebody's to settle.
   */
  private async findOpenOrders(
    em: EntityManager,
    tenantId: string,
    branchId: string,
    businessDate: string,
    ordersFrom?: string | null,
  ): Promise<OrderHeader[]> {
    const qb = em
      .createQueryBuilder(OrderHeader, 'o')
      .where('o.tenant_id = :tenantId', { tenantId })
      .andWhere('o.branch_id = :branchId', { branchId })
      .andWhere(`${ORDER_BUSINESS_DATE_EXPR('o')} <= :businessDate`, { businessDate })
      .andWhere('o.state IN (:...openStates)', { openStates: OPEN_ORDER_STATES })
      .andWhere('o.status NOT IN (:...finishedStates)', { finishedStates: FINISHED_ORDER_STATES });
    if (ordersFrom) qb.andWhere(`${ORDER_BUSINESS_DATE_EXPR('o')} >= :ordersFrom`, { ordersFrom });
    return await qb.orderBy('o.placed_at', 'ASC').getMany();
  }

  private async completeAtDayClose(em: EntityManager, tenantId: string, order: OrderHeader, businessDate: string) {
    const fromState = order.state;
    order.state = 'COMPLETED';
    order.status = 'COMPLETED';
    order.completed_at = new Date();
    await em.save(OrderHeader, order);

    await this.transitionRecorder.record(em, {
      tenantId,
      order,
      fromState,
      action: 'COMPLETE',
      correlationId: `auto-close:${order.branch_id}:${businessDate}`,
      reasonText: `Completed when business day ${businessDate} closed`,
    });
  }
}
