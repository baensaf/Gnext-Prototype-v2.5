import { Injectable, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { pickSettingValue } from '../../common/utils/setting-scope.util';
import { ApprovalRequest } from '../../entities/ApprovalRequest.entity';
import { Product } from '../../entities/Product.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { HEAD_OFFICE_ROLES } from '../../common/utils/user-scope.util';
import { DiscountQuoteRequestDto, QuoteItemDto, ManualDiscountDto } from './dtos/discounts.dto';
import { ItemDiscountsService } from './item-discounts.service';
import { CouponsService, CouponRefusal } from './coupons.service';
import { CustomerGroupsService, GroupDiscountRefusal } from './customer-groups.service';
import { Coupon } from '../../entities/Coupon.entity';
import { CouponBatch } from '../../entities/CouponBatch.entity';

export interface ConsideredDiscount {
  /**
   * Who granted it: an automatic item discount (one entry per discounted line, applied
   * first), or the one order discount: the cashier's, or the customer's own rate.
   */
  source: 'ITEM' | 'MANUAL' | 'CUSTOMER' | 'COUPON';
  name: string;
  /** COUPON: the code's id, and why it was refused when it was. */
  couponId?: string;
  couponRefusal?: CouponRefusal;
  itemDiscountId?: string;
  productId?: string;
  percent?: string;
  /** COUPON and CUSTOMER: the most the percent may take off, so an edit later prices it within the same cap. */
  maxDiscount?: string;
  /** CUSTOMER: the customer's group discount and what is left of it this month, or why it was not given. */
  personal?: {
    discountId: string;
    name: string;
    refusal?: GroupDiscountRefusal;
    /** How much of this order it covers; less than the order when a cap stopped it. */
    covered?: string;
    partial?: boolean;
    /** Left after this order; null where the group has no limit. */
    usesLeft: number | null;
    monthLeft: string | null;
  };
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
  /** The automatic item discount on this line: percent ('0.00' for none), its id and amount. */
  itemDiscountPercent: string;
  itemDiscountId: string | null;
  itemDiscountTotal: string;
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
    @InjectRepository(TenantSetting)
    private readonly settingRepo: Repository<TenantSetting>,
    @InjectRepository(ApprovalRequest)
    private readonly approvalRequestRepo?: Repository<ApprovalRequest>,
    @Optional()
    @InjectRepository(Product)
    private readonly productRepo?: Repository<Product>,
    @Optional()
    private readonly itemDiscounts?: ItemDiscountsService,
    @Optional()
    private readonly coupons?: CouponsService,
    @Optional()
    private readonly groups?: CustomerGroupsService,
  ) {}

  /**
   * How much manual discount a role may give alone, and the ceiling nobody may pass even
   * with a manager's pin. Head office sets both under Discount Authorizations; the register
   * reads the same figures so it asks for a pin exactly when this would.
   */
  async getManualDiscountLimits(tenantId: string, role?: string | null) {
    const settings = await this.settingRepo.find({ where: { tenant_id: tenantId } });
    // Who may authorise a discount is chain-wide policy, so this reads the organization
    // row explicitly rather than whichever row happens to come back first.
    const authSettings =
      pickSettingValue(settings.filter((s) => s.key === 'DISCOUNT_AUTHORIZATIONS')) ||
      pickSettingValue(settings.filter((s) => s.key === 'DISCOUNTS')) ||
      {};
    // A percent per role and nothing in Toman (R-16). A new chain starts its tills at 0%, so
    // every manual discount needs a manager until head office sets a limit.
    const byRole: Record<string, { pct: string }> = {
      CASHIER: { pct: String(authSettings.cashierMaxPct ?? 0) },
      SUPERVISOR: { pct: String(authSettings.supervisorMaxPct ?? 0) },
      MANAGER: { pct: String(authSettings.managerMaxPct ?? 100) },
      ADMIN: { pct: String(authSettings.adminMaxPct ?? 100) },
    };
    const roleName = (role || 'CASHIER').toUpperCase();
    return {
      role: roleName,
      // Head office's other roles carry the administrator's limit; anything unknown is a register.
      own: byRole[roleName] || (HEAD_OFFICE_ROLES.includes(roleName) ? byRole.ADMIN : byRole.CASHIER),
      ceiling: byRole.MANAGER,
    };
  }

  async evaluateQuote(
    tenantId: string,
    request: DiscountQuoteRequestDto,
    /** The signed-in account's role, which sets how much it may discount without a pin. */
    callerRole?: string | null,
  ): Promise<DiscountQuoteResult> {
    const { orderDraft, manualDiscount, couponCode } = request;
    const currencyCode = orderDraft.currencyCode || 'IRR';
    const now = new Date();

    const consideredDiscounts: ConsideredDiscount[] = [];
    const warnings: string[] = [];

    const requestedItems = orderDraft.items || [];
    // Only real product ids go to the database: Postgres rejects a non-uuid in a uuid IN (...).
    const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const productIds = [...new Set(requestedItems.map((item) => item.productId).filter((id) => id && isUuid(id)))];
    const products = this.productRepo && productIds.length > 0
      ? await this.productRepo.find({ where: { tenant_id: tenantId, id: In(productIds) } })
      : [];
    const productTaxRates = new Map(products.map((product) => [product.id, product.tax_rate || '0.0000']));

    // Head office's list of categories a friends-and-family discount never touches (drinks,
    // say). It covers the customer's own rate and a cashier's discount given for that reason.
    const familySettings = await this.settingRepo.find({ where: { tenant_id: tenantId, key: 'DISCOUNT_AUTHORIZATIONS' } });
    const familyExcluded = new Set<string>((pickSettingValue(familySettings) as any)?.familyExcludedCategoryIds || []);
    const productCategories = new Map(products.map((product) => [product.id, product.category_id]));
    const familyExcludedLine = requestedItems.map((item) => {
      const category = item.categoryId || productCategories.get(item.productId);
      return !!category && familyExcluded.has(category);
    });

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
        itemDiscountPercent: '0.00',
        itemDiscountId: null,
        itemDiscountTotal: '0.0000',
      };
    });

    // Track remaining eligible basis per item line
    const remainingBases = (orderDraft.items || []).map((item, idx) => {
      if (item.neverDiscount) {
        return '0.0000';
      }
      return lineItems[idx].subtotal;
    });

    const isDiscountableLine = (orderDraft.items || []).map((item) => {
      return !item.neverDiscount && !item.ownNonStackableApplied;
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

    // 0. Automatic item discounts (V1, 2026-10-03), as HAMI does them: each line of a
    // discounted product loses its percent first, and the one order discount below works on
    // what is left. The till and the kiosk (in store); Snappfood orders are priced by the
    // channel. A discount applies when the branch's price list is in its scope. A line
    // that already carries its percent (an order line keeps the one it was given) uses that;
    // otherwise today's discount for the product applies.
    const channel = (orderDraft.channel || 'POS').toUpperCase();
    if (channel === 'POS' || channel === 'KIOSK') {
      const lookup = requestedItems.filter((item) => item.itemDiscountPercent === undefined).map((item) => item.productId);
      const today = lookup.length && this.itemDiscounts
        ? await this.itemDiscounts.activeFor(tenantId, orderDraft.branchId, lookup)
        : new Map<string, { id: string; percent: string }>();
      for (let i = 0; i < lineItems.length; i++) {
        const item = requestedItems[i];
        const found = item.itemDiscountPercent === undefined ? today.get(item.productId) : null;
        const percent = found ? found.percent : MoneyUtil.format(item.itemDiscountPercent || '0', 2);
        const itemDiscountId = found ? found.id : item.itemDiscountId || null;
        lineItems[i].itemDiscountPercent = percent;
        lineItems[i].itemDiscountId = MoneyUtil.greaterThan(percent, '0') ? itemDiscountId : null;
        if (!MoneyUtil.greaterThan(percent, '0')) continue;
        const amount = MoneyUtil.multiply(lineItems[i].subtotal, MoneyUtil.divide(percent, '100', 6));
        if (!MoneyUtil.greaterThan(amount, '0')) continue;
        lineItems[i].itemDiscountTotal = amount;
        lineItems[i].discountTotal = MoneyUtil.add(lineItems[i].discountTotal, amount);
        if (MoneyUtil.greaterThan(remainingBases[i], '0')) {
          const left = MoneyUtil.subtract(remainingBases[i], amount);
          remainingBases[i] = MoneyUtil.greaterThan(left, '0') ? left : '0.0000';
        }
        discountTotal = MoneyUtil.add(discountTotal, amount);
        consideredDiscounts.push({
          source: 'ITEM',
          name: `${Number(percent)}% item discount`,
          discountType: 'PERCENTAGE',
          status: 'APPLIED',
          amount,
          itemDiscountId: itemDiscountId || undefined,
          productId: item.productId,
          percent,
        });
      }
    }

    // Load discount authorization policy settings
    const limits = await this.getManualDiscountLimits(tenantId, callerRole);
    const userRole = limits.role;
    const currentLimit = limits.own;
    const policyMaxPct = limits.ceiling.pct;

    // A0. A one-time coupon (V2), till orders only. When it works it is the order's one
    // discount: the cashier's discount and the friends-and-family rate step aside.
    if (couponCode && couponCode.trim() && this.coupons && channel === 'POS') {
      const checked = await this.coupons.check(tenantId, couponCode, {
        branchId: orderDraft.branchId,
        subtotal,
        productIds: requestedItems.map((item) => item.productId),
      });
      if (checked.ok === false) {
        const refused = checked as { ok: false; reason: CouponRefusal; batch?: { reward_type: string } };
        consideredDiscounts.push({
          source: 'COUPON',
          name: `Coupon ${couponCode.trim().toUpperCase()}`,
          discountType: refused.batch?.reward_type || 'COUPON',
          status: 'REJECTED',
          rejectionReason: `Coupon refused: ${refused.reason}`,
          couponRefusal: refused.reason,
          amount: '0.0000',
        });
      } else {
        const { coupon, batch } = checked as { ok: true; coupon: Coupon; batch: CouponBatch };
        let couponAmount = '0.0000';
        if (batch.reward_type === 'PERCENT') {
          const eligible = lineItems.map((_, i) => i).filter((i) => isDiscountableLine[i] && MoneyUtil.greaterThan(remainingBases[i], '0'));
          const base = eligible.reduce((sum, i) => MoneyUtil.add(sum, remainingBases[i]), '0.0000');
          couponAmount = MoneyUtil.multiply(base, MoneyUtil.divide(batch.percent || '0', '100', 6));
          if (batch.max_discount && MoneyUtil.greaterThan(couponAmount, batch.max_discount)) couponAmount = MoneyUtil.format(batch.max_discount);
          const shares = MoneyUtil.allocate(couponAmount, eligible.map((i) => remainingBases[i]));
          eligible.forEach((lineIndex, k) => {
            lineItems[lineIndex].discountTotal = MoneyUtil.add(lineItems[lineIndex].discountTotal, shares[k]);
            remainingBases[lineIndex] = MoneyUtil.subtract(remainingBases[lineIndex], shares[k]);
          });
        } else {
          // One of the free product, at what one unit still costs after its item discount.
          const i = requestedItems.findIndex((item) => item.productId === batch.reward_product_id);
          const perUnit = MoneyUtil.divide(remainingBases[i] || '0', lineItems[i].quantity || '1');
          couponAmount = MoneyUtil.greaterThan(perUnit, '0') ? perUnit : '0.0000';
          lineItems[i].discountTotal = MoneyUtil.add(lineItems[i].discountTotal, couponAmount);
          remainingBases[i] = MoneyUtil.subtract(remainingBases[i], couponAmount);
        }
        discountTotal = MoneyUtil.add(discountTotal, couponAmount);
        consideredDiscounts.push({
          source: 'COUPON',
          name: `Coupon ${coupon.code}`,
          couponId: coupon.id,
          discountType: batch.reward_type,
          percent: batch.reward_type === 'PERCENT' ? batch.percent || undefined : undefined,
          maxDiscount: batch.reward_type === 'PERCENT' ? batch.max_discount || undefined : undefined,
          productId: batch.reward_type === 'FREE_ITEM' ? batch.reward_product_id || undefined : undefined,
          status: 'APPLIED',
          amount: couponAmount,
        });
        singleDiscountApplied = true;
      }
    }

    // A. Workflow 3: Manual Cashier Discount Evaluation (Highest Precedence)
    if (!singleDiscountApplied && manualDiscount && MoneyUtil.greaterThan(manualDiscount.value, '0')) {
      const forFamily = manualDiscount.reasonCode === 'FRIENDS_FAMILY';
      const manualSkips = (i: number) => !!(orderDraft.items || [])[i]?.neverDiscount || (forFamily && familyExcludedLine[i]);
      let manualEligibleSubtotal = '0.0000';
      for (let i = 0; i < lineItems.length; i++) {
        if (!manualSkips(i)) {
          manualEligibleSubtotal = MoneyUtil.add(manualEligibleSubtotal, remainingBases[i]);
        }
      }

      // The limit is a percent of what the discount works on (R-16, 2026-10-24); an amount
      // typed in Toman is measured as the percent of that it takes off.
      const isPercent = manualDiscount.calculation_type === 'PERCENTAGE';
      const typed = MoneyUtil.format(manualDiscount.value);
      const requestedAmount = isPercent
        ? MoneyUtil.multiply(manualEligibleSubtotal, MoneyUtil.divide(typed, '100', 6))
        : MoneyUtil.greaterThan(typed, manualEligibleSubtotal) ? manualEligibleSubtotal : typed;
      const pctVal = isPercent
        ? typed
        : MoneyUtil.greaterThan(manualEligibleSubtotal, '0')
          ? MoneyUtil.divide(MoneyUtil.multiply(requestedAmount, '100'), manualEligibleSubtotal, 2)
          : '100.00';
      const shown = isPercent ? `${Number(pctVal)}%` : `${typed} (${Number(pctVal)}%)`;

      let manualAmount = '0.0000';
      if (MoneyUtil.greaterThan(pctVal, policyMaxPct)) {
        consideredDiscounts.push({
          source: 'MANUAL',
          name: 'Manual Discount',
          discountType: manualDiscount.calculation_type,
          status: 'REJECTED',
          rejectionReason: `Exceeds maximum permitted policy limit of ${policyMaxPct}%`,
          amount: '0.0000',
        });
        warnings.push(`Manual discount ${shown} exceeds maximum policy threshold of ${policyMaxPct}%`);
      } else {
        let isValidApproval = true;
        if (MoneyUtil.greaterThan(pctVal, currentLimit.pct)) {
          if (!manualDiscount.approvalRequestId) {
            approvalRequired = true;
            approvalReason = `Manual discount ${shown} exceeds ${userRole} limit of ${currentLimit.pct}%. Manager approval required.`;
            isValidApproval = false;
          } else if (this.approvalRequestRepo) {
            const appReq = await this.approvalRequestRepo.findOne({
              where: { id: manualDiscount.approvalRequestId, tenant_id: tenantId },
            });
            if (!appReq || appReq.status !== 'APPROVED' || (appReq.expires_at && new Date(appReq.expires_at) < now)) {
              isValidApproval = false;
              consideredDiscounts.push({
                source: 'MANUAL',
                name: 'Manual Discount',
                discountType: manualDiscount.calculation_type,
                status: 'REJECTED',
                rejectionReason: `Invalid or unapproved escalation approval request ${manualDiscount.approvalRequestId}`,
                amount: '0.0000',
              });
              warnings.push(`Approval request ${manualDiscount.approvalRequestId} is invalid or not approved`);
            }
          }
        }
        if (isValidApproval) manualAmount = requestedAmount;
      }

      if (MoneyUtil.greaterThan(manualAmount, '0')) {
        // The grand total and the tax are built from each line's own discount, so the amount
        // has to be spread over the lines it was measured on. Adding it to discountTotal alone
        // recorded the discount while still charging, and taxing, the full price.
        const eligible = lineItems
          .map((_, i) => i)
          .filter((i) => !manualSkips(i) && MoneyUtil.greaterThan(remainingBases[i], '0'));
        const shares = MoneyUtil.allocate(manualAmount, eligible.map((i) => remainingBases[i]));
        eligible.forEach((lineIndex, k) => {
          lineItems[lineIndex].discountTotal = MoneyUtil.add(lineItems[lineIndex].discountTotal, shares[k]);
          remainingBases[lineIndex] = MoneyUtil.subtract(remainingBases[lineIndex], shares[k]);
        });

        discountTotal = MoneyUtil.add(discountTotal, manualAmount);
        consideredDiscounts.push({
          source: 'MANUAL',
          name: 'Manual Cashier Discount',
          discountType: manualDiscount.calculation_type,
          status: 'APPLIED',
          amount: manualAmount,
        });
        singleDiscountApplied = true;
      }
    }

    // B. The customer's group discount, on till orders, unless the cashier took it off. A
    // coupon or a manual discount replaces it. A customer in several groups gets the biggest
    // percent that may apply: one for their own branch only works at the branch they belong
    // to there, and optional monthly limits hold it to so many orders, so much of their orders
    // covered, and so much of one order (the rest is full price).
    if (!singleDiscountApplied && orderDraft.customerId && orderDraft.branchId && channel === 'POS' && !orderDraft.skipCustomerDiscount && this.groups) {
      const offers = await this.groups.offersFor(tenantId, orderDraft.customerId);
      let refused: ConsideredDiscount | null = null;
      for (const { discount, branches } of offers) {
        if (!MoneyUtil.greaterThan(discount.percent, '0')) continue;
        const name = `${discount.name} ${Number(discount.percent)}%`;
        const used = await this.groups.usage(tenantId, orderDraft.customerId, discount.id, orderDraft.orderId);
        const { usesLeft, monthLeft } = this.groups.left(discount, used);
        const refusal: GroupDiscountRefusal | null =
          discount.own_branch_only && !branches.includes(orderDraft.branchId)
            ? 'OTHER_BRANCH'
            : usesLeft !== null && usesLeft <= 0
              ? 'USES_SPENT'
              : monthLeft !== null && !MoneyUtil.greaterThan(monthLeft, '0')
                ? 'MONTH_SPENT'
                : null;
        if (refusal) {
          refused = refused || {
            source: 'CUSTOMER',
            name,
            percent: discount.percent,
            discountType: 'CUSTOMER_DISCOUNT',
            status: 'REJECTED',
            rejectionReason: refusal,
            amount: '0.0000',
            personal: { discountId: discount.id, name: discount.name, refusal, usesLeft, monthLeft },
          };
          continue;
        }

        // How much of this order it may cover: the cap per order, and what the month has left.
        let coverable: string | null = discount.per_visit_cap ? MoneyUtil.format(discount.per_visit_cap) : null;
        if (monthLeft !== null && (coverable === null || MoneyUtil.lessThan(monthLeft, coverable))) coverable = monthLeft;

        const eligible = lineItems
          .map((_, i) => i)
          .filter((i) => isDiscountableLine[i] && !familyExcludedLine[i] && MoneyUtil.greaterThan(remainingBases[i], '0'));
        const base = eligible.reduce((sum, i) => MoneyUtil.add(sum, remainingBases[i]), '0.0000');
        const covered = coverable !== null && MoneyUtil.greaterThan(base, coverable) ? coverable : base;
        const pctDec = MoneyUtil.divide(discount.percent, '100', 6);
        const custDiscountAmt = MoneyUtil.multiply(covered, pctDec);
        if (!MoneyUtil.greaterThan(custDiscountAmt, '0')) break;

        const shares = MoneyUtil.allocate(custDiscountAmt, eligible.map((i) => remainingBases[i]));
        eligible.forEach((lineIndex, k) => {
          lineItems[lineIndex].discountTotal = MoneyUtil.add(lineItems[lineIndex].discountTotal, shares[k]);
          remainingBases[lineIndex] = MoneyUtil.subtract(remainingBases[lineIndex], shares[k]);
        });
        discountTotal = MoneyUtil.add(discountTotal, custDiscountAmt);
        const monthAfter = monthLeft === null ? null : MoneyUtil.subtract(monthLeft, covered);
        consideredDiscounts.push({
          source: 'CUSTOMER',
          name,
          percent: discount.percent,
          maxDiscount: coverable !== null ? MoneyUtil.multiply(coverable, pctDec) : undefined,
          discountType: 'CUSTOMER_DISCOUNT',
          status: 'APPLIED',
          amount: custDiscountAmt,
          personal: {
            discountId: discount.id,
            name: discount.name,
            covered,
            partial: MoneyUtil.lessThan(covered, base),
            usesLeft: usesLeft === null ? null : usesLeft - 1,
            monthLeft: monthAfter === null ? null : MoneyUtil.greaterThan(monthAfter, '0') ? monthAfter : '0.0000',
          },
        });
        singleDiscountApplied = true;
        refused = null;
        break;
      }
      if (refused) consideredDiscounts.push(refused);
    }

    // Line totals and tax after discounts. Product tax_rate is stored as a fraction (0.1000 for
    // 10%). Each line's net and its tax are rounded to a whole Toman, halves up, and the order adds
    // up its rounded lines, so the screen, the paper and the database never show part of a Toman.
    // The rounding is folded into the line's discount so net = subtotal - discount still holds.
    let grandTotal = '0.0000';
    let taxTotal = '0.0000';
    for (let i = 0; i < lineItems.length; i++) {
      const line = lineItems[i];
      let net = MoneyUtil.subtract(line.subtotal, line.discountTotal);
      if (MoneyUtil.lessThan(net, '0')) net = '0.0000';
      const rounded = MoneyUtil.roundToman(net);
      if (!MoneyUtil.equals(rounded, net) && MoneyUtil.greaterThan(line.discountTotal, '0')) {
        const adjusted = MoneyUtil.subtract(line.subtotal, rounded);
        discountTotal = MoneyUtil.add(discountTotal, MoneyUtil.subtract(adjusted, line.discountTotal));
        line.discountTotal = adjusted;
      }
      line.grandTotal = rounded;
      const taxRate = requestedItems[i]?.taxRate || productTaxRates.get(line.productId) || '0.0000';
      taxTotal = MoneyUtil.add(taxTotal, MoneyUtil.roundToman(MoneyUtil.multiply(line.grandTotal, taxRate)));
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
}
