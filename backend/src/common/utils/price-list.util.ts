import { MoneyUtil } from './money.util';

/**
 * A price on a branch price list: one row of `price_entry` with a `price_group_id` and no
 * branch, channel, order type or add-on. It prices one product, or one size of a product
 * sold in sizes, from `effective_from` until `effective_to` (open-ended when null).
 */
export interface ListPriceEntry {
  product_id: string;
  variant_id: string | null;
  amount: string;
  effective_from: Date | string;
  effective_to: Date | string | null;
}

/** How a product, or one size of it, is keyed in a price map. */
export function priceKey(productId: string, variantId?: string | null): string {
  return `${productId}:${variantId || ''}`;
}

/** Whether an entry is the one in force at `at`: started, and not yet ended. */
export function isLiveAt(entry: Pick<ListPriceEntry, 'effective_from' | 'effective_to'>, at: Date): boolean {
  const from = new Date(entry.effective_from).getTime();
  const to = entry.effective_to ? new Date(entry.effective_to).getTime() : null;
  return from <= at.getTime() && (to === null || to > at.getTime());
}

/**
 * The list's price for each item at `at`. A size is priced by its own entry only: an entry
 * for the product does not reach its sizes, because each size has its own base price. When
 * two entries for one item are live at once, the later start wins.
 */
export function listPricesAt(entries: ListPriceEntry[], at: Date): Map<string, string> {
  const winners = new Map<string, ListPriceEntry>();
  for (const entry of entries) {
    if (!isLiveAt(entry, at)) continue;
    const key = priceKey(entry.product_id, entry.variant_id);
    const held = winners.get(key);
    if (!held || new Date(entry.effective_from).getTime() > new Date(held.effective_from).getTime()) {
      winners.set(key, entry);
    }
  }
  return new Map([...winners].map(([key, entry]) => [key, MoneyUtil.format(entry.amount)]));
}

/**
 * The in-store price of a product, or of one size of it: the branch list's price when it has
 * one, else the size's base price, else the product's. Add-on prices are added on top by the
 * caller and are the same at every branch.
 */
export function inStorePrice(
  listPrices: Map<string, string>,
  product: { id: string; base_price: string },
  variant?: { id: string; base_price: string } | null,
): string {
  const listed = listPrices.get(priceKey(product.id, variant?.id));
  if (listed !== undefined) return listed;
  return MoneyUtil.format(variant ? variant.base_price : product.base_price || '0');
}
