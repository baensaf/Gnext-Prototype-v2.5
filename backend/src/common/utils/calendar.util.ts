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

/**
 * A Jalali date (`1405/08/27`, `1405-8-27`, Persian digits allowed) as the business date the
 * system stores, `2026-11-18`. Null when it is not a real Jalali date.
 */
export function jalaliToBusinessDate(text: string): string | null {
  const western = String(text || '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const m = western.trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return null;
  const [jy, jm, jd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > (jm <= 6 ? 31 : 30)) return null;

  // The arithmetic of jalaali-js (jalCal-free form), exact for 1300–1500.
  let days = -355668 + 365 * (jy + 1595) + Math.floor((jy + 1595) / 33) * 8 + Math.floor((((jy + 1595) % 33) + 3) / 4) + jd
    + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    days -= 1;
    gy += 100 * Math.floor(days / 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  while (gm < 12 && gd > monthDays[gm]) gd -= monthDays[gm++];
  return `${gy}-${String(gm + 1).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
}
