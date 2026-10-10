import { BUSINESS_TIME_ZONE } from './business-date.util';

/**
 * The business day: the operating day a sale, a payment, a shift or a call number belongs to.
 *
 * A restaurant open 11:00 to 04:00 does not start a new day at midnight. Its day ends at the
 * cutoff (05:00 by default, after the latest closing time), so a sale at 01:30 on the 25th
 * belongs to the 24th and one at 05:00 belongs to the 25th. Head office sets the cutoff once for
 * the whole chain (setting group BUSINESS_DAY). It is read on each branch's own clock, so two
 * branches in different time zones each turn over at their own 05:00.
 *
 * A date is decided once, when the thing happens, and stored. A changed cutoff applies from the
 * moment it is saved and never re-dates what is already stored. Like Toast's closeout hour or
 * Lightspeed's business day it is set once and rarely touched, best while the shops are shut.
 */
export const BUSINESS_DAY_SETTING_KEY = 'BUSINESS_DAY';

export const DEFAULT_BUSINESS_DAY = {
  cutoff: '05:00',
};

/** A cutoff after noon would date the evening's trade to the next morning's day. */
export const LATEST_CUTOFF = '12:00';

export interface BusinessDayConfig {
  /** When one business day ends and the next begins, HH:MM on the branch's clock. */
  cutoff: string;
}

export interface BusinessDayPolicy extends BusinessDayConfig {
  timeZone: string;
  /** The branch's first business day; auto-close never reaches before it. */
  since: string | null;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isHhMm(value: unknown): value is string {
  return typeof value === 'string' && HHMM.test(value);
}

export function isBusinessDate(value: unknown): value is string {
  return typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Why a BUSINESS_DAY setting value is unacceptable, or null when it is fine. */
export function businessDaySettingProblem(value: Record<string, any>): string | null {
  if (value.cutoff === undefined) return null;
  if (!isHhMm(value.cutoff)) return 'BUSINESS_DAY setting property cutoff must be a time written HH:MM';
  if (toMinutes(value.cutoff) >= toMinutes(LATEST_CUTOFF)) {
    return `BUSINESS_DAY cutoff must be before ${LATEST_CUTOFF}: the business day is named after the morning it opens`;
  }
  return null;
}

/** A stored value as a whole config: anything missing or unreadable takes the default. */
export function readBusinessDayConfig(value: Record<string, any> | null | undefined): BusinessDayConfig {
  const cutoff = value?.cutoff;
  return {
    cutoff: isHhMm(cutoff) && toMinutes(cutoff) < toMinutes(LATEST_CUTOFF) ? cutoff : DEFAULT_BUSINESS_DAY.cutoff,
  };
}

// ─── Wall clock arithmetic ──────────────────────────────────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The date and minute of the day that the clocks in `timeZone` show at `at`. */
export function wallClock(at: Date, timeZone: string): { date: string; minute: number } {
  const parts = formatter(timeZone).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** A branch's business clock: the chain's cutoff on the branch's own time zone. */
export class BusinessClock {
  constructor(readonly policy: BusinessDayPolicy) {}

  static fromConfig(config: Partial<BusinessDayConfig> = {}, timeZone: string = BUSINESS_TIME_ZONE): BusinessClock {
    return new BusinessClock({ ...readBusinessDayConfig(config), timeZone, since: null });
  }

  /** The business date an instant belongs to, YYYY-MM-DD: the local date, less one before the cutoff. */
  dateAt(value: Date | string | number): string {
    const { date, minute } = wallClock(toDate(value), this.policy.timeZone);
    return minute < toMinutes(this.policy.cutoff) ? addDays(date, -1) : date;
  }

  /** The business date of a stored timestamp, or null when there is none. */
  dateOf(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    const at = toDate(value);
    return Number.isNaN(at.getTime()) ? null : this.dateAt(at);
  }

  today(now: Date = new Date()): string {
    return this.dateAt(now);
  }

  /**
   * The first instant of a business day (its cutoff, on the branch's clock). Found by search on
   * dateAt rather than by offset arithmetic, so a daylight-saving change on the day, or a cutoff
   * the clocks skip, needs no special case.
   */
  startOf(date: string): Date {
    const day = date.slice(0, 10);
    const [y, m, d] = day.split('-').map(Number);
    let lo = Date.UTC(y, m - 1, d) - 36 * 3600_000;
    let hi = Date.UTC(y, m - 1, d) + 36 * 3600_000;
    while (this.dateAt(lo) >= day) lo -= 24 * 3600_000;
    while (this.dateAt(hi) < day) hi += 24 * 3600_000;
    // Invariant: dateAt(lo) < day <= dateAt(hi).
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.dateAt(mid) >= day) hi = mid;
      else lo = mid;
    }
    return new Date(hi);
  }

  /** The last millisecond of a business day. */
  endOf(date: string): Date {
    return new Date(this.startOf(addDays(date, 1)).getTime() - 1);
  }

  /** What the screens need to say which day it is and when it turns over. */
  describe(now: Date = new Date()) {
    const businessDate = this.today(now);
    return {
      businessDate,
      startsAt: this.startOf(businessDate).toISOString(),
      endsAt: new Date(this.endOf(businessDate).getTime() + 1).toISOString(),
      cutoff: this.policy.cutoff,
      timeZone: this.policy.timeZone,
    };
  }
}
