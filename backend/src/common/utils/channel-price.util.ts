import Decimal from 'decimal.js';

/**
 * How an aggregator's price follows the in-store one: a markup that covers its commission,
 * rounded up to a price a menu would print. Stored per channel in the CHANNEL_PRICING
 * setting, e.g. { SNAPPFOOD: { markup_percent: 15, round_to: 10000 } }.
 */
export interface ChannelPriceRule {
  markup_percent: number;
  round_to: number;
  /**
   * The "fake" discount the channel's menu shows (V3, 2026-10-03): the price stays what the
   * customer pays, and the menu also prints a struck-through price this much higher. Nothing
   * is taken off the bill. 0 shows none. Items can override it in `item_display_discounts`.
   */
  display_discount_percent: number;
  /** Per item, keyed `productId:variantId` (empty after the colon for none); 0 turns it off. */
  item_display_discounts: Record<string, number>;
}

/** The most a shown discount can be: a struck-through price ten times the real one isn't believable. */
export const MAX_DISPLAY_DISCOUNT = 90;

export const CHANNEL_PRICING_KEY = 'CHANNEL_PRICING';
export const DEFAULT_CHANNEL_RULE: ChannelPriceRule = { markup_percent: 0, round_to: 0, display_discount_percent: 0, item_display_discounts: {} };

const percentOrZero = (raw: unknown) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_DISPLAY_DISCOUNT) : 0;
};

/** The rule for one channel out of the stored setting, with anything malformed read as none. */
export function readChannelRule(setting: unknown, channel: string): ChannelPriceRule {
  const raw = (setting && typeof setting === 'object' ? (setting as Record<string, any>)[channel] : null) || {};
  const markup = Number(raw.markup_percent);
  const roundTo = Number(raw.round_to);
  const items: Record<string, number> = {};
  if (raw.item_display_discounts && typeof raw.item_display_discounts === 'object') {
    for (const [key, value] of Object.entries(raw.item_display_discounts)) {
      if (value !== null && value !== undefined && value !== '') items[key] = percentOrZero(value);
    }
  }
  return {
    markup_percent: Number.isFinite(markup) ? markup : 0,
    round_to: Number.isFinite(roundTo) && roundTo > 0 ? roundTo : 0,
    display_discount_percent: percentOrZero(raw.display_discount_percent),
    item_display_discounts: items,
  };
}

/** The in-store price marked up and rounded up to the rule's step. Rial, 4 decimals. */
export function applyChannelRule(price: string | number, rule: Pick<ChannelPriceRule, 'markup_percent' | 'round_to'>): string {
  let value = new Decimal(price || 0).mul(new Decimal(100).plus(rule.markup_percent || 0)).div(100);
  if (rule.round_to > 0) value = value.div(rule.round_to).ceil().mul(rule.round_to);
  return value.toFixed(4);
}

/** The shown discount for one item: its own, else the channel's default. */
export function displayDiscountFor(rule: ChannelPriceRule, productId: string, variantId: string | null): number {
  const own = rule.item_display_discounts[`${productId}:${variantId || ''}`];
  return own !== undefined ? own : rule.display_discount_percent;
}

/**
 * The struck-through "before" price for a shown discount: the price it would be p% off of,
 * rounded up to the rule's step, so the discount shown is at least p%. Null for none.
 */
export function beforeDiscountPrice(price: string | number, percent: number, roundTo: number): string | null {
  if (!(percent > 0) || new Decimal(price || 0).lte(0)) return null;
  let value = new Decimal(price).mul(100).div(new Decimal(100).minus(Math.min(percent, MAX_DISPLAY_DISCOUNT)));
  value = roundTo > 0 ? value.div(roundTo).ceil().mul(roundTo) : value.ceil();
  return value.toFixed(4);
}
