import { KdsRoutingRule } from '../../entities/KdsRoutingRule.entity';

/**
 * The prep station that makes a product at a branch: the product's own rule, else its
 * category's, else none. The kitchen screen and the kitchen printers both ask this, so a burger
 * the grill screen shows is a burger the grill printer prints.
 *
 * `rules` are the branch's rules; there is at most one per product and one per category.
 */
export function stationIdFor(
  rules: KdsRoutingRule[],
  productId?: string | null,
  categoryId?: string | null,
): string | undefined {
  if (productId) {
    const own = rules.find((r) => r.product_id === productId);
    if (own) return own.station_id;
  }
  if (categoryId) {
    const byCategory = rules.find((r) => !r.product_id && r.category_id === categoryId);
    if (byCategory) return byCategory.station_id;
  }
  return undefined;
}
