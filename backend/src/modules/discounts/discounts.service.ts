import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Discount } from '../../entities/Discount.entity';
import { Coupon } from '../../entities/Coupon.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class DiscountsService {
  constructor(
    @InjectRepository(Discount) private readonly discountRepo: Repository<Discount>,
    @InjectRepository(Coupon) private readonly couponRepo: Repository<Coupon>,
    private readonly auditWriter: AuditWriter,
  ) {}

  async getDiscounts(tenantId: string) {
    return await this.discountRepo.find({ where: { tenant_id: tenantId }, order: { code: 'ASC' } });
  }

  async getDiscountById(tenantId: string, id: string) {
    const discount = await this.discountRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!discount) throw new NotFoundException('Discount rule not found');
    return discount;
  }

  async createDiscount(
    tenantId: string,
    data: {
      code: string;
      name: string;
      kind?: string;
      calculation_type?: string;
      value: string;
      min_order_total?: string;
      max_discount_amount?: string;
      requires_reason?: boolean;
      requires_manager_approval?: boolean;
      applies_to_scope?: string;
    },
    correlationId: string,
  ) {
    const code = data.code.toUpperCase();
    const existing = await this.discountRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Discount code ${code} already exists`);

    const discount = this.discountRepo.create({
      tenant_id: tenantId,
      code,
      name: data.name,
      kind: data.kind || 'MANUAL',
      calculation_type: data.calculation_type || 'PERCENTAGE',
      value: MoneyUtil.format(data.value || '0'),
      min_order_total: MoneyUtil.format(data.min_order_total || '0'),
      max_discount_amount: data.max_discount_amount ? MoneyUtil.format(data.max_discount_amount) : null,
      requires_reason: data.requires_reason ?? false,
      requires_manager_approval: data.requires_manager_approval ?? false,
      applies_to_scope: data.applies_to_scope || 'ORDER',
      is_active: true,
    });

    const saved = await this.discountRepo.save(discount);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DISCOUNT_CREATED',
      entityType: 'Discount',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async updateDiscount(tenantId: string, id: string, data: Partial<Discount>, correlationId: string) {
    const discount = await this.getDiscountById(tenantId, id);
    const before = { ...discount };

    if (data.value !== undefined) data.value = MoneyUtil.format(data.value);
    if (data.min_order_total !== undefined) data.min_order_total = MoneyUtil.format(data.min_order_total);
    if (data.max_discount_amount !== undefined && data.max_discount_amount !== null) {
      data.max_discount_amount = MoneyUtil.format(data.max_discount_amount);
    }

    Object.assign(discount, data);
    const saved = await this.discountRepo.save(discount);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DISCOUNT_UPDATED',
      entityType: 'Discount',
      entityId: id,
      correlationId,
      beforeData: before,
      afterData: saved,
    });

    return saved;
  }

  async archiveDiscount(tenantId: string, id: string, correlationId: string) {
    const discount = await this.getDiscountById(tenantId, id);
    discount.is_active = false;
    await this.discountRepo.softRemove(discount);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DISCOUNT_ARCHIVED',
      entityType: 'Discount',
      entityId: id,
      correlationId,
    });

    return { success: true };
  }

  // Coupons
  async getCoupons(tenantId: string) {
    return await this.couponRepo.find({ where: { tenant_id: tenantId }, order: { code: 'ASC' } });
  }

  async createCoupon(
    tenantId: string,
    data: { discount_id: string; code: string; max_redemptions?: number; starts_at?: Date; expires_at?: Date },
    correlationId: string,
  ) {
    const code = data.code.toUpperCase();
    await this.getDiscountById(tenantId, data.discount_id);

    const existing = await this.couponRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Coupon code ${code} already exists`);

    const coupon = this.couponRepo.create({
      tenant_id: tenantId,
      discount_id: data.discount_id,
      code,
      max_redemptions: data.max_redemptions || null,
      current_redemptions: 0,
      starts_at: data.starts_at || null,
      expires_at: data.expires_at || null,
      is_active: true,
    });

    const saved = await this.couponRepo.save(coupon);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'COUPON_CREATED',
      entityType: 'Coupon',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async validateCoupon(tenantId: string, couponCode: string, orderTotal: string) {
    const code = couponCode.toUpperCase();
    const coupon = await this.couponRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (!coupon || !coupon.is_active) {
      throw new BadRequestException(`Coupon code ${code} is invalid or inactive`);
    }

    const now = new Date();
    if (coupon.starts_at && new Date(coupon.starts_at) > now) {
      throw new BadRequestException(`Coupon code ${code} is not active yet`);
    }
    if (coupon.expires_at && new Date(coupon.expires_at) < now) {
      throw new BadRequestException(`Coupon code ${code} has expired`);
    }

    if (coupon.max_redemptions !== null && coupon.current_redemptions >= coupon.max_redemptions) {
      throw new BadRequestException(`Coupon code ${code} has reached maximum redemptions`);
    }

    const discount = await this.discountRepo.findOne({ where: { id: coupon.discount_id, tenant_id: tenantId } });
    if (!discount || !discount.is_active) {
      throw new BadRequestException('Associated discount rule is no longer active');
    }

    const subtotal = MoneyUtil.format(orderTotal);
    if (MoneyUtil.lessThan(subtotal, discount.min_order_total)) {
      throw new BadRequestException(
        `Order subtotal must be at least ${Number(discount.min_order_total).toLocaleString()} IRR to apply coupon ${code}`,
      );
    }

    // Calculate discount amount
    let calculatedAmount = '0.0000';
    if (discount.calculation_type === 'PERCENTAGE') {
      calculatedAmount = MoneyUtil.multiply(subtotal, discount.value);
    } else {
      calculatedAmount = discount.value;
    }

    // Apply cap if specified
    if (discount.max_discount_amount && MoneyUtil.greaterThan(calculatedAmount, discount.max_discount_amount)) {
      calculatedAmount = discount.max_discount_amount;
    }

    // Ensure discount does not exceed order total
    if (MoneyUtil.greaterThan(calculatedAmount, subtotal)) {
      calculatedAmount = subtotal;
    }

    return {
      isValid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
      },
      discount: {
        id: discount.id,
        code: discount.code,
        name: discount.name,
        calculation_type: discount.calculation_type,
        value: discount.value,
        requires_reason: discount.requires_reason,
        requires_manager_approval: discount.requires_manager_approval,
      },
      calculatedAmount: MoneyUtil.format(calculatedAmount),
    };
  }
}
