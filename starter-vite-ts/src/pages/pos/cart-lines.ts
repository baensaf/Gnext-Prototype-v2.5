import type { CartItem } from './order';

/**
 * How cart lines stack and split. Taps of the same item with the same choices stack into one
 * line ("Burger ×3"), which keeps a busy counter fast. When one of a stacked line is asked for
 * differently (another size, extra cheese, "no onion"), that one moves to a line of its own.
 */

/** The same add-ons, whatever order they were picked in. */
export const choicesKey = (line: Pick<CartItem, 'selectedVariant' | 'selectedOptions'>) =>
  `${line.selectedVariant?.id || ''}|${line.selectedOptions
    .map((o) => o.id)
    .sort()
    .join(',')}`;

/** What a line was priced at when added: lines at different prices never stack. */
export const pricedKey = (line: Pick<CartItem, 'quote'>) =>
  line.quote
    ? `${line.quote.unit_price}|${Object.keys(line.quote.options)
        .sort()
        .map((id) => line.quote!.options[id])
        .join(',')}|${line.quote.tax_rate}|${line.quote.item_discount_percent}`
    : '';

/** Two lines a tap may join: the same item, size, add-ons and prices, and neither carries a note. */
export const stacksWith = (a: CartItem, b: CartItem) =>
  !a.notes && !b.notes && a.product.id === b.product.id && choicesKey(a) === choicesKey(b) && pricedKey(a) === pricedKey(b);

/** A line's price for its quantity, from one item's price. */
type Priced = (line: CartItem) => string;

/**
 * Add one item to the cart: onto a line it stacks with, or as a new line placed right after
 * `after` (where a split one came from), or last.
 */
export function placeOne(cart: CartItem[], one: CartItem, total: Priced, after?: number): CartItem[] {
  const joined = cart.findIndex((line) => stacksWith(line, one));
  if (joined > -1) {
    return cart.map((line, i) => {
      if (i !== joined) return line;
      const grown = { ...line, quantity: line.quantity + 1 };
      return { ...grown, lineSubtotal: total(grown) };
    });
  }
  const line = { ...one, quantity: 1 };
  const placed = { ...line, lineSubtotal: total(line) };
  if (after === undefined) return [...cart, placed];
  return [...cart.slice(0, after + 1), placed, ...cart.slice(after + 1)];
}

/**
 * Change one of a stacked line (`ONE`) or all of it (`ALL`). With one, the line gives up one
 * item, which takes the change and joins a matching line or sits right below its old one.
 * A change that leaves the item as it was does nothing.
 */
export function changeLine(
  cart: CartItem[],
  index: number,
  change: Partial<Pick<CartItem, 'selectedVariant' | 'selectedOptions' | 'notes' | 'hasChoices' | 'quote'>>,
  scope: 'ONE' | 'ALL',
  total: Priced
): CartItem[] {
  const line = cart[index];
  if (!line) return cart;
  const changed = { ...line, ...change };
  if (scope === 'ALL' || line.quantity <= 1) {
    return cart.map((l, i) => (i === index ? { ...changed, lineSubtotal: total(changed) } : l));
  }
  if (choicesKey(changed) === choicesKey(line) && (changed.notes || '') === (line.notes || '')) return cart;

  const smaller = { ...line, quantity: line.quantity - 1 };
  const rest = cart.map((l, i) => (i === index ? { ...smaller, lineSubtotal: total(smaller) } : l));
  return placeOne(rest, { ...changed, quantity: 1 }, total, index);
}
