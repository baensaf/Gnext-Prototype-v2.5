import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { BusinessDayClose } from '../../entities/BusinessDayClose.entity';
import { CashierShift } from '../../entities/CashierShift.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { BusinessDayCloseDto, BusinessDayReopenDto } from './dtos/shift.dto';

import { MoneyUtil } from '../../common/utils/money.util';
import {
  ORDER_BUSINESS_DATE_EXPR,
  NON_REVENUE_ORDER_STATES,
  REVENUE_ORDER_PREDICATE,
} from '../../common/utils/business-date.util';

@Injectable()
export class BusinessDayService {
  constructor(
    @InjectRepository(BusinessDayClose) private readonly dayCloseRepo: Repository<BusinessDayClose>,
    @InjectRepository(CashierShift) private readonly shiftRepo: Repository<CashierShift>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    private readonly auditWriter: AuditWriter,
    private readonly dataSource: DataSource,
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
}
