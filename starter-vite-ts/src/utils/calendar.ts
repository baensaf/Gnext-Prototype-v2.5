import { create } from 'zustand';

import i18n from 'src/locales/i18n';

// ----------------------------------------------------------------------

/**
 * The chain's calendar: Jalali unless head office switches it to Gregorian in the CALENDAR
 * setting. Dates are always read on the restaurants' clock (Tehran), whatever zone the
 * browser is in, so a till and head office agree on which day an order belongs to.
 */
export type CalendarSystem = 'JALALI' | 'GREGORIAN';

export const BUSINESS_TIME_ZONE = 'Asia/Tehran';

type CalendarState = {
  calendar: CalendarSystem;
  /** 0 = Sunday … 6 = Saturday. The Iranian week starts on Saturday. */
  weekStartsOn: number;
  /**
   * When the business day turns over (HH:MM), from the BUSINESS_DAY setting. A sale at 01:30
   * belongs to the day before. The server decides every stored date; this only picks the
   * "today" a screen starts on.
   */
  businessDayCutoff: string;
  setCalendar: (value: { calendar?: string; weekStartsOn?: number } | null | undefined) => void;
  setBusinessDay: (value: { cutoff?: string } | null | undefined) => void;
};

const DEFAULT_CUTOFF = '04:00';

export const useCalendarStore = create<CalendarState>((set) => ({
  calendar: 'JALALI',
  weekStartsOn: 6,
  businessDayCutoff: DEFAULT_CUTOFF,
  setBusinessDay: (value) =>
    set({
      businessDayCutoff:
        typeof value?.cutoff === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.cutoff) ? value.cutoff : DEFAULT_CUTOFF,
    }),
  setCalendar: (value) =>
    set({
      calendar: value?.calendar === 'GREGORIAN' ? 'GREGORIAN' : 'JALALI',
      weekStartsOn:
        Number.isInteger(value?.weekStartsOn) && value!.weekStartsOn! >= 0 && value!.weekStartsOn! <= 6
          ? value!.weekStartsOn!
          : 6,
    }),
}));

// ----------------------------------------------------------------------

type Part = 'year' | 'month' | 'day' | 'hour' | 'minute';

function parts(at: Date, wanted: Part[]): Record<Part, string> {
  const { calendar } = useCalendarStore.getState();
  const persian = i18n.language?.startsWith('fa');
  const locale = `${persian ? 'fa-IR' : 'en-US'}-u-ca-${calendar === 'JALALI' ? 'persian' : 'gregory'}-nu-${persian ? 'arabext' : 'latn'}`;
  const formatted = new Intl.DateTimeFormat(locale, {
    timeZone: BUSINESS_TIME_ZONE,
    hourCycle: 'h23',
    ...(wanted.includes('year') ? { year: 'numeric', month: '2-digit', day: '2-digit' } : {}),
    ...(wanted.includes('hour') ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).formatToParts(at);
  const get = (type: string) => formatted.find((p) => p.type === type)?.value || '';
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

function toDate(value: Date | string | number): Date | null {
  // A bare YYYY-MM-DD is a business day, not UTC midnight: read it as noon in Tehran so it
  // cannot slip into a neighbouring day.
  const d =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00+03:30`)
      : value instanceof Date
        ? value
        : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `1405/06/26`, or `2026/09/17` when the chain uses Gregorian. */
export function formatCalendarDate(value: Date | string | number): string {
  const at = toDate(value);
  if (!at) return '';
  const p = parts(at, ['year']);
  return `${p.year}/${p.month}/${p.day}`;
}

/** `14:05` on the business clock. */
export function formatCalendarTime(value: Date | string | number): string {
  const at = toDate(value);
  if (!at) return '';
  const p = parts(at, ['hour']);
  return `${p.hour}:${p.minute}`;
}

/** `1405/06/26 14:05`. */
export function formatCalendarDateTime(value: Date | string | number): string {
  const at = toDate(value);
  if (!at) return '';
  const p = parts(at, ['year', 'hour']);
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

/**
 * A timestamp's business day as the API's YYYY-MM-DD (always Gregorian digits): its date on
 * the business clock, less a day before the cutoff, so 01:30 belongs to the night before.
 */
export function businessDate(value: Date | string | number = new Date()): string {
  const at = toDate(value) ?? new Date();
  const [h, m] = useCalendarStore.getState().businessDayCutoff.split(':').map(Number);
  const f = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIME_ZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
  const clock = f.formatToParts(at);
  const minute = Number(clock.find((p) => p.type === 'hour')?.value) * 60 + Number(clock.find((p) => p.type === 'minute')?.value);
  const day = at.toLocaleDateString('en-CA', { timeZone: BUSINESS_TIME_ZONE });
  if (minute >= h * 60 + m) return day;
  const [y, mo, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d - 1)).toISOString().slice(0, 10);
}

/** Today's business day as YYYY-MM-DD. */
export function businessToday(): string {
  return businessDate(new Date());
}
