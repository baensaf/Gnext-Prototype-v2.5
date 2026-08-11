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

    if (query.branch) qb.andWhere('d.branch_id = :branch', { branch: query.branch });
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

      // Aggregate daily orders snapshot
      const orders = await em.find(OrderHeader, {
        where: {
          tenant_id: tenantId,
          branch_id: dto.branchId,
          business_date: dto.businessDate,
        },
      });

      let totalSales = '0.0000';
      let orderCount = orders.length;
      for (const o of orders) {
        if (o.state !== 'CANCELLED') {
          totalSales = MoneyUtil.add(totalSales, o.grand_total || '0', 4);
        }
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

      if (!dto.approvalRequestId) {
        throw new BadRequestException('Reopening a closed business day requires an approvalRequestId');
      }

      dayClose.status = 'REOPENED';
      dayClose.reopened_at = new Date();
      dayClose.reopened_by = userId || null;
      dayClose.approval_request_id = dto.approvalRequestId;

      const savedClose = await em.save(BusinessDayClose, dayClose);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'BUSINESS_DAY_REOPENED',
        entityType: 'BusinessDayClose',
        entityId: id,
        correlationId,
      });

      return savedClose;
    });
  }
}
