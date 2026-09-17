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
  setCalendar: (value: { calendar?: string; weekStartsOn?: number } | null | undefined) => void;
};

export const useCalendarStore = create<CalendarState>((set) => ({
  calendar: 'JALALI',
  weekStartsOn: 6,
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

/** A timestamp's business day as the API's YYYY-MM-DD (always Gregorian digits). */
export function businessDate(value: Date | string | number = new Date()): string {
  const at = toDate(value) ?? new Date();
  return at.toLocaleDateString('en-CA', { timeZone: BUSINESS_TIME_ZONE });
}

/** Today's business day as YYYY-MM-DD. */
export function businessToday(): string {
  return businessDate(new Date());
}
