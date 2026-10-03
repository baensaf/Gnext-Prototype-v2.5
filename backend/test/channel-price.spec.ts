import { applyChannelRule, readChannelRule, displayDiscountFor, beforeDiscountPrice } from '../src/common/utils/channel-price.util';

const none = { display_discount_percent: 0, item_display_discounts: {} };

describe('Aggregator markup rule', () => {
  it('marks the in-store price up and rounds up to the step', () => {
    // 150,000 + 15% = 172,500, up to the next 10,000 Rial.
    expect(applyChannelRule('150000.0000', { markup_percent: 15, round_to: 10000 })).toBe('180000.0000');
    expect(applyChannelRule('100000', { markup_percent: 20, round_to: 10000 })).toBe('120000.0000');
  });

  it('leaves the price alone with no rule', () => {
    expect(applyChannelRule('142350', { markup_percent: 0, round_to: 0 })).toBe('142350.0000');
  });

  it('reads a channel out of the setting and treats anything malformed as no rule', () => {
    expect(readChannelRule({ SNAPPFOOD: { markup_percent: '15', round_to: 10000 } }, 'SNAPPFOOD')).toEqual({ markup_percent: 15, round_to: 10000, ...none });
    expect(readChannelRule(null, 'SNAPPFOOD')).toEqual({ markup_percent: 0, round_to: 0, ...none });
    expect(readChannelRule({ SNAPPFOOD: { markup_percent: 'x', round_to: -5 } }, 'SNAPPFOOD')).toEqual({ markup_percent: 0, round_to: 0, ...none });
  });
});

// The "fake" discount (V3, 2026-10-03): the menu shows a struck-through price; the bill is
// the real price.
describe('Shown discount on a channel menu', () => {
  const rule = readChannelRule(
    { SNAPPFOOD: { markup_percent: 0, round_to: 10000, display_discount_percent: 20, item_display_discounts: { 'p-2:': 0, 'p-3:v-1': '30', 'p-4:': 500 } } },
    'SNAPPFOOD',
  );

  it('uses the channel default unless the item has its own, and 0 turns it off', () => {
    expect(displayDiscountFor(rule, 'p-1', null)).toBe(20);
    expect(displayDiscountFor(rule, 'p-2', null)).toBe(0);
    expect(displayDiscountFor(rule, 'p-3', 'v-1')).toBe(30);
    expect(displayDiscountFor(rule, 'p-3', null)).toBe(20);
    // Capped at 90%.
    expect(displayDiscountFor(rule, 'p-4', null)).toBe(90);
  });

  it('prints the price it would be that much off, rounded up so the discount is at least that', () => {
    // 2,000,000 is 20% off 2,500,000.
    expect(beforeDiscountPrice('2000000', 20, 10000)).toBe('2500000.0000');
    // 1,800,000 / 0.7 = 2,571,428.57 → 2,580,000.
    expect(beforeDiscountPrice('1800000', 30, 10000)).toBe('2580000.0000');
    expect(beforeDiscountPrice('1800000', 30, 0)).toBe('2571429.0000');
  });

  it('shows nothing for no discount or a free item', () => {
    expect(beforeDiscountPrice('2000000', 0, 10000)).toBeNull();
    expect(beforeDiscountPrice('0', 20, 10000)).toBeNull();
  });
});
