import { hoursProblem, isOpenAt, OpeningHoursRow } from '../src/common/utils/opening-hours';

// Saturday is 6, Sunday 0 (JavaScript's numbering). Tehran is UTC+3:30, no daylight saving.
const shift = (day_of_week: number, open_time: string, close_time: string): OpeningHoursRow => ({
  day_of_week,
  open_time,
  close_time,
  is_closed: false,
});
const tehran = (local: string) => new Date(`${local}+03:30`);

describe('opening hours', () => {
  // Saturday 2026-10-03: lunch 11:00–15:00 and dinner 18:00 to Sunday 02:00. Friday closed.
  const week = [shift(6, '11:00', '15:00'), shift(6, '18:00', '02:00'), { ...shift(5, '00:00', '00:00'), is_closed: true }];

  it('is open inside a shift and closed between shifts', () => {
    expect(isOpenAt(week, tehran('2026-10-03T12:00:00'), 'Asia/Tehran')).toBe(true);
    expect(isOpenAt(week, tehran('2026-10-03T16:00:00'), 'Asia/Tehran')).toBe(false);
    expect(isOpenAt(week, tehran('2026-10-03T15:00:00'), 'Asia/Tehran')).toBe(false);
  });

  it('keeps a shift past midnight open into the next morning, then closes it', () => {
    expect(isOpenAt(week, tehran('2026-10-04T01:30:00'), 'Asia/Tehran')).toBe(true);
    expect(isOpenAt(week, tehran('2026-10-04T02:00:00'), 'Asia/Tehran')).toBe(false);
  });

  it('reads the clock in the branch time zone', () => {
    // 11:20 UTC is 14:50 in Tehran (still lunch) and 15:20 in Dubai (lunch is over).
    const at = new Date('2026-10-03T11:20:00Z');
    expect(isOpenAt(week, at, 'Asia/Tehran')).toBe(true);
    expect(isOpenAt(week, at, 'Asia/Dubai')).toBe(false);
  });

  it('treats equal times as the whole day and no hours as always open', () => {
    expect(isOpenAt([shift(1, '00:00', '00:00')], tehran('2026-10-05T03:00:00'), 'Asia/Tehran')).toBe(true);
    expect(isOpenAt([], tehran('2026-10-05T03:00:00'), 'Asia/Tehran')).toBe(true);
  });

  it('refuses overlapping shifts, and a late shift running into the next day', () => {
    expect(hoursProblem(week)).toBeNull();
    expect(hoursProblem([shift(1, '12:00', '16:00'), shift(1, '15:00', '23:00')])).toMatch('overlap');
    expect(hoursProblem([shift(6, '18:00', '02:00'), shift(0, '02:00', '15:00')])).toBeNull();
    expect(hoursProblem([shift(6, '18:00', '03:00'), shift(0, '02:00', '15:00')])).toMatch('runs into');
  });
});
