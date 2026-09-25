import { Injectable, BadRequestException, ForbiddenException, ConflictException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, In } from 'typeorm';
import { Coupon } from '../../entities/Coupon.entity';
import { DiscountUsage } from '../../entities/DiscountUsage.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { pickSettingValue } from '../../common/utils/setting-scope.util';
import { CustomerDiscount } from '../../entities/CustomerDiscount.entity';
import { ApprovalRequest } from '../../entities/ApprovalRequest.entity';
import { Product } from '../../entities/Product.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { DiscountQuoteRequestDto, QuoteItemDto, ManualDiscountDto } from './dtos/discounts.dto';

export interface ConsideredDiscount {
  /** Who granted it: the cashier, a coupon code, or the customer's own rate. */
  source: 'MANUAL' | 'COUPON' | 'CUSTOMER';
  name: string;
  couponId?: string;
  couponCode?: string;
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
    const byRole: Record<string, { pct: string; maxFixed: string }> = {
      CASHIER: { pct: String(authSettings.cashierMaxPct ?? 10), maxFixed: String(authSettings.cashierMaxFixed ?? 50000) },
      SUPERVISOR: { pct: String(authSettings.supervisorMaxPct ?? 20), maxFixed: String(authSettings.supervisorMaxFixed ?? 150000) },
      MANAGER: { pct: String(authSettings.managerMaxPct ?? 30), maxFixed: String(authSettings.managerMaxFixed ?? 300000) },
      ADMIN: { pct: String(authSettings.adminMaxPct ?? 100), maxFixed: String(authSettings.adminMaxFixed ?? 10000000) },
    };
    const roleName = (role || 'CASHIER').toUpperCase();
    return {
      role: roleName,
      own: byRole[roleName] || byRole.CASHIER,
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
    // Only real product ids go to the database. The coupon test bench quotes a stand-in
    // line ('temp-item'), and Postgres rejects a non-uuid in a uuid IN (...), which turned
    // every coupon check on that screen into a 500.
    const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const productIds = [...new Set(requestedItems.map((item) => item.productId).filter((id) => id && isUuid(id)))];
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

    // Load discount authorization policy settings
    const limits = await this.getManualDiscountLimits(tenantId, callerRole);
    const userRole = limits.role;
    const currentLimit = limits.own;
    const policyMaxPct = limits.ceiling.pct;
    const policyMaxFixed = limits.ceiling.maxFixed;

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
            source: 'MANUAL',
            name: 'Manual Discount',
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
                  source: 'MANUAL',
                  name: 'Manual Discount',
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
            source: 'MANUAL',
            name: 'Manual Discount',
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
                  source: 'MANUAL',
                  name: 'Manual Discount',
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
        // The grand total and the tax are built from each line's own discount, so the amount
        // has to be spread over the lines it was measured on. Adding it to discountTotal alone
        // recorded the discount while still charging, and taxing, the full price.
        const eligible = lineItems
          .map((_, i) => i)
          .filter((i) => !(orderDraft.items || [])[i]?.neverDiscount && MoneyUtil.greaterThan(remainingBases[i], '0'));
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

    // B. Workflow 4: One-Time Coupon Code, percentage or free item (Second Precedence)
    // A presented coupon is a deliberate act at the till, so it wins over the customer's
    // standing rate. The coupon carries its own terms.
    if (!singleDiscountApplied && couponCode && couponCode.trim()) {
      const normalizedCode = couponCode.trim().toUpperCase();
      const couponName = `Coupon (${normalizedCode})`;
      const reject = (rejectionReason: string, warning: string) => {
        consideredDiscounts.push({
          source: 'COUPON',
          name: couponName,
          couponCode: normalizedCode,
          discountType: 'COUPON',
          status: 'REJECTED',
          rejectionReason,
          amount: '0.0000',
        });
        warnings.push(warning);
      };

      const coupon = await this.couponRepo.findOne({
        where: { tenant_id: tenantId, code: normalizedCode },
      });

      if (!coupon || !coupon.is_active) {
        reject('INVALID_OR_INACTIVE_COUPON', `Coupon code ${normalizedCode} is invalid or inactive`);
      } else if (coupon.effective_from && new Date(coupon.effective_from) > now) {
        reject('COUPON_NOT_YET_ACTIVE', `Coupon code ${normalizedCode} is not active yet`);
      } else if (coupon.effective_to && new Date(coupon.effective_to) < now) {
        reject('COUPON_EXPIRED', `Coupon code ${normalizedCode} has expired`);
      } else if ((coupon.uses_count ?? 0) >= (coupon.max_uses ?? 1)) {
        reject('COUPON_MAX_USES_REACHED', `Coupon code ${normalizedCode} has reached maximum usage limit`);
      } else if (
        orderDraft.customerId &&
        (await this.usageRepo.count({
          where: { tenant_id: tenantId, coupon_id: coupon.id, customer_id: orderDraft.customerId },
        })) >= 1
      ) {
        reject('COUPON_ALREADY_REDEEMED_BY_CUSTOMER', `Coupon ${normalizedCode} already used by this customer`);
      } else if (coupon.minimum_subtotal && MoneyUtil.lessThan(subtotal, coupon.minimum_subtotal)) {
        reject(
          'COUPON_MINIMUM_NOT_MET',
          `Coupon ${normalizedCode} needs a subtotal of at least ${coupon.minimum_subtotal}`,
        );
      } else {
        const freeItem = coupon.coupon_type === 'FREE_ITEM' ? this.freeItemDiscounts(coupon, lineItems, remainingBases, isDiscountableLine) : null;
        if (freeItem && 'rejection' in freeItem) {
          reject(freeItem.rejection, `Coupon ${normalizedCode}: ${freeItem.warning}`);
        }
        const pctDec = MoneyUtil.divide(coupon.percentage, '100', 6);
        let lineDiscs =
          freeItem && 'lineDiscs' in freeItem
            ? freeItem.lineDiscs
            : freeItem
              ? lineItems.map(() => '0.0000')
              : lineItems.map((_, i) =>
                  isDiscountableLine[i] && MoneyUtil.greaterThan(remainingBases[i], '0')
                    ? MoneyUtil.multiply(remainingBases[i], pctDec)
                    : '0.0000',
                );
        const sum = (values: string[]) => values.reduce((acc, v) => MoneyUtil.add(acc, v), '0.0000');
        const uncapped = sum(lineDiscs);

        // The cap is on the coupon as a whole. Each line is scaled down in proportion so
        // the per-line figures still add up to what the order is discounted by.
        const cap = coupon.maximum_discount_amount;
        if (cap && MoneyUtil.greaterThan(uncapped, cap)) {
          lineDiscs = lineDiscs.map((d) => MoneyUtil.divide(MoneyUtil.multiply(d, cap), uncapped));
        }
        const couponAmount = sum(lineDiscs);

        for (let i = 0; i < lineItems.length; i++) {
          if (MoneyUtil.lessThanOrEqual(lineDiscs[i], '0')) continue;
          lineItems[i].discountTotal = MoneyUtil.add(lineItems[i].discountTotal, lineDiscs[i]);
          remainingBases[i] = MoneyUtil.subtract(remainingBases[i], lineDiscs[i]);
        }

        if (MoneyUtil.greaterThan(couponAmount, '0')) {
          discountTotal = MoneyUtil.add(discountTotal, couponAmount);
          consideredDiscounts.push({
            source: 'COUPON',
            name: freeItem ? `${couponName} free item` : `${couponName} ${MoneyUtil.format(coupon.percentage, 2)}%`,
            couponId: coupon.id,
            couponCode: normalizedCode,
            discountType: freeItem ? 'FREE_ITEM' : 'PERCENTAGE',
            status: 'APPLIED',
            amount: couponAmount,
          });
          singleDiscountApplied = true;
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
            if (!isDiscountableLine[i]) continue;
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
              source: 'CUSTOMER',
              name: `Customer Specific Discount (${customerDiscount.discount_percentage}%)`,
              discountType: 'CUSTOMER_DISCOUNT',
              status: 'APPLIED',
              amount: custDiscountAmt,
            });
            singleDiscountApplied = true;
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

  /**
   * What a free-item coupon takes off each line, or why it does not apply. The basket must
   * hold `buy_quantity` of the buy product (any product when none is named) besides the free
   * units, and the reward product itself: the cashier rings up the free drink, and the coupon
   * makes up to `reward_quantity` units of it free. When the buy and reward product are the
   * same ("buy 2, get 1 free") the free units don't count towards the buy.
   */
  private freeItemDiscounts(
    coupon: Coupon,
    lineItems: QuotedLineItem[],
    remainingBases: string[],
    isDiscountableLine: boolean[],
  ): { lineDiscs: string[] } | { rejection: string; warning: string } {
    const units = (line: QuotedLineItem) => Math.floor(Number(line.quantity) || 0);
    const rewardLines = lineItems.map((line, i) => ({ line, i })).filter(({ line }) => line.productId === coupon.reward_product_id);
    const rewardUnits = rewardLines.reduce((acc, { line }) => acc + units(line), 0);
    if (rewardUnits === 0) {
      return { rejection: 'COUPON_REWARD_NOT_IN_ORDER', warning: 'add the free item to the order to use this coupon' };
    }

    const buyQuantity = coupon.buy_quantity || 1;
    const rewardQuantity = coupon.reward_quantity || 1;
    const sameProduct = !!coupon.buy_product_id && coupon.buy_product_id === coupon.reward_product_id;
    let free: number;
    if (sameProduct) {
      free = Math.min(rewardQuantity, rewardUnits - buyQuantity);
    } else {
      const bought = lineItems
        .filter((line) => (coupon.buy_product_id ? line.productId === coupon.buy_product_id : line.productId !== coupon.reward_product_id))
        .reduce((acc, line) => acc + units(line), 0);
      free = bought >= buyQuantity ? Math.min(rewardQuantity, rewardUnits) : 0;
    }
    if (free <= 0) {
      return { rejection: 'COUPON_BUY_CONDITION_NOT_MET', warning: `buy ${buyQuantity} to get ${rewardQuantity} free` };
    }

    const lineDiscs = lineItems.map(() => '0.0000');
    let left = free;
    for (const { line, i } of rewardLines) {
      if (left <= 0) break;
      if (!isDiscountableLine[i] || MoneyUtil.lessThanOrEqual(remainingBases[i], '0')) continue;
      const take = Math.min(left, units(line));
      const amount = MoneyUtil.multiply(line.unitPrice, String(take));
      lineDiscs[i] = MoneyUtil.greaterThan(amount, remainingBases[i]) ? remainingBases[i] : amount;
      left -= take;
    }
    return { lineDiscs };
  }

  /**
   * Counts a coupon redemption against its limit, inside the order's transaction. The row
   * is locked so two tills cannot both spend the last use of the same code.
   */
  async consumeUsage(
    tenantId: string,
    orderId: string,
    customerId: string | undefined,
    couponId: string,
    discountAmount: string,
    entityManager: EntityManager,
  ): Promise<void> {
    const coupon = await entityManager
      .createQueryBuilder(Coupon, 'cp')
      .setLock('pessimistic_write')
      .where('cp.id = :couponId AND cp.tenant_id = :tenantId', { couponId, tenantId })
      .getOne();

    if (!coupon) return;

    const maxUses = coupon.max_uses ?? 1;
    if (coupon.uses_count >= maxUses) {
      throw new ConflictException(`Coupon ${coupon.code} max redemptions reached during submission`);
    }
    coupon.uses_count += 1;
    await entityManager.save(coupon);

    const usage = entityManager.create(DiscountUsage, {
      tenant_id: tenantId,
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
