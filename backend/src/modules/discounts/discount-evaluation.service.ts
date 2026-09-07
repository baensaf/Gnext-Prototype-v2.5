import { Injectable, BadRequestException, ForbiddenException, ConflictException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, In } from 'typeorm';
import { DiscountCampaign } from '../../entities/DiscountCampaign.entity';
import { DiscountScope } from '../../entities/DiscountScope.entity';
import { Coupon } from '../../entities/Coupon.entity';
import { DiscountUsage } from '../../entities/DiscountUsage.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { CustomerDiscount } from '../../entities/CustomerDiscount.entity';
import { ApprovalRequest } from '../../entities/ApprovalRequest.entity';
import { Product } from '../../entities/Product.entity';
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
    @InjectRepository(CustomerDiscount)
    private readonly customerDiscountRepo: Repository<CustomerDiscount>,
    @InjectRepository(ApprovalRequest)
    private readonly approvalRequestRepo?: Repository<ApprovalRequest>,
    @Optional()
    @InjectRepository(Product)
    private readonly productRepo?: Repository<Product>,
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

    const requestedItems = orderDraft.items || [];
    const productIds = [...new Set(requestedItems.map((item) => item.productId).filter(Boolean))];
    const products = this.productRepo && productIds.length > 0
      ? await this.productRepo.find({ where: { tenant_id: tenantId, id: In(productIds) } })
      : [];
    const productTaxRates = new Map(products.map((product) => [product.id, product.tax_rate || '0.0000']));

    // 1. Process items & subtotals
    const lineItems: QuotedLineItem[] = requestedItems.map((item) => {
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
    let approvalRequired = false;
    let approvalReason: string | undefined;
    let singleDiscountApplied = false;

    // Load discount authorization policy settings
    const settings = await this.settingRepo.find({ where: { tenant_id: tenantId } });
    const authSettings = settings.find((s) => s.key === 'DISCOUNT_AUTHORIZATIONS' || s.key === 'DISCOUNTS')?.value || {};
    const userRole = (request as any).userRole || 'CASHIER';

    const defaultRoleLimits: Record<string, { pct: string; maxFixed: string }> = {
      CASHIER: { pct: String(authSettings.cashierMaxPct ?? 10), maxFixed: String(authSettings.cashierMaxFixed ?? 50000) },
      SUPERVISOR: { pct: String(authSettings.supervisorMaxPct ?? 20), maxFixed: String(authSettings.supervisorMaxFixed ?? 150000) },
      MANAGER: { pct: String(authSettings.managerMaxPct ?? 30), maxFixed: String(authSettings.managerMaxFixed ?? 300000) },
      ADMIN: { pct: String(authSettings.adminMaxPct ?? 100), maxFixed: String(authSettings.adminMaxFixed ?? 10000000) },
    };

    const currentLimit = defaultRoleLimits[userRole.toUpperCase()] || defaultRoleLimits.CASHIER;
    const policyMaxPct = defaultRoleLimits.MANAGER.pct;
    const policyMaxFixed = defaultRoleLimits.MANAGER.maxFixed;

    // A. Workflow 3: Manual Cashier Discount Evaluation (Highest Precedence)
    if (manualDiscount && MoneyUtil.greaterThan(manualDiscount.value, '0')) {
      let manualEligibleSubtotal = '0.0000';
      for (let i = 0; i < lineItems.length; i++) {
        const rawItem = (orderDraft.items || [])[i];
        if (!rawItem?.neverDiscount) {
          manualEligibleSubtotal = MoneyUtil.add(manualEligibleSubtotal, remainingBases[i]);
        }
      }

      let manualAmount = '0.0000';
      if (manualDiscount.calculation_type === 'PERCENTAGE') {
        const pctVal = MoneyUtil.format(manualDiscount.value);
        if (MoneyUtil.greaterThan(pctVal, policyMaxPct)) {
          consideredDiscounts.push({
            campaignName: 'Manual Discount',
            discountType: 'PERCENTAGE',
            status: 'REJECTED',
            rejectionReason: `Exceeds maximum permitted policy limit of ${policyMaxPct}%`,
            amount: '0.0000',
          });
          warnings.push(`Manual discount ${pctVal}% exceeds maximum policy threshold of ${policyMaxPct}%`);
        } else {
          let isValidApproval = true;
          if (MoneyUtil.greaterThan(pctVal, currentLimit.pct)) {
            if (!manualDiscount.approvalRequestId) {
              approvalRequired = true;
              approvalReason = `Manual discount ${pctVal}% exceeds ${userRole} limit of ${currentLimit.pct}%. Manager approval required.`;
              isValidApproval = false;
            } else if (this.approvalRequestRepo) {
              const appReq = await this.approvalRequestRepo.findOne({
                where: { id: manualDiscount.approvalRequestId, tenant_id: tenantId },
              });
              if (!appReq || appReq.status !== 'APPROVED' || (appReq.expires_at && new Date(appReq.expires_at) < now)) {
                isValidApproval = false;
                consideredDiscounts.push({
                  campaignName: 'Manual Discount',
                  discountType: 'PERCENTAGE',
                  status: 'REJECTED',
                  rejectionReason: `Invalid or unapproved escalation approval request ${manualDiscount.approvalRequestId}`,
                  amount: '0.0000',
                });
                warnings.push(`Approval request ${manualDiscount.approvalRequestId} is invalid or not approved`);
              }
            }
          }
          if (isValidApproval) {
            const pctDec = MoneyUtil.divide(manualDiscount.value, '100', 6);
            manualAmount = MoneyUtil.multiply(manualEligibleSubtotal, pctDec);
          }
        }
      } else {
        const fixedVal = MoneyUtil.format(manualDiscount.value);
        if (MoneyUtil.greaterThan(fixedVal, policyMaxFixed)) {
          consideredDiscounts.push({
            campaignName: 'Manual Discount',
            discountType: 'FIXED_AMOUNT',
            status: 'REJECTED',
            rejectionReason: `Exceeds maximum permitted policy fixed limit of ${policyMaxFixed}`,
            amount: '0.0000',
          });
          warnings.push(`Manual discount amount ${fixedVal} exceeds maximum policy threshold`);
        } else {
          let isValidApproval = true;
          if (MoneyUtil.greaterThan(fixedVal, currentLimit.maxFixed)) {
            if (!manualDiscount.approvalRequestId) {
              approvalRequired = true;
              approvalReason = `Manual discount amount exceeds ${userRole} fixed limit of ${currentLimit.maxFixed}. Manager approval required.`;
              isValidApproval = false;
            } else if (this.approvalRequestRepo) {
              const appReq = await this.approvalRequestRepo.findOne({
                where: { id: manualDiscount.approvalRequestId, tenant_id: tenantId },
              });
              if (!appReq || appReq.status !== 'APPROVED' || (appReq.expires_at && new Date(appReq.expires_at) < now)) {
                isValidApproval = false;
                consideredDiscounts.push({
                  campaignName: 'Manual Discount',
                  discountType: 'FIXED_AMOUNT',
                  status: 'REJECTED',
                  rejectionReason: `Invalid or unapproved escalation approval request ${manualDiscount.approvalRequestId}`,
                  amount: '0.0000',
                });
                warnings.push(`Approval request ${manualDiscount.approvalRequestId} is invalid or not approved`);
              }
            }
          }
          if (isValidApproval) {
            manualAmount = MoneyUtil.greaterThan(fixedVal, manualEligibleSubtotal) ? manualEligibleSubtotal : fixedVal;
          }
        }
      }

      if (MoneyUtil.greaterThan(manualAmount, '0')) {
        discountTotal = MoneyUtil.add(discountTotal, manualAmount);
        consideredDiscounts.push({
          campaignName: 'Manual Cashier Discount',
          discountType: manualDiscount.calculation_type,
          status: 'APPLIED',
          amount: manualAmount,
        });
        singleDiscountApplied = true;
      }
    }

    // B. Workflow 4: One-Time Percentage Coupon Code (Second Precedence)
    let matchedCoupon: Coupon | null = null;
    let couponCampaign: DiscountCampaign | null = null;

    if (!singleDiscountApplied && couponCode && couponCode.trim()) {
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
        const maxUses = matchedCoupon.max_uses ?? matchedCoupon.max_redemptions ?? 1;
        const usesCount = matchedCoupon.uses_count ?? matchedCoupon.current_redemptions ?? 0;

        if (startsAt && new Date(startsAt) > now) {
          consideredDiscounts.push({
            campaignName: `Coupon (${normalizedCode})`,
            discountType: 'COUPON',
            status: 'REJECTED',
            rejectionReason: 'COUPON_NOT_YET_ACTIVE',
            amount: '0.0000',
          });
          warnings.push(`Coupon code ${normalizedCode} is not active yet`);
        } else if (expiresAt && new Date(expiresAt) < now) {
          consideredDiscounts.push({
            campaignName: `Coupon (${normalizedCode})`,
            discountType: 'COUPON',
            status: 'REJECTED',
            rejectionReason: 'COUPON_EXPIRED',
            amount: '0.0000',
          });
          warnings.push(`Coupon code ${normalizedCode} has expired`);
        } else if (usesCount >= maxUses) {
          consideredDiscounts.push({
            campaignName: `Coupon (${normalizedCode})`,
            discountType: 'COUPON',
            status: 'REJECTED',
            rejectionReason: 'COUPON_MAX_USES_REACHED',
            amount: '0.0000',
          });
          warnings.push(`Coupon code ${normalizedCode} has reached maximum usage limit`);
        } else {
          // Check per customer redemption
          if (orderDraft.customerId) {
            const customerUses = await this.usageRepo.count({
              where: { tenant_id: tenantId, coupon_id: matchedCoupon.id, customer_id: orderDraft.customerId },
            });
            if (customerUses >= 1) {
              consideredDiscounts.push({
                campaignName: `Coupon (${normalizedCode})`,
                discountType: 'COUPON',
                status: 'REJECTED',
                rejectionReason: 'COUPON_ALREADY_REDEEMED_BY_CUSTOMER',
                amount: '0.0000',
              });
              warnings.push(`Coupon ${normalizedCode} already used by this customer`);
              matchedCoupon = null;
            }
          }

          if (matchedCoupon) {
            const cId = matchedCoupon.campaign_id || matchedCoupon.discount_id;
            if (cId) {
              couponCampaign = await this.campaignRepo.findOne({
                where: { id: cId, tenant_id: tenantId },
                relations: ['scopes'],
              });
            }
          }
        }
      }
    }

    // C. Workflow 1: Customer-Specific Discount (Third Precedence)
    if (!singleDiscountApplied && orderDraft.customerId) {
      const customerDiscount = await this.customerDiscountRepo.findOne({
        where: { tenant_id: tenantId, customer_id: orderDraft.customerId, is_active: true },
      });

      if (customerDiscount) {
        const fromOk = !customerDiscount.effective_from || new Date(customerDiscount.effective_from) <= now;
        const toOk = !customerDiscount.effective_to || new Date(customerDiscount.effective_to) >= now;

        if (fromOk && toOk && MoneyUtil.greaterThan(customerDiscount.discount_percentage, '0')) {
          const pctDec = MoneyUtil.divide(customerDiscount.discount_percentage, '100', 6);
          let custDiscountAmt = '0.0000';

          for (let i = 0; i < lineItems.length; i++) {
            if (!isCampaignEligibleLine[i]) continue;
            const lineEligible = remainingBases[i];
            if (MoneyUtil.lessThanOrEqual(lineEligible, '0')) continue;

            const lineDisc = MoneyUtil.multiply(lineEligible, pctDec);
            lineItems[i].discountTotal = MoneyUtil.add(lineItems[i].discountTotal, lineDisc);
            remainingBases[i] = MoneyUtil.subtract(remainingBases[i], lineDisc);
            custDiscountAmt = MoneyUtil.add(custDiscountAmt, lineDisc);
          }

          if (MoneyUtil.greaterThan(custDiscountAmt, '0')) {
            discountTotal = MoneyUtil.add(discountTotal, custDiscountAmt);
            consideredDiscounts.push({
              campaignName: `Customer Specific Discount (${customerDiscount.discount_percentage}%)`,
              discountType: 'CUSTOMER_DISCOUNT',
              status: 'APPLIED',
              amount: custDiscountAmt,
            });
            singleDiscountApplied = true;
          }
        }
      }
    }

    // D. Additional Campaigns Evaluation (if no single discount was applied yet)
    if (!singleDiscountApplied) {
      const campaigns = await this.campaignRepo.find({
        where: { tenant_id: tenantId, is_active: true },
        relations: ['scopes'],
      });

      const evaluatedCandidates: {
        campaign: DiscountCampaign;
        isCoupon: boolean;
        priority: number;
        amount: string;
        lineAllocations: string[];
      }[] = [];

      for (const campaign of campaigns) {
        const isCouponMatch = matchedCoupon && couponCampaign && couponCampaign.id === campaign.id;

        if (campaign.coupon_required && !isCouponMatch) continue;
        if (campaign.effective_from && new Date(campaign.effective_from) > now) continue;
        if (campaign.effective_to && new Date(campaign.effective_to) < now) continue;
        if (campaign.usage_limit_total && campaign.usage_count >= campaign.usage_limit_total) continue;

        // Check scopes
        if (campaign.scopes && campaign.scopes.length > 0) {
          const exclusionScopes = campaign.scopes.filter((s) => s.is_exclusion);
          const inclusionScopes = campaign.scopes.filter((s) => !s.is_exclusion);

          // If any exclusion scope matches the draft, reject the campaign
          const isExcluded = exclusionScopes.some((s) => this.matchesScope(s, orderDraft));
          if (isExcluded) {
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

          // If there are inclusion scopes, at least one must match
          if (inclusionScopes.length > 0) {
            const matchesInclusion = inclusionScopes.some((s) => this.matchesScope(s, orderDraft));
            if (!matchesInclusion) {
              if (isCouponMatch) {
                consideredDiscounts.push({
                  campaignId: campaign.id,
                  campaignCode: campaign.code,
                  campaignName: campaign.name,
                  discountType: campaign.discount_type,
                  status: 'REJECTED',
                  rejectionReason: 'SCOPE_MISMATCH',
                  amount: '0.0000',
                });
              }
              continue;
            }
          }
        }

        if (campaign.minimum_subtotal && MoneyUtil.lessThan(subtotal, campaign.minimum_subtotal)) {
          if (isCouponMatch) {
            consideredDiscounts.push({
              campaignName: campaign.name,
              discountType: campaign.discount_type,
              status: 'REJECTED',
              rejectionReason: `Minimum purchase requirement of ${campaign.minimum_subtotal} not met`,
              amount: '0.0000',
            });
          }
          continue;
        }

        const effectivePriority = isCouponMatch ? (campaign.priority || 20) : (campaign.priority || 30);
        evaluatedCandidates.push({
          campaign,
          isCoupon: !!isCouponMatch,
          priority: effectivePriority,
          amount: '0.0000',
          lineAllocations: lineItems.map(() => '0.0000'),
        });
      }

      evaluatedCandidates.sort((a, b) => a.priority - b.priority);

      for (const candidate of evaluatedCandidates) {
        const campaign = candidate.campaign;
        let campaignAmount = '0.0000';

        if (campaign.discount_type === 'FREE_DELIVERY') {
          if (MoneyUtil.greaterThan(deliveryFee, '0.0000')) {
            campaignAmount = deliveryFee;
            deliveryFee = '0.0000';
          }
        } else if (campaign.discount_type === 'PERCENTAGE' && campaign.percentage) {
          const pctDecimal = MoneyUtil.divide(campaign.percentage, '100');
          for (let i = 0; i < lineItems.length; i++) {
            if (!isCampaignEligibleLine[i]) continue;
            const lineEligible = remainingBases[i];
            if (MoneyUtil.lessThanOrEqual(lineEligible, '0')) continue;

            let lineDisc = MoneyUtil.multiply(lineEligible, pctDecimal);
            if (campaign.maximum_discount_amount && MoneyUtil.greaterThan(lineDisc, campaign.maximum_discount_amount)) {
              lineDisc = campaign.maximum_discount_amount;
            }
            lineItems[i].discountTotal = MoneyUtil.add(lineItems[i].discountTotal, lineDisc);
            remainingBases[i] = MoneyUtil.subtract(remainingBases[i], lineDisc);
            campaignAmount = MoneyUtil.add(campaignAmount, lineDisc);
          }
        } else if (campaign.discount_type === 'FIXED_AMOUNT' && campaign.amount) {
          let totalEligibleBasis = '0.0000';
          for (let i = 0; i < lineItems.length; i++) {
            if (isCampaignEligibleLine[i] && MoneyUtil.greaterThan(remainingBases[i], '0')) {
              totalEligibleBasis = MoneyUtil.add(totalEligibleBasis, remainingBases[i]);
            }
          }

          if (MoneyUtil.greaterThan(totalEligibleBasis, '0')) {
            const targetDiscount = MoneyUtil.greaterThan(campaign.amount, totalEligibleBasis)
              ? totalEligibleBasis
              : campaign.amount;

            for (let i = 0; i < lineItems.length; i++) {
              if (!isCampaignEligibleLine[i]) continue;
              const lineEligible = remainingBases[i];
              if (MoneyUtil.lessThanOrEqual(lineEligible, '0')) continue;

              const lineDisc = MoneyUtil.divide(MoneyUtil.multiply(targetDiscount, lineEligible), totalEligibleBasis);
              lineItems[i].discountTotal = MoneyUtil.add(lineItems[i].discountTotal, lineDisc);
              remainingBases[i] = MoneyUtil.subtract(remainingBases[i], lineDisc);
              campaignAmount = MoneyUtil.add(campaignAmount, lineDisc);
            }
          }
        }

        if (MoneyUtil.greaterThan(campaignAmount, '0')) {
          discountTotal = MoneyUtil.add(discountTotal, campaignAmount);
          consideredDiscounts.push({
            campaignId: campaign.id,
            campaignCode: campaign.code,
            campaignName: campaign.name,
            discountType: campaign.discount_type,
            status: 'APPLIED',
            amount: campaignAmount,
          });
          if (!campaign.is_stackable) {
            singleDiscountApplied = true;
            break; // Non-stackable campaign stops further discounts
          }
        }
      }
    }

    // Calculate line grand totals and tax after discounts. Product tax_rate is
    // stored as a decimal fraction (for example 0.0900 for 9%). Explicit quote
    // tax rates remain available for integrations that already snapshot them.
    let grandTotal = '0.0000';
    let taxTotal = '0.0000';
    for (let i = 0; i < lineItems.length; i++) {
      const line = lineItems[i];
      line.grandTotal = MoneyUtil.subtract(line.subtotal, line.discountTotal);
      if (MoneyUtil.lessThan(line.grandTotal, '0')) {
        line.grandTotal = '0.0000';
      }
      const taxRate = requestedItems[i]?.taxRate || productTaxRates.get(line.productId) || '0.0000';
      taxTotal = MoneyUtil.add(taxTotal, MoneyUtil.multiply(line.grandTotal, taxRate));
      grandTotal = MoneyUtil.add(grandTotal, line.grandTotal);
    }
    grandTotal = MoneyUtil.add(grandTotal, deliveryFee);
    grandTotal = MoneyUtil.add(grandTotal, taxTotal);

    return {
      quoteVersion: MoneyUtil.format('1'),
      currencyCode,
      items: lineItems,
      subtotal,
      deliveryFee,
      discountTotal,
      taxTotal,
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

      if (campaign) {
        if (campaign.usage_limit_total !== null && campaign.usage_limit_total !== undefined && campaign.usage_count >= campaign.usage_limit_total) {
          throw new ConflictException(`Discount campaign ${campaign.code} usage limit reached during submission`);
        }

        campaign.usage_count += 1;
        await entityManager.save(campaign);

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

    // Lock and consume coupon independently if passed
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

        if (appliedCampaignIds.length === 0) {
          const usage = entityManager.create(DiscountUsage, {
            tenant_id: tenantId,
            campaign_id: coupon.campaign_id || null,
            coupon_id: coupon.id,
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
  }
}
