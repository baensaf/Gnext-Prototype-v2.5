import {
  DEFAULT_CALL_NUMBER_RANGES,
  callNumberRangesFor,
  callNumberRangesProblem,
  callNumberSet,
  callNumberSettingToSave,
} from '../src/modules/order/call-number';

// O-39: ranges can't overlap, each ends at or above its start, and a change applies from the
// next business day.
describe('Call-number ranges', () => {
  const ranges = (onSite: [number, number], remote: [number, number]) => ({
    ranges: {
      ON_SITE: { start: onSite[0], end: onSite[1] },
      REMOTE: { start: remote[0], end: remote[1] },
    },
  });

  it('accepts ranges that count upwards and share no number', () => {
    expect(callNumberRangesProblem(ranges([100, 499], [500, 999]))).toBeNull();
  });

  it('refuses overlapping ranges and a range that counts down', () => {
    expect(callNumberRangesProblem(ranges([100, 550], [500, 999]))).toMatch(/overlap/);
    expect(callNumberRangesProblem(ranges([300, 200], [500, 999]))).toMatch(/ON_SITE/);
    expect(callNumberRangesProblem(ranges([0, 99], [500, 999]))).toMatch(/ON_SITE/);
  });

  it('keeps today on the ranges it started with and moves to the new ones the next day', () => {
    const saved = callNumberSettingToSave(undefined, ranges([1, 99], [500, 999]), '2026-10-26');
    expect(callNumberRangesFor(saved, '2026-10-26').ON_SITE).toEqual(DEFAULT_CALL_NUMBER_RANGES.ON_SITE);
    expect(callNumberRangesFor(saved, '2026-10-27').ON_SITE).toEqual({ start: 1, end: 99 });
  });

  it('keeps what today started with when the ranges change twice in a day', () => {
    const first = callNumberSettingToSave(undefined, ranges([1, 99], [500, 999]), '2026-10-26');
    const second = callNumberSettingToSave(first, ranges([100, 399], [500, 999]), '2026-10-26');
    expect(callNumberRangesFor(second, '2026-10-26').ON_SITE).toEqual(DEFAULT_CALL_NUMBER_RANGES.ON_SITE);
    expect(callNumberRangesFor(second, '2026-10-27').ON_SITE).toEqual({ start: 100, end: 399 });
  });

  // O-42: the set follows how the order leaves, not where it was rung up.
  it.each([
    ['DINE_IN', null, 'ON_SITE'],
    ['TAKEAWAY', null, 'ON_SITE'],
    ['PICKUP', null, 'ON_SITE'],
    ['DELIVERY', null, 'REMOTE'],
    ['AGGREGATOR', null, 'REMOTE'],
    ['AGGREGATOR', 'DELIVERY', 'REMOTE'],
    ['AGGREGATOR', 'EXPRESS', 'REMOTE'],
    ['AGGREGATOR', 'PICKUP', 'ON_SITE'],
  ])('puts a %s order with expedition %s in %s', (order_type, aggregator_expedition, expected) => {
    expect(callNumberSet({ order_type, aggregator_expedition } as any)).toBe(expected);
  });
});
