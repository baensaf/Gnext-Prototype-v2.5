import { applyChannelRule, readChannelRule } from '../src/common/utils/channel-price.util';

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
    expect(readChannelRule({ SNAPPFOOD: { markup_percent: '15', round_to: 10000 } }, 'SNAPPFOOD')).toEqual({ markup_percent: 15, round_to: 10000 });
    expect(readChannelRule(null, 'SNAPPFOOD')).toEqual({ markup_percent: 0, round_to: 0 });
    expect(readChannelRule({ SNAPPFOOD: { markup_percent: 'x', round_to: -5 } }, 'SNAPPFOOD')).toEqual({ markup_percent: 0, round_to: 0 });
  });
});
