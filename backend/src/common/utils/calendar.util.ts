import { BUSINESS_TIME_ZONE } from './business-date.util';

/** The chain's calendar, set by head office in the CALENDAR setting group. Jalali unless changed. */
export type CalendarSystem = 'JALALI' | 'GREGORIAN';

export const CALENDAR_SETTING_KEY = 'CALENDAR';

export const DEFAULT_CALENDAR_SETTING = { calendar: 'JALALI' as CalendarSystem, weekStartsOn: 6 };

export function readCalendar(value: any): CalendarSystem {
  return value?.calendar === 'GREGORIAN' ? 'GREGORIAN' : 'JALALI';
}

/**
 * A timestamp as staff read it on paper: `1405/06/26 14:05` on the business clock, in the
 * chain's calendar. Persian digits when printing in Persian.
 */
export function formatBusinessDateTime(
  value: Date | string | number,
  calendar: CalendarSystem = 'JALALI',
  persianDigits = false,
): string {
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  const locale = `${persianDigits ? 'fa-IR' : 'en-US'}-u-ca-${calendar === 'JALALI' ? 'persian' : 'gregory'}-nu-${persianDigits ? 'arabext' : 'latn'}`;
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
}
