import { BUSINESS_TIME_ZONE } from './business-date.util';

/**
 * The business day: the operating day a sale, a payment, a shift or a call number belongs to.
 *
 * A restaurant open 08:00 to 04:00 does not start a new day at midnight. Its day ends at the
 * cutoff (04:00 by default), so a sale at 01:30 on the 25th belongs to the 24th and one at
 * 04:00 belongs to the 25th. Head office sets the cutoff and the opening hours once for the
 * chain (setting group BUSINESS_DAY); a branch may override them. The cutoff is read on the
 * branch's own clock, so two branches in different time zones each turn over at their own 04:00.
 *
 * A date is decided once, when the thing happens, and stored. Nothing here re-dates what is
 * already stored: a changed cutoff or time zone applies from the moment it changes, and the
 * branch keeps the rules it ran under before (its timeline) so the clock never runs backwards.
 */
export const BUSINESS_DAY_SETTING_KEY = 'BUSINESS_DAY';

export const DEFAULT_BUSINESS_DAY = {
  cutoff: '04:00',
  opensAt: '08:00',
  closesAt: '04:00',
  autoClose: true,
};

/** A cutoff after noon would date the evening's trade to the next morning's day. */
export const LATEST_CUTOFF = '12:00';

export interface BusinessDayConfig {
  /** When one business day ends and the next begins, HH:MM on the branch's clock. */
  cutoff: string;
  /** Operating hours: shown to staff, not enforced. closesAt may run past midnight up to the cutoff. */
  opensAt: string;
  closesAt: string;
  /** Close the previous business day by itself once its shifts are reconciled. */
  autoClose: boolean;
}

/**
 * One rule a branch's day has run under. `at` is the instant it took over (null for the first);
 * `from` is the date the old rule gave at that instant, which the new rule may not undercut.
 */
export interface BusinessDayRule {
  cutoff: string;
  time_zone: string;
  at: string | null;
  from: string | null;
}

/** Kept on the branch: the rules it has run under, and the first day it was run this way. */
export interface BusinessDayTimeline {
  since: string | null;
  rules: BusinessDayRule[];
}

