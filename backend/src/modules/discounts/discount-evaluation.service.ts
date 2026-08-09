import { Injectable, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { DiscountCampaign } from '../../entities/DiscountCampaign.entity';
import { DiscountScope } from '../../entities/DiscountScope.entity';
import { Coupon } from '../../entities/Coupon.entity';
import { DiscountUsage } from '../../entities/DiscountUsage.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { DiscountQuoteRequestDto, QuoteItemDto, ManualDiscountDto } from './dtos/discounts.dto';

export interface ConsideredDiscount {
  campaignId?: string;
  campaignCode?: string;
  campaignName: string;
  discountType: string;
  status: 'APPLIED' | 'REJECTED';
  rejectionReason?: string;
  amount: string;
}

export interface QuotedLineItem {
  productId: string;
  variantId?: string;
  categoryId?: string;
  unitPrice: string;
  quantity: string;
  subtotal: string;
  discountTotal: string;
  grandTotal: string;
  isRewardItem?: boolean;
}

export interface DiscountQuoteResult {
  quoteVersion: string;
  currencyCode: string;
  items: QuotedLineItem[];
  subtotal: string;
  deliveryFee: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  consideredDiscounts: ConsideredDiscount[];
  warnings: string[];
  approvalRequired?: boolean;
  approvalReason?: string;
}

@Injectable()
export class DiscountEvaluationService {
  constructor(
    @InjectRepository(DiscountCampaign)
    private readonly campaignRepo: Repository<DiscountCampaign>,
    @InjectRepository(DiscountScope)
    private readonly scopeRepo: Repository<DiscountScope>,
    @InjectRepository(Coupon)
    private readonly couponRepo: Repository<Coupon>,
    @InjectRepository(DiscountUsage)
    private readonly usageRepo: Repository<DiscountUsage>,
    @InjectRepository(TenantSetting)
    private readonly settingRepo: Repository<TenantSetting>,
  ) {}

  async evaluateQuote(
    tenantId: string,
    request: DiscountQuoteRequestDto,
  ): Promise<DiscountQuoteResult> {
    const { orderDraft, manualDiscount, couponCode } = request;
    const currencyCode = orderDraft.currencyCode || 'IRR';
    const now = new Date();

    const consideredDiscounts: ConsideredDiscount[] = [];
    const warnings: string[] = [];

    // 1. Process items & subtotals
    const lineItems: QuotedLineItem[] = (orderDraft.items || []).map((item) => {
      const qty = item.quantity || '1';
      const uPrice = MoneyUtil.format(item.unitPrice || '0');
      const sub = MoneyUtil.multiply(uPrice, qty);
      return {
        productId: item.productId,
        variantId: item.variantId,
        categoryId: item.categoryId,
        unitPrice: uPrice,
        quantity: qty,
        subtotal: sub,
        discountTotal: '0.0000',
        grandTotal: sub,
      };
    });

    // Track remaining eligible basis per item line
    const remainingBases = (orderDraft.items || []).map((item, idx) => {
      if (item.neverDiscount) {
        return '0.0000';
      }
      return lineItems[idx].subtotal;
    });

    const isCampaignEligibleLine = (orderDraft.items || []).map((item) => {
      return !item.neverDiscount && !item.campaignExcluded && !item.ownNonStackableApplied;
    });

    // Calculate subtotal across non-reward items
    let subtotal = '0.0000';
    for (const line of lineItems) {
      subtotal = MoneyUtil.add(subtotal, line.subtotal);
    }

    let deliveryFee = MoneyUtil.format(orderDraft.deliveryFee || '0');
    let discountTotal = '0.0000';

    // 2. Coupon normalization and resolution
    let matchedCoupon: Coupon | null = null;
    let couponCampaign: DiscountCampaign | null = null;

    if (couponCode && couponCode.trim()) {
      const normalizedCode = couponCode.trim().toUpperCase();
      matchedCoupon = await this.couponRepo.findOne({
        where: { tenant_id: tenantId, code: normalizedCode },
      });

      if (!matchedCoupon || !matchedCoupon.is_active) {
        consideredDiscounts.push({
          campaignName: `Coupon (${normalizedCode})`,
          discountType: 'COUPON',
          status: 'REJECTED',
          rejectionReason: 'INVALID_OR_INACTIVE_COUPON',
          amount: '0.0000',
        });
        warnings.push(`Coupon code ${normalizedCode} is invalid or inactive`);
      } else {
        const startsAt = matchedCoupon.effective_from || matchedCoupon.starts_at;
        const expiresAt = matchedCoupon.effective_to || matchedCoupon.expires_at;
        const maxUses = matchedCoupon.max_uses ?? matchedCoupon.max_redemptions;
        const usesCount = matchedCoupon.uses_count ?? matchedCoupon.current_redemptions;

        if (startsAt && new Date(startsAt) > now) {
          consideredDiscounts.push({
            campaignName: `Coupon (${normalizedCode})`,
            discountType: 'COUPON',
            status: 'REJECTED',
            rejectionReason: 'COUPON_NOT_YET_ACTIVE',
            amount: '0.0000',
          });
          warnings.push(`Coupon code ${normalizedCode} is not active yet`);
          matchedCoupon = null;
        } else if (expiresAt && new Date(expiresAt) < now) {
          consideredDiscounts.push({
            campaignName: `Coupon (${normalizedCode})`,
            discountType: 'COUPON',
            status: 'REJECTED',
            rejectionReason: 'COUPON_EXPIRED',
            amount: '0.0000',
          });
          warnings.push(`Coupon code ${normalizedCode} has expired`);
          matchedCoupon = null;
        } else if (maxUses !== null && maxUses !== undefined && usesCount >= maxUses) {
          consideredDiscounts.push({
            campaignName: `Coupon (${normalizedCode})`,
            discountType: 'COUPON',
            status: 'REJECTED',
            rejectionReason: 'COUPON_MAX_USES_REACHED',
            amount: '0.0000',
          });
          warnings.push(`Coupon code ${normalizedCode} has reached maximum redemptions`);
          matchedCoupon = null;
        } else {
          const cId = matchedCoupon.campaign_id || matchedCoupon.discount_id;
          couponCampaign = await this.campaignRepo.findOne({
            where: { id: cId, tenant_id: tenantId },
            relations: ['scopes'],
          });
          if (!couponCampaign || !couponCampaign.is_active) {
            consideredDiscounts.push({
              campaignName: `Coupon (${normalizedCode})`,
              discountType: 'COUPON',
              status: 'REJECTED',
              rejectionReason: 'ASSOCIATED_CAMPAIGN_INACTIVE',
              amount: '0.0000',
            });
            matchedCoupon = null;
            couponCampaign = null;
          }
        }
      }
    }

    // 3. Fetch active campaigns
    const campaigns = await this.campaignRepo.find({
      where: { tenant_id: tenantId, is_active: true },
      relations: ['scopes'],
    });

    // 4. Candidate filtering & scope evaluation
    const evaluatedCandidates: {
      campaign: DiscountCampaign;
      isCoupon: boolean;
      priority: number;
      amount: string;
      lineAllocations: string[];
      rejectionReason?: string;
    }[] = [];

    for (const campaign of campaigns) {
      const isCouponMatch = matchedCoupon && couponCampaign && couponCampaign.id === campaign.id;

      if (campaign.coupon_required && !isCouponMatch) {
        consideredDiscounts.push({
          campaignId: campaign.id,
          campaignCode: campaign.code,
          campaignName: campaign.name,
          discountType: campaign.discount_type,
          status: 'REJECTED',
          rejectionReason: 'COUPON_REQUIRED',
          amount: '0.0000',
        });
        continue;
      }

      // Check effective dates
      if (campaign.effective_from && new Date(campaign.effective_from) > now) {
        consideredDiscounts.push({
          campaignId: campaign.id,
          campaignCode: campaign.code,
          campaignName: campaign.name,
          discountType: campaign.discount_type,
          status: 'REJECTED',
          rejectionReason: 'NOT_YET_EFFECTIVE',
          amount: '0.0000',
        });
        continue;
      }
      if (campaign.effective_to && new Date(campaign.effective_to) < now) {
        consideredDiscounts.push({
          campaignId: campaign.id,
          campaignCode: campaign.code,
          campaignName: campaign.name,
          discountType: campaign.discount_type,
          status: 'REJECTED',
          rejectionReason: 'CAMPAIGN_EXPIRED',
          amount: '0.0000',
        });
        continue;
      }

      // Usage limit total
      if (campaign.usage_limit_total !== null && campaign.usage_limit_total !== undefined) {
        if (campaign.usage_count >= campaign.usage_limit_total) {
          consideredDiscounts.push({
            campaignId: campaign.id,
            campaignCode: campaign.code,
            campaignName: campaign.name,
            discountType: campaign.discount_type,
            status: 'REJECTED',
            rejectionReason: 'TOTAL_USAGE_LIMIT_EXCEEDED',
            amount: '0.0000',
          });
          continue;
        }
      }

      // Customer usage limit
      if (
        orderDraft.customerId &&
        campaign.usage_limit_per_customer !== null &&
        campaign.usage_limit_per_customer !== undefined
      ) {
        const customerUsageCount = await this.usageRepo.count({
          where: { tenant_id: tenantId, campaign_id: campaign.id, customer_id: orderDraft.customerId },
        });
        if (customerUsageCount >= campaign.usage_limit_per_customer) {
          consideredDiscounts.push({
            campaignId: campaign.id,
            campaignCode: campaign.code,
            campaignName: campaign.name,
            discountType: campaign.discount_type,
            status: 'REJECTED',
            rejectionReason: 'CUSTOMER_USAGE_LIMIT_EXCEEDED',
            amount: '0.0000',
          });
          continue;
        }
      }

      // Minimum subtotal
      if (
        campaign.minimum_subtotal &&
        MoneyUtil.lessThan(subtotal, campaign.minimum_subtotal)
      ) {
        consideredDiscounts.push({
          campaignId: campaign.id,
          campaignCode: campaign.code,
          campaignName: campaign.name,
          discountType: campaign.discount_type,
          status: 'REJECTED',
          rejectionReason: 'BELOW_MINIMUM_SUBTOTAL',
          amount: '0.0000',
        });
        continue;
      }

      // Scope evaluation
      const scopes = campaign.scopes || [];
      let rejectedByExclusion = false;

      for (const scope of scopes) {
        if (scope.is_exclusion) {
          if (this.matchesScope(scope, orderDraft)) {
            rejectedByExclusion = true;
            break;
          }
        }
      }

      if (rejectedByExclusion) {
        consideredDiscounts.push({
          campaignId: campaign.id,
          campaignCode: campaign.code,
          campaignName: campaign.name,
          discountType: campaign.discount_type,
          status: 'REJECTED',
          rejectionReason: 'EXCLUDED_BY_SCOPE',
          amount: '0.0000',
        });
        continue;
      }

      // Positive scope matching for order-level scopes
      const positiveOrderScopes = scopes.filter(
        (s) => !s.is_exclusion && ['BRANCH', 'CUSTOMER', 'CUSTOMER_TAG', 'CUSTOMER_SEGMENT', 'CHANNEL', 'ORDER_TYPE'].includes(s.scope_type),
      );
      if (positiveOrderScopes.length > 0) {
        const matchesAny = positiveOrderScopes.some((s) => this.matchesScope(s, orderDraft));
        if (!matchesAny) {
          consideredDiscounts.push({
            campaignId: campaign.id,
            campaignCode: campaign.code,
            campaignName: campaign.name,
            discountType: campaign.discount_type,
            status: 'REJECTED',
            rejectionReason: 'SCOPE_MISMATCH',
            amount: '0.0000',
          });
          continue;
        }
      }

      // Assign priority: coupon 20 unless explicit priority set; automatic priority 30-999
      const effectivePriority = isCouponMatch ? (campaign.priority || 20) : (campaign.priority || 30);

      evaluatedCandidates.push({
        campaign,
        isCoupon: !!isCouponMatch,
        priority: effectivePriority,
        amount: '0.0000',
        lineAllocations: lineItems.map(() => '0.0000'),
      });
    }

    // Sort candidates by ascending priority, then campaign UUID
    evaluatedCandidates.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.campaign.id.localeCompare(b.campaign.id);
    });

    // 5. Apply candidate campaigns sequentially
    const appliedStackingGroups = new Set<string>();

    for (const candidate of evaluatedCandidates) {
      const campaign = candidate.campaign;
      const stackingGroup = campaign.stacking_group || 'DEFAULT';

      // Check stacking rules
      if (!campaign.is_stackable && appliedStackingGroups.has(stackingGroup)) {
        consideredDiscounts.push({
          campaignId: campaign.id,
          campaignCode: campaign.code,
          campaignName: campaign.name,
          discountType: campaign.discount_type,
          status: 'REJECTED',
          rejectionReason: 'NON_STACKABLE_CONFLICT',
          amount: '0.0000',
        });
        continue;
      }

      let campaignAmount = '0.0000';
      const lineAllocations: string[] = lineItems.map(() => '0.0000');

      if (campaign.discount_type === 'FREE_DELIVERY') {
        let freeDel = deliveryFee;
        if (campaign.maximum_discount_amount && MoneyUtil.greaterThan(freeDel, campaign.maximum_discount_amount)) {
          freeDel = campaign.maximum_discount_amount;
        }
        campaignAmount = freeDel;
        deliveryFee = MoneyUtil.subtract(deliveryFee, freeDel);
      } else if (campaign.discount_type === 'PERCENTAGE' && campaign.percentage) {
        const pctDecimal = MoneyUtil.divide(campaign.percentage, '100');

        for (let i = 0; i < lineItems.length; i++) {
          if (!isCampaignEligibleLine[i]) continue;
          const lineEligible = remainingBases[i];
          if (MoneyUtil.lessThanOrEqual(lineEligible, '0')) continue;

          let lineDisc = MoneyUtil.multiply(lineEligible, pctDecimal);

          // Apply line/campaign cap if specified
          if (campaign.maximum_discount_amount && MoneyUtil.greaterThan(lineDisc, campaign.maximum_discount_amount)) {
            lineDisc = campaign.maximum_discount_amount;
          }

          lineAllocations[i] = MoneyUtil.format(lineDisc);
          remainingBases[i] = MoneyUtil.subtract(remainingBases[i], lineAllocations[i]);
          campaignAmount = MoneyUtil.add(campaignAmount, lineAllocations[i]);
        }
      } else if (campaign.discount_type === 'FIXED_AMOUNT' && campaign.amount) {
        // Calculate sum of remaining eligible line bases
        let totalEligibleBasis = '0.0000';
        for (let i = 0; i < lineItems.length; i++) {
          if (isCampaignEligibleLine[i] && MoneyUtil.greaterThan(remainingBases[i], '0')) {
            totalEligibleBasis = MoneyUtil.add(totalEligibleBasis, remainingBases[i]);
          }
        }

        if (MoneyUtil.greaterThan(totalEligibleBasis, '0')) {
          let fixedToApply = MoneyUtil.format(campaign.amount);
          if (MoneyUtil.greaterThan(fixedToApply, totalEligibleBasis)) {
            fixedToApply = totalEligibleBasis;
          }
          if (campaign.maximum_discount_amount && MoneyUtil.greaterThan(fixedToApply, campaign.maximum_discount_amount)) {
            fixedToApply = campaign.maximum_discount_amount;
          }

          const eligibleIndices: number[] = [];
          const ratios: number[] = [];
          for (let i = 0; i < lineItems.length; i++) {
            if (isCampaignEligibleLine[i] && MoneyUtil.greaterThan(remainingBases[i], '0')) {
              eligibleIndices.push(i);
              ratios.push(Number(remainingBases[i]));
            }
          }

          if (eligibleIndices.length > 0) {
            const allocated = MoneyUtil.allocate(fixedToApply, ratios);
            for (let k = 0; k < eligibleIndices.length; k++) {
              const idx = eligibleIndices[k];
              lineAllocations[idx] = allocated[k];
            }
          }

          for (let i = 0; i < lineItems.length; i++) {
            remainingBases[i] = MoneyUtil.subtract(remainingBases[i], lineAllocations[i]);
          }

          campaignAmount = fixedToApply;
        }
      }

      if (MoneyUtil.greaterThan(campaignAmount, '0')) {
        discountTotal = MoneyUtil.add(discountTotal, campaignAmount);
        for (let i = 0; i < lineItems.length; i++) {
          lineItems[i].discountTotal = MoneyUtil.add(lineItems[i].discountTotal, lineAllocations[i]);
        }

        if (!campaign.is_stackable) {
          appliedStackingGroups.add(stackingGroup);
        }

        consideredDiscounts.push({
          campaignId: campaign.id,
          campaignCode: campaign.code,
          campaignName: campaign.name,
          discountType: campaign.discount_type,
          status: 'APPLIED',
          amount: campaignAmount,
        });
      } else {
        consideredDiscounts.push({
          campaignId: campaign.id,
          campaignCode: campaign.code,
          campaignName: campaign.name,
          discountType: campaign.discount_type,
          status: 'REJECTED',
          rejectionReason: 'NO_ELIGIBLE_ITEM_BASIS',
          amount: '0.0000',
        });
      }
    }

    // 6. Evaluate Manual Discount (Section 7.5)
    let approvalRequired = false;
    let approvalReason: string | undefined;

    if (manualDiscount && MoneyUtil.greaterThan(manualDiscount.value, '0')) {
      // Calculate eligible subtotal for manual discount (excluding neverDiscount: true)
      let manualEligibleSubtotal = '0.0000';
      for (let i = 0; i < lineItems.length; i++) {
        const rawItem = (orderDraft.items || [])[i];
        if (!rawItem?.neverDiscount) {
          manualEligibleSubtotal = MoneyUtil.add(manualEligibleSubtotal, remainingBases[i]);
        }
      }

      // Load tenant cashier limits from settings
      const settings = await this.settingRepo.find({ where: { tenant_id: tenantId } });
      const posSettings = settings.find((s) => s.key === 'POS')?.value || {};
      const discountSettings = settings.find((s) => s.key === 'DISCOUNTS')?.value || {};

      const cashierMaxPct = discountSettings.cashierMaxDiscountPercent ?? posSettings.max_discount_percentage ?? 20;
      const cashierMaxFixed = discountSettings.cashierMaxFixedDeduction ?? 1000000;

      let manualAmount = '0.0000';
      if (manualDiscount.calculation_type === 'PERCENTAGE') {
        const pct = Number(manualDiscount.value);
        if (pct > cashierMaxPct && !manualDiscount.approvalRequestId) {
          approvalRequired = true;
          approvalReason = `Manual discount ${pct}% exceeds cashier maximum of ${cashierMaxPct}%`;
        }
        const pctDec = MoneyUtil.divide(manualDiscount.value, '100');
        manualAmount = MoneyUtil.multiply(manualEligibleSubtotal, pctDec);
      } else {
        const fixedVal = MoneyUtil.format(manualDiscount.value);
        if (MoneyUtil.greaterThan(fixedVal, String(cashierMaxFixed)) && !manualDiscount.approvalRequestId) {
          approvalRequired = true;
          approvalReason = `Manual discount amount ${fixedVal} IRR exceeds cashier maximum of ${cashierMaxFixed} IRR`;
        }
        manualAmount = MoneyUtil.greaterThan(fixedVal, manualEligibleSubtotal)
          ? manualEligibleSubtotal
          : fixedVal;
      }

      if (MoneyUtil.greaterThan(manualAmount, '0')) {
        discountTotal = MoneyUtil.add(discountTotal, manualAmount);
        consideredDiscounts.push({
          campaignName: 'Manual Cashier Discount',
          discountType: manualDiscount.calculation_type,
          status: 'APPLIED',
          amount: manualAmount,
        });
      }
    }

    // 7. Calculate line grand totals and order grand total
    let grandTotal = '0.0000';
    for (const line of lineItems) {
      line.grandTotal = MoneyUtil.subtract(line.subtotal, line.discountTotal);
      if (MoneyUtil.lessThan(line.grandTotal, '0')) {
        line.grandTotal = '0.0000';
      }
      grandTotal = MoneyUtil.add(grandTotal, line.grandTotal);
    }
    grandTotal = MoneyUtil.add(grandTotal, deliveryFee);

    return {
      quoteVersion: MoneyUtil.format('1'),
      currencyCode,
      items: lineItems,
      subtotal,
      deliveryFee,
      discountTotal,
      taxTotal: '0.0000',
      grandTotal,
      consideredDiscounts,
      warnings,
      approvalRequired,
      approvalReason,
    };
  }

  private matchesScope(scope: DiscountScope, draft: DiscountQuoteRequestDto['orderDraft']): boolean {
    if (!scope.scope_id) return true;
    switch (scope.scope_type) {
      case 'BRANCH':
        return draft.branchId === scope.scope_id;
      case 'CUSTOMER':
        return draft.customerId === scope.scope_id;
      case 'CUSTOMER_TAG':
        return (draft.customerTagIds || []).includes(scope.scope_id);
      case 'CUSTOMER_SEGMENT':
        return (draft.customerSegmentIds || []).includes(scope.scope_id);
      case 'CHANNEL':
        return draft.channel === scope.scope_id;
      case 'ORDER_TYPE':
        return draft.orderType === scope.scope_id;
      case 'PRODUCT':
        return (draft.items || []).some((i) => i.productId === scope.scope_id);
      case 'CATEGORY':
        return (draft.items || []).some((i) => i.categoryId === scope.scope_id);
      default:
        return false;
    }
  }

  async consumeUsage(
    tenantId: string,
    orderId: string,
    customerId: string | undefined,
    appliedCampaignIds: string[],
    couponId: string | undefined,
    discountAmount: string,
    entityManager: EntityManager,
  ): Promise<void> {
    for (const cId of appliedCampaignIds) {
      // Lock campaign row using FOR UPDATE
      const campaign = await entityManager
        .createQueryBuilder(DiscountCampaign, 'c')
        .setLock('pessimistic_write')
        .where('c.id = :cId AND c.tenant_id = :tenantId', { cId, tenantId })
        .getOne();

      if (!campaign) continue;

      if (campaign.usage_limit_total !== null && campaign.usage_count >= campaign.usage_limit_total) {
        throw new ConflictException(`Discount campaign ${campaign.code} usage limit reached during submission`);
      }

      campaign.usage_count += 1;
      await entityManager.save(campaign);

      // Lock coupon if used
      if (couponId) {
        const coupon = await entityManager
          .createQueryBuilder(Coupon, 'cp')
          .setLock('pessimistic_write')
          .where('cp.id = :couponId AND cp.tenant_id = :tenantId', { couponId, tenantId })
          .getOne();

        if (coupon) {
          const maxUses = coupon.max_uses ?? coupon.max_redemptions;
          const currentUses = coupon.uses_count ?? coupon.current_redemptions;
          if (maxUses !== null && maxUses !== undefined && currentUses >= maxUses) {
            throw new ConflictException(`Coupon ${coupon.code} max redemptions reached during submission`);
          }
          coupon.uses_count = currentUses + 1;
          coupon.current_redemptions = coupon.uses_count;
          await entityManager.save(coupon);
        }
      }

      // Record discount usage
      const usage = entityManager.create(DiscountUsage, {
        tenant_id: tenantId,
        campaign_id: cId,
        coupon_id: couponId || null,
        customer_id: customerId || null,
        order_id: orderId,
        amount: MoneyUtil.format(discountAmount),
        currency_code: 'IRR',
        used_at: new Date(),
      });
      await entityManager.save(usage);
    }
  }
}
