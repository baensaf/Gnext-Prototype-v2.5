import { BusinessDateUtil, ORDER_BUSINESS_DATE_EXPR } from '../src/common/utils/business-date.util';
import { formatBusinessDateTime } from '../src/common/utils/calendar.util';

// HAMI audit F2: the chain runs its day on Tehran's clock and reads dates in the Jalali calendar,
// whatever zone the server runs in (production is a UTC container).
describe('the business clock', () => {
  it("dates an order placed at 01:00 in Tehran to that Tehran day, not UTC's previous one", () => {
    // 2026-09-16 21:30 UTC is 2026-09-17 01:00 in Tehran.
    expect(BusinessDateUtil.today(new Date('2026-09-16T21:30:00Z'))).toBe('2026-09-17');
    expect(BusinessDateUtil.fromDate('2026-09-16T21:30:00Z')).toBe('2026-09-17');
    expect(BusinessDateUtil.fromDate('2026-09-16T20:29:00Z')).toBe('2026-09-16');
  });

  it("bounds a report day at Tehran's midnight", () => {
    expect(BusinessDateUtil.startOfDay('2026-09-17').toISOString()).toBe('2026-09-16T20:30:00.000Z');
    expect(BusinessDateUtil.endOfDay('2026-09-17').toISOString()).toBe('2026-09-17T20:29:59.999Z');
  });

  it("reads an old order's placement time on the business clock in SQL", () => {
    expect(ORDER_BUSINESS_DATE_EXPR('o')).toBe(`COALESCE(o.business_date, (o.placed_at AT TIME ZONE 'Asia/Tehran')::date::text)`);
  });

  it('prints dates in the Jalali calendar by default, and Gregorian when the chain chooses it', () => {
    const at = new Date('2026-09-16T21:30:00Z'); // 1405/06/26 01:00 in Tehran
    expect(formatBusinessDateTime(at)).toBe('1405/06/26 01:00');
    expect(formatBusinessDateTime(at, 'JALALI', true)).toBe('۱۴۰۵/۰۶/۲۶ ۰۱:۰۰');
    expect(formatBusinessDateTime(at, 'GREGORIAN')).toBe('2026/09/17 01:00');
  });
});
