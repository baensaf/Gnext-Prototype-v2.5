import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerDiscount } from '../../entities/CustomerDiscount.entity';
import { Customer } from '../../entities/Customer.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { BusinessDateUtil } from '../../common/utils/business-date.util';
import { AuditWriter } from '../audit/audit-writer.service';
import { DiscountEvaluationService, DiscountQuoteResult } from './discount-evaluation.service';
import {
  CreateCustomerDiscountDto,
  UpdateCustomerDiscountDto,
  DiscountQuoteRequestDto,
} from './dtos/discounts.dto';

/**
 * A bare YYYY-MM-DD is a whole business day, from its first moment to its last on Tehran's
 * clock. Read as UTC midnight, a window opened at 03:30 and lost its last day.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const windowStart = (v: string): Date => (DATE_ONLY.test(v) ? BusinessDateUtil.startOfDay(v) : new Date(v));
const windowEnd = (v: string): Date => (DATE_ONLY.test(v) ? BusinessDateUtil.endOfDay(v) : new Date(v));

@Injectable()
export class DiscountsService {
  constructor(
    @InjectRepository(CustomerDiscount) private readonly customerDiscountRepo: Repository<CustomerDiscount>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    private readonly evaluationService: DiscountEvaluationService,
    private readonly auditWriter: AuditWriter,
  ) {}

  async evaluateQuote(tenantId: string, request: DiscountQuoteRequestDto, callerRole?: string | null): Promise<DiscountQuoteResult> {
    return await this.evaluationService.evaluateQuote(tenantId, request, callerRole);
  }

  async getManualDiscountLimits(tenantId: string, callerRole?: string | null) {
    return await this.evaluationService.getManualDiscountLimits(tenantId, callerRole);
  }

  // Friends-and-family rates. A branch account sees and sets only its own branch's people.
  async getCustomerDiscounts(tenantId: string, customerId?: string, branchId?: string | null) {
    const qb = this.customerDiscountRepo
      .createQueryBuilder('cd')
      .leftJoinAndSelect('cd.customer', 'customer')
      .where('cd.tenant_id = :tenantId', { tenantId });

    if (customerId) {
      qb.andWhere('cd.customer_id = :customerId', { customerId });
    }
    if (branchId) {
      qb.andWhere('cd.branch_id = :branchId', { branchId });
    }
    qb.orderBy('cd.created_at', 'DESC');
    return await qb.getMany();
  }

  /**
   * Sets one person's friends-and-family percent at one branch, or takes it away (no percent).
   * What the customer list's dialog calls; a branch account's branch wins over the one sent.
   */
  async setFamilyDiscount(
    tenantId: string,
    dto: { customer_id: string; branch_id?: string; percent?: string | null; note?: string | null },
    ownBranchId: string | null,
    userId?: string,
    correlationId?: string,
  ) {
    const branchId = ownBranchId || dto.branch_id;
    if (!branchId) throw new BadRequestException('A friends-and-family discount belongs to a branch');
    const current = await this.customerDiscountRepo.findOne({
      where: { tenant_id: tenantId, customer_id: dto.customer_id, branch_id: branchId, is_active: true },
    });
    if (!dto.percent || !MoneyUtil.greaterThan(dto.percent, '0')) {
      if (current) await this.revokeCustomerDiscount(tenantId, current.id, correlationId, ownBranchId);
      return null;
    }
    if (current) {
      return await this.updateCustomerDiscount(
        tenantId,
        current.id,
        { discount_percentage: dto.percent, note: dto.note ?? current.note } as UpdateCustomerDiscountDto,
        userId,
        correlationId,
        ownBranchId,
      );
    }
    return await this.createCustomerDiscount(
      tenantId,
      { customer_id: dto.customer_id, branch_id: branchId, discount_percentage: dto.percent, note: dto.note || undefined } as CreateCustomerDiscountDto,
      userId,
      correlationId,
      ownBranchId,
    );
  }

  async createCustomerDiscount(
    tenantId: string,
    dto: CreateCustomerDiscountDto,
    userId?: string,
    correlationId?: string,
    ownBranchId?: string | null,
  ) {
    const customer = await this.customerRepo.findOne({ where: { id: dto.customer_id, tenant_id: tenantId } });
    if (!customer) throw new NotFoundException(`Customer ${dto.customer_id} not found`);
    const branchId = ownBranchId || dto.branch_id;
    if (!branchId) throw new BadRequestException('A friends-and-family discount belongs to a branch');

    const percentage = MoneyUtil.format(dto.discount_percentage);
    if (MoneyUtil.lessThanOrEqual(percentage, '0') || MoneyUtil.greaterThan(percentage, '100')) {
      throw new BadRequestException('Discount percentage must be greater than 0 and less than or equal to 100');
    }

    if (dto.effective_from && dto.effective_to) {
      const from = new Date(dto.effective_from);
      const to = new Date(dto.effective_to);
      if (from > to) {
        throw new BadRequestException('effective_from cannot be after effective_to');
      }
    }

    // One rate per person per branch: a new one replaces the old.
    await this.customerDiscountRepo.update(
      { tenant_id: tenantId, customer_id: dto.customer_id, branch_id: branchId, is_active: true },
      { is_active: false },
    );

    const assignment = this.customerDiscountRepo.create({
      tenant_id: tenantId,
      customer_id: dto.customer_id,
      branch_id: branchId,
      discount_percentage: percentage,
      effective_from: dto.effective_from ? windowStart(dto.effective_from) : null,
      effective_to: dto.effective_to ? windowEnd(dto.effective_to) : null,
      note: dto.note || null,
      is_active: dto.is_active ?? true,
      created_by: userId || null,
      updated_by: userId || null,
    });

    const saved = await this.customerDiscountRepo.save(assignment);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'CUSTOMER_DISCOUNT_ASSIGNED',
      entityType: 'CustomerDiscount',
      entityId: saved.id,
      correlationId: correlationId || 'system',
      afterData: saved,
      details: { customerId: dto.customer_id, branchId, percentage, createdBy: userId },
    });

    return saved;
  }

  async updateCustomerDiscount(
    tenantId: string,
    id: string,
    dto: UpdateCustomerDiscountDto,
    userId?: string,
    correlationId?: string,
    ownBranchId?: string | null,
  ) {
    const discount = await this.customerDiscountRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!discount) throw new NotFoundException(`Customer discount ${id} not found`);
    this.assertOwnBranch(discount, ownBranchId);

    const before = { ...discount };

    if (dto.discount_percentage !== undefined) {
      const percentage = MoneyUtil.format(dto.discount_percentage);
      if (MoneyUtil.lessThanOrEqual(percentage, '0') || MoneyUtil.greaterThan(percentage, '100')) {
        throw new BadRequestException('Discount percentage must be greater than 0 and less than or equal to 100');
      }
      discount.discount_percentage = percentage;
    }
    if (dto.effective_from !== undefined) {
      discount.effective_from = dto.effective_from ? windowStart(dto.effective_from) : null;
    }
    if (dto.effective_to !== undefined) {
      discount.effective_to = dto.effective_to ? windowEnd(dto.effective_to) : null;
    }

    if (discount.effective_from && discount.effective_to && discount.effective_from > discount.effective_to) {
      throw new BadRequestException('effective_from cannot be after effective_to');
    }

    if (dto.note !== undefined) {
      discount.note = dto.note;
    }
    if (dto.is_active !== undefined) {
      discount.is_active = dto.is_active;
    }

    discount.updated_by = userId || null;

    const saved = await this.customerDiscountRepo.save(discount);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'CUSTOMER_DISCOUNT_UPDATED',
      entityType: 'CustomerDiscount',
      entityId: saved.id,
      correlationId: correlationId || 'system',
      beforeData: before,
      afterData: saved,
      details: { id, percentage: saved.discount_percentage, updatedBy: userId },
    });

    return saved;
  }

  async revokeCustomerDiscount(tenantId: string, id: string, correlationId?: string, ownBranchId?: string | null) {
    const discount = await this.customerDiscountRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!discount) throw new NotFoundException(`Customer discount ${id} not found`);
    this.assertOwnBranch(discount, ownBranchId);

    discount.is_active = false;
    await this.customerDiscountRepo.save(discount);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'CUSTOMER_DISCOUNT_REVOKED',
      entityType: 'CustomerDiscount',
      entityId: id,
      correlationId: correlationId || 'system',
    });

    return { success: true };
  }

  private assertOwnBranch(discount: CustomerDiscount, ownBranchId?: string | null) {
    if (ownBranchId && discount.branch_id !== ownBranchId) {
      throw new ForbiddenException('This friends-and-family discount belongs to another branch');
    }
  }
}
