import Decimal from 'decimal.js';

/**
 * How an aggregator's price follows the in-store one: a markup that covers its commission,
 * rounded up to a price a menu would print. Stored per channel in the CHANNEL_PRICING
 * setting, e.g. { SNAPPFOOD: { markup_percent: 15, round_to: 10000 } }.
 */
export interface ChannelPriceRule {
  markup_percent: number;
  round_to: number;
}

export const CHANNEL_PRICING_KEY = 'CHANNEL_PRICING';
export const DEFAULT_CHANNEL_RULE: ChannelPriceRule = { markup_percent: 0, round_to: 0 };

/** The rule for one channel out of the stored setting, with anything malformed read as none. */
export function readChannelRule(setting: unknown, channel: string): ChannelPriceRule {
  const raw = (setting && typeof setting === 'object' ? (setting as Record<string, any>)[channel] : null) || {};
  const markup = Number(raw.markup_percent);
  const roundTo = Number(raw.round_to);
  return {
    markup_percent: Number.isFinite(markup) ? markup : 0,
    round_to: Number.isFinite(roundTo) && roundTo > 0 ? roundTo : 0,
  };
}

/** The in-store price marked up and rounded up to the rule's step. Rial, 4 decimals. */
export function applyChannelRule(price: string | number, rule: ChannelPriceRule): string {
  let value = new Decimal(price || 0).mul(new Decimal(100).plus(rule.markup_percent || 0)).div(100);
  if (rule.round_to > 0) value = value.div(rule.round_to).ceil().mul(rule.round_to);
  return value.toFixed(4);
}
