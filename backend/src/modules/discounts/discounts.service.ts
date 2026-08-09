import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Discount } from '../../entities/Discount.entity';
import { DiscountCampaign } from '../../entities/DiscountCampaign.entity';
import { DiscountScope, ScopeType } from '../../entities/DiscountScope.entity';
import { Coupon } from '../../entities/Coupon.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { AuditWriter } from '../audit/audit-writer.service';
import { DiscountEvaluationService, DiscountQuoteResult } from './discount-evaluation.service';
import {
  CreateDiscountCampaignDto,
  UpdateDiscountCampaignDto,
  CreateDiscountScopeDto,
  CreateCouponDto,
  DiscountQuoteRequestDto,
} from './dtos/discounts.dto';

@Injectable()
export class DiscountsService {
  constructor(
    @InjectRepository(Discount) private readonly discountRepo: Repository<Discount>,
    @InjectRepository(DiscountCampaign) private readonly campaignRepo: Repository<DiscountCampaign>,
    @InjectRepository(DiscountScope) private readonly scopeRepo: Repository<DiscountScope>,
    @InjectRepository(Coupon) private readonly couponRepo: Repository<Coupon>,
    private readonly evaluationService: DiscountEvaluationService,
    private readonly auditWriter: AuditWriter,
  ) {}

  // Campaigns & Legacy Discounts
  async getDiscounts(tenantId: string) {
    const campaigns = await this.campaignRepo.find({
      where: { tenant_id: tenantId },
      relations: ['scopes'],
      order: { priority: 'ASC', code: 'ASC' },
    });
    if (campaigns.length > 0) {
      return campaigns;
    }
    return await this.discountRepo.find({ where: { tenant_id: tenantId }, order: { code: 'ASC' } });
  }

