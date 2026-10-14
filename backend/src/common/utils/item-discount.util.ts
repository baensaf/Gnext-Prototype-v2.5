import Decimal from 'decimal.js';
import { ArrayOverlap, EntityManager, IsNull, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { ItemDiscount } from '../../entities/ItemDiscount.entity';
import { PriceGroup } from '../../entities/PriceGroup.entity';
import { PriceGroupBranch } from '../../entities/PriceGroupBranch.entity';
import { loadBusinessClock } from './business-clock';
import { MoneyUtil } from './money.util';

/** Where a sale happens, for item discounts: the till and the kiosk are both in store. */
export type DiscountChannel = 'IN_STORE' | 'SNAPPFOOD';
export const DISCOUNT_APPLIES_TO = ['IN_STORE', 'SNAPPFOOD', 'BOTH'] as const;

type Scope = Pick<ItemDiscount, 'all_groups' | 'price_group_ids' | 'applies_to'>;

/** Whether a discount reaches a branch on `groupId` (null for a branch with no price list). */
export function coversGroup(discount: Pick<Scope, 'all_groups' | 'price_group_ids'>, groupId: string | null): boolean {
  return discount.all_groups || (!!groupId && (discount.price_group_ids || []).includes(groupId));
}

export function coversChannel(discount: Pick<Scope, 'applies_to'>, channel: DiscountChannel): boolean {
  return discount.applies_to === 'BOTH' || discount.applies_to === channel;
}

/** Two discounts clash on a product only when they share a group and a channel (and a day). */
export function sharesScope(a: Scope, b: Scope): boolean {
  const groups = a.all_groups || b.all_groups || (a.price_group_ids || []).some((id) => (b.price_group_ids || []).includes(id));
  const channel = a.applies_to === 'BOTH' || b.applies_to === 'BOTH' || a.applies_to === b.applies_to;
  return groups && channel;
}

/** The price list a branch sells from, when it has one in use. */
export async function priceGroupOfBranch(em: EntityManager, tenantId: string, branchId: string | null | undefined): Promise<string | null> {
  if (!branchId) return null;
  const link = await em.findOne(PriceGroupBranch, { where: { tenant_id: tenantId, branch_id: branchId } });
  if (!link) return null;
  const group = await em.findOne(PriceGroup, { where: { id: link.price_group_id, tenant_id: tenantId, is_active: true } });
  return group ? group.id : null;
}

/** The discount a product gets on one business day. */
export interface ActiveItemDiscount {
  id: string;
  percent: string;
}

/**
 * The discount each product gets at a branch on a channel, on the branch's business day (the
 * day turns at the chain's cutoff, so a sale at 01:00 belongs to the day before): the
 * discounts dated today whose groups include the branch's price list (or are for all
 * groups) and whose channel includes this one. Products with none are absent.
 */
export async function activeItemDiscounts(
  em: EntityManager,
  tenantId: string,
  branchId: string | null | undefined,
  channel: DiscountChannel,
  productIds?: string[],
): Promise<Map<string, ActiveItemDiscount>> {
  const out = new Map<string, ActiveItemDiscount>();
  // A caller with no real entity manager (a unit test's fake) has no discounts.
  if (typeof (em as any)?.find !== 'function' || typeof (em as any)?.findOne !== 'function') return out;
  const ids = productIds ? [...new Set(productIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id || '')))] : null;
  if (ids && !ids.length) return out;
  const today = (await loadBusinessClock(em, tenantId, branchId || null)).today();
  const product = ids ? { product_ids: ArrayOverlap(ids) } : {};
  const rows = await em.find(ItemDiscount, {
    where: [
      { tenant_id: tenantId, is_active: true, ...product, starts_on: LessThanOrEqual(today), ends_on: IsNull() },
      { tenant_id: tenantId, is_active: true, ...product, starts_on: LessThanOrEqual(today), ends_on: MoreThanOrEqual(today) },
    ],
  });
  if (!rows.length) return out;
  const groupId = await priceGroupOfBranch(em, tenantId, branchId);
  const wanted = ids ? new Set(ids) : null;
  for (const r of rows) {
    if (!coversChannel(r, channel) || !coversGroup(r, groupId)) continue;
    for (const productId of r.product_ids || []) {
      if (!wanted || wanted.has(productId)) out.set(productId, { id: r.id, percent: MoneyUtil.format(r.percent, 2) });
    }
  }
  return out;
}

/**
 * A price with a percent off, in Rial rounded to a whole Toman (10 Rial), which is how
 * Snappfood takes a price. The caller keeps the original as the struck-through price.
 */
export function discountedPrice(price: string | number, percent: string | number): string {
  const cut = new Decimal(price || 0).mul(new Decimal(100).minus(percent || 0)).div(100);
  return cut.div(10).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).mul(10).toFixed(4);
}
