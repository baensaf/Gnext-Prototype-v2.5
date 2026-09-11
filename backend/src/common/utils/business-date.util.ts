/**
 * Business date helpers.
 *
 * `new Date().toISOString().slice(0, 10)` yields the UTC date, which is not the
 * operating day anywhere east of Greenwich. In Tehran (UTC+3:30) every transaction
 * between local midnight and 03:30 would be stamped to the previous day, so a shift
 * opened in the evening and closed after midnight would straddle two business dates.
 *
 * These helpers resolve the date in the server's local timezone instead, which is the
 * timezone the terminal operator is working in.
 */
export class BusinessDateUtil {
  /** Local calendar date as YYYY-MM-DD (en-CA formats as an ISO date). */
  static today(now: Date = new Date()): string {
    return now.toLocaleDateString('en-CA');
  }

  /** Local calendar date of an arbitrary timestamp, as YYYY-MM-DD. */
  static fromDate(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-CA');
  }
}

/**
 * The operating day an order belongs to, as SQL. business_date is stamped at submit;
 * the fallback covers orders written before that existed so reports and day closes
 * bucket them identically instead of one silently dropping them.
 *
 * Every query that reports on sales revenue MUST use this expression and
 * NON_REVENUE_ORDER_STATES together, or the figures will not cross-foot.
 */
export const ORDER_BUSINESS_DATE_EXPR = (alias: string) =>
  `COALESCE(${alias}.business_date, ${alias}.placed_at::date::text)`;

/** Order states that are not revenue: cancelled and rejected never counted, drafts were never placed. */
export const NON_REVENUE_ORDER_STATES = ['CANCELLED', 'REJECTED', 'DRAFT'];

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