  async getDiscountById(tenantId: string, id: string) {
    const campaign = await this.campaignRepo.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['scopes'],
    });
    if (campaign) return campaign;

    const discount = await this.discountRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!discount) throw new NotFoundException('Discount campaign or rule not found');
    return discount;
  }

  async createDiscountCampaign(tenantId: string, dto: CreateDiscountCampaignDto, correlationId: string) {
    const code = dto.code.toUpperCase();
    const existing = await this.campaignRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Campaign code ${code} already exists`);

    const campaign = this.campaignRepo.create({
      tenant_id: tenantId,
      code,
      name: dto.name,
      discount_type: dto.discount_type,
      percentage: dto.percentage ? MoneyUtil.format(dto.percentage) : null,
      amount: dto.amount ? MoneyUtil.format(dto.amount) : null,
      currency_code: dto.currency_code || 'IRR',
      priority: dto.priority ?? 30,
      stacking_group: dto.stacking_group || 'DEFAULT',
      is_stackable: dto.is_stackable ?? true,
      coupon_required: dto.coupon_required ?? false,
      usage_limit_total: dto.usage_limit_total || null,
      usage_limit_per_customer: dto.usage_limit_per_customer || null,
      effective_from: dto.effective_from ? new Date(dto.effective_from) : null,
      effective_to: dto.effective_to ? new Date(dto.effective_to) : null,
      minimum_subtotal: dto.minimum_subtotal ? MoneyUtil.format(dto.minimum_subtotal) : null,
      maximum_discount_amount: dto.maximum_discount_amount ? MoneyUtil.format(dto.maximum_discount_amount) : null,
      reward_product_id: dto.reward_product_id || null,
      reward_quantity: dto.reward_quantity ? MoneyUtil.format(dto.reward_quantity) : null,
      funding_source: dto.funding_source || 'MERCHANT',
      is_active: dto.is_active ?? true,
    });

    const saved = await this.campaignRepo.save(campaign);

    // Also mirror to legacy Discount table for backward compatibility if needed
    const legacyDiscount = this.discountRepo.create({
      id: saved.id,
      tenant_id: tenantId,
      code: saved.code,
      name: saved.name,
      kind: saved.coupon_required ? 'COUPON' : 'AUTOMATIC_RULE',
      calculation_type: saved.discount_type === 'FIXED_AMOUNT' ? 'FIXED_AMOUNT' : 'PERCENTAGE',
      value: saved.amount || saved.percentage || '0.0000',
      min_order_total: saved.minimum_subtotal || '0.0000',
      max_discount_amount: saved.maximum_discount_amount,
      is_active: saved.is_active,
    });
    await this.discountRepo.save(legacyDiscount).catch(() => {});

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DISCOUNT_CAMPAIGN_CREATED',
      entityType: 'DiscountCampaign',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async updateDiscountCampaign(tenantId: string, id: string, dto: UpdateDiscountCampaignDto, correlationId: string) {
    const campaign = await this.campaignRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!campaign) throw new NotFoundException(`Campaign ${id} not found`);

    const before = { ...campaign };

    if (dto.name !== undefined) campaign.name = dto.name;
    if (dto.discount_type !== undefined) campaign.discount_type = dto.discount_type;
    if (dto.percentage !== undefined) campaign.percentage = dto.percentage ? MoneyUtil.format(dto.percentage) : null;
    if (dto.amount !== undefined) campaign.amount = dto.amount ? MoneyUtil.format(dto.amount) : null;
    if (dto.priority !== undefined) campaign.priority = dto.priority;
    if (dto.stacking_group !== undefined) campaign.stacking_group = dto.stacking_group;
    if (dto.is_stackable !== undefined) campaign.is_stackable = dto.is_stackable;
    if (dto.coupon_required !== undefined) campaign.coupon_required = dto.coupon_required;
    if (dto.usage_limit_total !== undefined) campaign.usage_limit_total = dto.usage_limit_total;
    if (dto.usage_limit_per_customer !== undefined) campaign.usage_limit_per_customer = dto.usage_limit_per_customer;
    if (dto.effective_from !== undefined) campaign.effective_from = dto.effective_from ? new Date(dto.effective_from) : null;
    if (dto.effective_to !== undefined) campaign.effective_to = dto.effective_to ? new Date(dto.effective_to) : null;
    if (dto.minimum_subtotal !== undefined) campaign.minimum_subtotal = dto.minimum_subtotal ? MoneyUtil.format(dto.minimum_subtotal) : null;
    if (dto.maximum_discount_amount !== undefined) campaign.maximum_discount_amount = dto.maximum_discount_amount ? MoneyUtil.format(dto.maximum_discount_amount) : null;
    if (dto.is_active !== undefined) campaign.is_active = dto.is_active;

    const saved = await this.campaignRepo.save(campaign);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DISCOUNT_CAMPAIGN_UPDATED',
      entityType: 'DiscountCampaign',
      entityId: id,
      correlationId,
      beforeData: before,
      afterData: saved,
    });

    return saved;
  }

  async archiveDiscountCampaign(tenantId: string, id: string, correlationId: string) {
    const campaign = await this.campaignRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (campaign) {
      campaign.is_active = false;
      await this.campaignRepo.softRemove(campaign);
    }

    const legacy = await this.discountRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (legacy) {
      legacy.is_active = false;
      await this.discountRepo.softRemove(legacy);
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DISCOUNT_CAMPAIGN_ARCHIVED',
      entityType: 'DiscountCampaign',
      entityId: id,
      correlationId,
    });

    return { success: true };
  }

  // Scopes
  async addScope(tenantId: string, campaignId: string, dto: CreateDiscountScopeDto, correlationId: string) {
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId, tenant_id: tenantId } });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const scope = this.scopeRepo.create({
      tenant_id: tenantId,
      campaign_id: campaignId,
      scope_type: dto.scope_type as ScopeType,
      scope_id: dto.scope_id || null,
      is_exclusion: dto.is_exclusion ?? false,
    });

    const saved = await this.scopeRepo.save(scope);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DISCOUNT_SCOPE_ADDED',
      entityType: 'DiscountScope',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async removeScope(tenantId: string, scopeId: string, correlationId: string) {
    const scope = await this.scopeRepo.findOne({ where: { id: scopeId, tenant_id: tenantId } });
    if (!scope) throw new NotFoundException('Scope not found');
    await this.scopeRepo.remove(scope);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DISCOUNT_SCOPE_REMOVED',
      entityType: 'DiscountScope',
      entityId: scopeId,
      correlationId,
    });

    return { success: true };
  }

  // Coupons
  async getCoupons(tenantId: string) {
    return await this.couponRepo.find({ where: { tenant_id: tenantId }, order: { code: 'ASC' } });
  }

  async createCoupon(tenantId: string, dto: CreateCouponDto, correlationId: string) {
    const code = dto.code.trim().toUpperCase();
    const cId = dto.campaign_id;

    const existing = await this.couponRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Coupon code ${code} already exists`);

    const coupon = this.couponRepo.create({
      tenant_id: tenantId,
      campaign_id: cId,
      discount_id: cId,
      code,
      max_uses: dto.max_uses || null,
      max_redemptions: dto.max_uses || null,
      uses_count: 0,
      current_redemptions: 0,
      effective_from: dto.effective_from ? new Date(dto.effective_from) : null,
      starts_at: dto.effective_from ? new Date(dto.effective_from) : null,
      effective_to: dto.effective_to ? new Date(dto.effective_to) : null,
      expires_at: dto.effective_to ? new Date(dto.effective_to) : null,
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
      coupon: { id: 'coupon-id', code: couponCode.trim().toUpperCase() },
      discount: {
        id: applied.campaignId || 'rule-id',
        code: applied.campaignCode || 'RULE',
        name: applied.campaignName,
        calculation_type: applied.discountType,
        value: applied.amount,
        requires_reason: false,
        requires_manager_approval: false,
      },
      calculatedAmount: applied.amount,
    };
  }

  async evaluateQuote(tenantId: string, request: DiscountQuoteRequestDto): Promise<DiscountQuoteResult> {
    return await this.evaluationService.evaluateQuote(tenantId, request);
  }
}
