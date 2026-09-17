/**
 * The clock the restaurants keep. The server's own zone is not it: production runs in a
 * container on UTC, where an order placed at 01:00 in Tehran belongs to yesterday.
 */
export const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || 'Asia/Tehran';

/**
 * Business date helpers.
 *
 * `new Date().toISOString().slice(0, 10)` yields the UTC date, which is not the
 * operating day anywhere east of Greenwich. In Tehran (UTC+3:30) every transaction
 * between local midnight and 03:30 would be stamped to the previous day, so a shift
 * opened in the evening and closed after midnight would straddle two business dates.
 *
 * These helpers resolve the date on the business clock (BUSINESS_TIME_ZONE), whatever
 * zone the server itself runs in.
 */
export class BusinessDateUtil {
  /** Today on the business clock, as YYYY-MM-DD (en-CA formats as an ISO date). */
  static today(now: Date = new Date()): string {
    return now.toLocaleDateString('en-CA', { timeZone: BUSINESS_TIME_ZONE });
  }

  /** The business-clock date of an arbitrary timestamp, as YYYY-MM-DD. */
  static fromDate(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-CA', { timeZone: BUSINESS_TIME_ZONE });
  }

  /** The instant a YYYY-MM-DD business day starts, on the business clock. */
  static startOfDay(date: string): Date {
    const [y, m, d] = date.slice(0, 10).split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d);
    return new Date(guess - BusinessDateUtil.offsetMs(new Date(guess)));
  }

  /** The last millisecond of a YYYY-MM-DD business day, on the business clock. */
  static endOfDay(date: string): Date {
    const [y, m, d] = date.slice(0, 10).split('-').map(Number);
    return new Date(BusinessDateUtil.startOfDay(new Date(Date.UTC(y, m - 1, d + 1)).toISOString()).getTime() - 1);
  }

  /** How far the business clock is ahead of UTC at an instant (+03:30 in Tehran). */
  private static offsetMs(at: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: BUSINESS_TIME_ZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return asUtc - Math.floor(at.getTime() / 1000) * 1000;
  }
}

/**
 * The operating day an order belongs to, as SQL. business_date is stamped at submit;
 * the fallback covers orders written before that existed so reports and day closes
 * bucket them identically instead of one silently dropping them. The fallback reads the
 * placement time on the business clock, not the database session's.
 *
 * Every query that reports on sales revenue MUST use this expression and
 * NON_REVENUE_ORDER_STATES together, or the figures will not cross-foot.
 */
export const ORDER_BUSINESS_DATE_EXPR = (alias: string) =>
  `COALESCE(${alias}.business_date, (${alias}.placed_at AT TIME ZONE '${BUSINESS_TIME_ZONE.replace(/'/g, '')}')::date::text)`;

/**
 * Order states that are not revenue: cancelled and rejected never counted, drafts were never
 * placed, and an incoming order awaiting acceptance may still be rejected or expire.
 */
export const NON_REVENUE_ORDER_STATES = ['CANCELLED', 'REJECTED', 'DRAFT', 'PENDING_ACCEPTANCE'];

/**
 * Keeps only orders that count as revenue.
 *
 * OrderHeader carries both `state` and `status` ("legacy alias for state"), and the
 * service layer writes both. Rows written directly against the repository — fixtures,
 * imports, older data — often set only one, leaving the other at its 'DRAFT' column
 * default. getOrders() already treats either column as able to vouch for an order
 * (`state = :x OR status = :x`), so an order is excluded only when BOTH columns agree
 * it is non-revenue. Excluding on either one alone silently drops completed orders whose
 * `state` was never populated, which empties the report rather than correcting it.
 */
export const REVENUE_ORDER_PREDICATE = (alias: string) =>
  `NOT (${alias}.state IN (:...nonRevenueStates) AND ${alias}.status IN (:...nonRevenueStates))`;
