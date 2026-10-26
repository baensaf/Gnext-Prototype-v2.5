import {
  DEFAULT_CALL_NUMBER_RANGES,
  callNumberRangesFor,
  callNumberRangesProblem,
  callNumberSettingToSave,
} from '../src/modules/order/call-number';

// O-39: ranges can't overlap, each ends at or above its start, and a change applies from the
// next business day.
describe('Call-number ranges', () => {
  const ranges = (pos: [number, number], kiosk: [number, number], online: [number, number]) => ({
    ranges: {
      POS: { start: pos[0], end: pos[1] },
      KIOSK: { start: kiosk[0], end: kiosk[1] },
      ONLINE: { start: online[0], end: online[1] },
    },
  });

  it('accepts ranges that count upwards and share no number', () => {
    expect(callNumberRangesProblem(ranges([100, 399], [400, 499], [500, 599]))).toBeNull();
  });

  it('refuses overlapping ranges and a range that counts down', () => {
    expect(callNumberRangesProblem(ranges([100, 450], [400, 499], [500, 599]))).toMatch(/overlap/);
    expect(callNumberRangesProblem(ranges([300, 200], [400, 499], [500, 599]))).toMatch(/POS/);
    expect(callNumberRangesProblem(ranges([0, 99], [400, 499], [500, 599]))).toMatch(/POS/);
  });

  it('keeps today on the ranges it started with and moves to the new ones the next day', () => {
    const saved = callNumberSettingToSave(undefined, ranges([1, 99], [400, 499], [500, 599]), '2026-10-26');
    expect(callNumberRangesFor(saved, '2026-10-26').POS).toEqual(DEFAULT_CALL_NUMBER_RANGES.POS);
    expect(callNumberRangesFor(saved, '2026-10-27').POS).toEqual({ start: 1, end: 99 });
  });

  it('keeps what today started with when the ranges change twice in a day', () => {
    const first = callNumberSettingToSave(undefined, ranges([1, 99], [400, 499], [500, 599]), '2026-10-26');
    const second = callNumberSettingToSave(first, ranges([600, 899], [400, 499], [500, 599]), '2026-10-26');
    expect(callNumberRangesFor(second, '2026-10-26').POS).toEqual(DEFAULT_CALL_NUMBER_RANGES.POS);
    expect(callNumberRangesFor(second, '2026-10-27').POS).toEqual({ start: 600, end: 899 });
  });
});