export interface BusinessDayPolicy extends BusinessDayConfig {
  timeZone: string;
  /** Oldest first; the last is the rule in force now. Never empty. */
  rules: BusinessDayRule[];
  /** The first business day auto-close may act on; earlier days are left as they were. */
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

/** Minutes after the cutoff, with the cutoff itself as the end of the day (1440). */
function sinceCutoff(hhmm: string, cutoff: string, endOfDay: boolean): number {
  const m = (toMinutes(hhmm) - toMinutes(cutoff) + 1440) % 1440;
  return endOfDay && m === 0 ? 1440 : m;
}

/** Why a BUSINESS_DAY setting value is unacceptable, or null when it is fine. */
export function businessDaySettingProblem(value: Record<string, any>): string | null {
  for (const prop of ['cutoff', 'opensAt', 'closesAt']) {
    if (value[prop] !== undefined && !isHhMm(value[prop])) return `BUSINESS_DAY setting property ${prop} must be a time written HH:MM`;
  }
  if (value.autoClose !== undefined && typeof value.autoClose !== 'boolean') {
    return 'BUSINESS_DAY setting property autoClose must be a boolean';
  }
  const config = { ...DEFAULT_BUSINESS_DAY, ...pickConfig(value) };
  if (toMinutes(config.cutoff) >= toMinutes(LATEST_CUTOFF)) {
    return `BUSINESS_DAY cutoff must be before ${LATEST_CUTOFF}: the business day is named after the morning it opens`;
  }
  if (sinceCutoff(config.opensAt, config.cutoff, false) >= sinceCutoff(config.closesAt, config.cutoff, true)) {
    return `BUSINESS_DAY opening hours ${config.opensAt}–${config.closesAt} must fall inside one business day, which ends at ${config.cutoff}`;
  }
  return null;
}

function pickConfig(value: Record<string, any> | null | undefined): Partial<BusinessDayConfig> {
  const out: Partial<BusinessDayConfig> = {};
  if (!value || typeof value !== 'object') return out;
  if (isHhMm(value.cutoff)) out.cutoff = value.cutoff;
  if (isHhMm(value.opensAt)) out.opensAt = value.opensAt;
  if (isHhMm(value.closesAt)) out.closesAt = value.closesAt;
  if (typeof value.autoClose === 'boolean') out.autoClose = value.autoClose;
  return out;
}

/** A stored value as a whole config: anything missing or unreadable takes the default. */
export function readBusinessDayConfig(value: Record<string, any> | null | undefined): BusinessDayConfig {
  const config = { ...DEFAULT_BUSINESS_DAY, ...pickConfig(value) };
  if (toMinutes(config.cutoff) >= toMinutes(LATEST_CUTOFF)) config.cutoff = DEFAULT_BUSINESS_DAY.cutoff;
  return config;
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

/** The date a single rule gives an instant: the local date, less one before the cutoff. */
function dateUnderRule(at: Date, rule: BusinessDayRule): string {
  const { date, minute } = wallClock(at, rule.time_zone);
  return minute < toMinutes(rule.cutoff) ? addDays(date, -1) : date;
}

/**
 * A branch's business clock. Every date it gives is non-decreasing in time, which is what lets
 * a day's first and last instants be found by search rather than by case analysis of rule changes.
 */
export class BusinessClock {
  constructor(readonly policy: BusinessDayPolicy) {}

  static fromConfig(config: Partial<BusinessDayConfig> = {}, timeZone: string = BUSINESS_TIME_ZONE): BusinessClock {
    const full = { ...DEFAULT_BUSINESS_DAY, ...config };
    return new BusinessClock({
      ...full,
      timeZone,
      rules: [{ cutoff: full.cutoff, time_zone: timeZone, at: null, from: null }],
      since: null,
    });
  }

  /** The business date an instant belongs to, YYYY-MM-DD. */
  dateAt(value: Date | string | number): string {
    const at = toDate(value);
    const rules = this.policy.rules;
    for (let i = rules.length - 1; i > 0; i--) {
      const rule = rules[i];
      if (rule.at && at.getTime() < Date.parse(rule.at)) continue;
      const date = dateUnderRule(at, rule);
      if (rule.from && date < rule.from) continue;
      return date;
    }
    return dateUnderRule(at, rules[0]);
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

  /** The first instant of a business day (its cutoff, on the branch's clock). */
  startOf(date: string): Date {
    const day = date.slice(0, 10);
    const [y, m, d] = day.split('-').map(Number);
    // Every rule's day starts within a day and a half of that date's UTC midnight.
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

  /** When the branch opens and closes on a business day, as instants. */
  hoursOf(date: string): { opensAt: Date; closesAt: Date } {
    const start = this.startOf(date).getTime();
    const { cutoff, opensAt, closesAt } = this.policy;
    return {
      opensAt: new Date(start + sinceCutoff(opensAt, cutoff, false) * 60_000),
      closesAt: new Date(start + sinceCutoff(closesAt, cutoff, true) * 60_000),
    };
  }

  /** Whether `at` falls inside the operating hours of its business day. */
  isOpen(at: Date = new Date()): boolean {
    const { opensAt, closesAt } = this.hoursOf(this.dateAt(at));
    return at >= opensAt && at < closesAt;
  }

  /** What the screens need to say which day it is and when it turns over. */
  describe(now: Date = new Date()) {
    const businessDate = this.today(now);
    const { opensAt, closesAt } = this.hoursOf(businessDate);
    return {
      businessDate,
      startsAt: this.startOf(businessDate).toISOString(),
      endsAt: new Date(this.endOf(businessDate).getTime() + 1).toISOString(),
      opensAt: opensAt.toISOString(),
      closesAt: closesAt.toISOString(),
      isOpen: now >= opensAt && now < closesAt,
      cutoff: this.policy.cutoff,
      operatingHours: { opensAt: this.policy.opensAt, closesAt: this.policy.closesAt },
      timeZone: this.policy.timeZone,
      autoClose: this.policy.autoClose,
    };
  }
}

/**
 * The timeline a branch runs under once its rule becomes `next`, changed at `now`. The old rule
 * keeps every instant before `now`; from `now` the new one applies, but never gives a date
 * earlier than the one the old rule was already on, so a cutoff moved later cannot send the
 * branch back to yesterday in the middle of service.
 */
export function timelineAfterChange(
  current: BusinessClock,
  next: { cutoff: string; time_zone: string },
  now: Date,
  since: string | null,
): BusinessDayTimeline {
  const rules = current.policy.rules;
  const last = rules[rules.length - 1];
  if (last.cutoff === next.cutoff && last.time_zone === next.time_zone) {
    return { since, rules };
  }
  return {
    since,
    rules: [...rules, { cutoff: next.cutoff, time_zone: next.time_zone, at: now.toISOString(), from: current.dateAt(now) }],
  };
}

/** A stored timeline, if it is one; anything unreadable is ignored rather than trusted. */
export function readTimeline(value: any): BusinessDayTimeline | null {
  if (!value || typeof value !== 'object' || !Array.isArray(value.rules)) return null;
  const rules = value.rules.filter(
    (r: any) =>
      r &&
      isHhMm(r.cutoff) &&
      isTimeZone(r.time_zone) &&
      (r.at === null || r.at === undefined || !Number.isNaN(Date.parse(r.at))) &&
      (r.from === null || r.from === undefined || isBusinessDate(r.from)),
  );
  if (!rules.length) return null;
  return {
    since: isBusinessDate(value.since) ? value.since : null,
    rules: rules.map((r: any) => ({ cutoff: r.cutoff, time_zone: r.time_zone, at: r.at ?? null, from: r.from ?? null })),
  };
}

/**
 * The policy for a branch: its configured rule and time zone, run through the timeline it has
 * kept. A configured rule the timeline has not recorded (a row written straight to the
 * database) simply applies.
 */
export function policyFor(config: BusinessDayConfig, timeZone: string, timeline: BusinessDayTimeline | null, createdAt?: Date | string | null): BusinessDayPolicy {
  const rules: BusinessDayRule[] = timeline?.rules?.length
    ? [...timeline.rules]
    : [{ cutoff: config.cutoff, time_zone: timeZone, at: null, from: null }];
  const last = rules[rules.length - 1];
  if (last.cutoff !== config.cutoff || last.time_zone !== timeZone) {
    rules.push({ cutoff: config.cutoff, time_zone: timeZone, at: null, from: null });
  }
  const policy: BusinessDayPolicy = { ...config, timeZone, rules, since: timeline?.since ?? null };
  if (!policy.since && createdAt) policy.since = new BusinessClock(policy).dateOf(createdAt);
  return policy;
}
