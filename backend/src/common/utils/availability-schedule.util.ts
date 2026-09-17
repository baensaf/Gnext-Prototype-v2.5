/** A selling window as the schedule stores it. */
export interface ScheduleWindow {
  days_of_week: string;
  start_time: string;
  end_time: string;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string): boolean {
  return TIME.test(value);
}

export function parseDays(days: string): number[] {
  return String(days || '')
    .split(',')
    .filter((d) => d.trim() !== '')
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** The weekday (0 = Sunday) and minute of the day at `at`, on the given zone's clock. */
export function localClock(at: Date, timeZone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

/**
 * Whether `at` falls inside the window. A window that ends at or before its start runs past
 * midnight into the next day, and belongs to the day it opened on; equal times are all day.
 */
export function windowIsOpen(window: ScheduleWindow, at: Date, timeZone: string): boolean {
  const { day, minute } = localClock(at, timeZone);
  const days = parseDays(window.days_of_week);
  const start = minutes(window.start_time);
  const end = minutes(window.end_time);
  if (start === end) return days.includes(day);
  if (start < end) return days.includes(day) && minute >= start && minute < end;
  const yesterday = (day + 6) % 7;
  return (days.includes(day) && minute >= start) || (days.includes(yesterday) && minute < end);
}

/** No windows: always on sale. Otherwise on sale inside any one of them. */
export function isOnSchedule(windows: ScheduleWindow[], at: Date, timeZone: string): boolean {
  return windows.length === 0 || windows.some((w) => windowIsOpen(w, at, timeZone));
}

/** "07:00–11:00", or several joined, for a message a cashier reads. */
export function describeWindows(windows: ScheduleWindow[]): string {
  return windows.map((w) => `${w.start_time}–${w.end_time}`).join(', ');
}
