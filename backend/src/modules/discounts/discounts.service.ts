import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Coupon } from '../../entities/Coupon.entity';
import { CustomerDiscount } from '../../entities/CustomerDiscount.entity';
import { Customer } from '../../entities/Customer.entity';
import { Product } from '../../entities/Product.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { BusinessDateUtil } from '../../common/utils/business-date.util';
import { AuditWriter } from '../audit/audit-writer.service';
import { DiscountEvaluationService, DiscountQuoteResult } from './discount-evaluation.service';
import {
  CreateCustomerDiscountDto,
  UpdateCustomerDiscountDto,
  CreateOneTimeCouponDto,
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
    @InjectRepository(Coupon) private readonly couponRepo: Repository<Coupon>,
    @InjectRepository(CustomerDiscount) private readonly customerDiscountRepo: Repository<CustomerDiscount>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    private readonly evaluationService: DiscountEvaluationService,
    private readonly auditWriter: AuditWriter,
  ) {}

  // Coupons
  async getCoupons(tenantId: string) {
    return await this.couponRepo.find({ where: { tenant_id: tenantId }, order: { code: 'ASC' } });
  }

  async validateCoupon(tenantId: string, couponCode: string, orderTotal: string) {
    const quoteResult = await this.evaluationService.evaluateQuote(tenantId, {
      orderDraft: {
        items: [
          {
            productId: 'temp-item',
            unitPrice: MoneyUtil.format(orderTotal),
            quantity: '1',
          },
        ],
      },
      couponCode,
    });

    const applied = quoteResult.consideredDiscounts.find((d) => d.status === 'APPLIED');
    if (!applied) {
      const rejected = quoteResult.consideredDiscounts.find((d) => d.status === 'REJECTED');
      throw new BadRequestException(
        rejected ? `Coupon rejected: ${rejected.rejectionReason || 'Invalid coupon'}` : 'Coupon is invalid or inactive',
      );
    }

    return {
      isValid: true,
      coupon: { id: applied.couponId, code: applied.couponCode ?? couponCode.trim().toUpperCase() },
      discount: {
        name: applied.name,
        calculation_type: applied.discountType,
        value: applied.amount,
      },
      calculatedAmount: applied.amount,
    };
  }

  async evaluateQuote(tenantId: string, request: DiscountQuoteRequestDto, callerRole?: string | null): Promise<DiscountQuoteResult> {
    return await this.evaluationService.evaluateQuote(tenantId, request, callerRole);
  }

  async getManualDiscountLimits(tenantId: string, callerRole?: string | null) {
    return await this.evaluationService.getManualDiscountLimits(tenantId, callerRole);
  }

  // Customer Discounts (Workflow 1)
  async getCustomerDiscounts(tenantId: string, customerId?: string) {
    const qb = this.customerDiscountRepo
      .createQueryBuilder('cd')
      .leftJoinAndSelect('cd.customer', 'customer')
      .where('cd.tenant_id = :tenantId', { tenantId });

    if (customerId) {
      qb.andWhere('cd.customer_id = :customerId', { customerId });
    }
    qb.orderBy('cd.created_at', 'DESC');
    return await qb.getMany();
  }

  async createCustomerDiscount(tenantId: string, dto: CreateCustomerDiscountDto, userId?: string, correlationId?: string) {
    const customer = await this.customerRepo.findOne({ where: { id: dto.customer_id, tenant_id: tenantId } });
    if (!customer) throw new NotFoundException(`Customer ${dto.customer_id} not found`);

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

    // Inactivate existing active discounts for this customer if creating new one
    await this.customerDiscountRepo.update(
      { tenant_id: tenantId, customer_id: dto.customer_id, is_active: true },
      { is_active: false },
    );

    const assignment = this.customerDiscountRepo.create({
      tenant_id: tenantId,
      customer_id: dto.customer_id,
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
      details: { customerId: dto.customer_id, percentage, createdBy: userId },
    });

    return saved;
  }

  async updateCustomerDiscount(tenantId: string, id: string, dto: UpdateCustomerDiscountDto, userId?: string, correlationId?: string) {
    const discount = await this.customerDiscountRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!discount) throw new NotFoundException(`Customer discount ${id} not found`);

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

  async revokeCustomerDiscount(tenantId: string, id: string, correlationId?: string) {
    const discount = await this.customerDiscountRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!discount) throw new NotFoundException(`Customer discount ${id} not found`);

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

  async setCouponActive(tenantId: string, id: string, isActive: boolean, correlationId?: string) {
    const coupon = await this.couponRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!coupon) throw new NotFoundException(`Coupon ${id} not found`);
    const before = { is_active: coupon.is_active };
    coupon.is_active = isActive;
    const saved = await this.couponRepo.save(coupon);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: isActive ? 'COUPON_ACTIVATED' : 'COUPON_DEACTIVATED',
      entityType: 'Coupon',
      entityId: id,
      correlationId: correlationId || 'system',
      beforeData: before,
      afterData: { is_active: isActive },
      details: { code: coupon.code },
    });

    return saved;
  }

  // One-Time Coupons (Workflow 4)
  async createOneTimeCoupon(tenantId: string, dto: CreateOneTimeCouponDto, correlationId?: string) {
    const code = dto.code.trim().toUpperCase();
    const existing = await this.couponRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Coupon code ${code} already exists`);

    const couponType = dto.coupon_type || 'PERCENTAGE';
    let percentage: string;
    if (couponType === 'FREE_ITEM') {
      if (!dto.reward_product_id) throw new BadRequestException('A free-item coupon names the product it gives free');
      for (const productId of [dto.reward_product_id, dto.buy_product_id].filter(Boolean) as string[]) {
        if (!(await this.productRepo.findOne({ where: { id: productId, tenant_id: tenantId } }))) {
          throw new BadRequestException(`Product ${productId} not found`);
        }
      }
      // The reward units are free: all of their price comes off.
      percentage = '100.00';
    } else {
      percentage = MoneyUtil.format(dto.percentage || '0');
      if (MoneyUtil.lessThanOrEqual(percentage, '0') || MoneyUtil.greaterThan(percentage, '100')) {
        throw new BadRequestException('Coupon percentage must be greater than 0 and less than or equal to 100');
      }
    }

    // The coupon holds its own terms. It used to be a pointer to a hidden campaign that held
    // them, which is why removing campaigns meant moving these columns here.
    const coupon = this.couponRepo.create({
      tenant_id: tenantId,
      code,
      coupon_type: couponType,
      percentage,
      buy_product_id: couponType === 'FREE_ITEM' ? dto.buy_product_id || null : null,
      buy_quantity: couponType === 'FREE_ITEM' ? dto.buy_quantity || 1 : 1,
      reward_product_id: couponType === 'FREE_ITEM' ? dto.reward_product_id! : null,
      reward_quantity: couponType === 'FREE_ITEM' ? dto.reward_quantity || 1 : 1,
      minimum_subtotal: dto.minimum_subtotal ? MoneyUtil.format(dto.minimum_subtotal) : null,
      maximum_discount_amount: dto.maximum_discount_amount ? MoneyUtil.format(dto.maximum_discount_amount) : null,
      max_uses: dto.max_uses && Number(dto.max_uses) >= 1 ? Math.floor(Number(dto.max_uses)) : 1,
      uses_count: 0,
      effective_from: dto.effective_from ? windowStart(dto.effective_from) : null,
      effective_to: dto.effective_to ? windowEnd(dto.effective_to) : null,
      is_active: true,
    });

    const saved = await this.couponRepo.save(coupon);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'ONE_TIME_COUPON_CREATED',
      entityType: 'Coupon',
      entityId: saved.id,
      correlationId: correlationId || 'system',
      afterData: saved,
      details: { code, percentage: dto.percentage },
    });

    return saved;
  }
}

