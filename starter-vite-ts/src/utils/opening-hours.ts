import type { BranchOperatingHour } from 'src/api/tenantApi';

// A branch's weekly opening hours, as the screens edit them, and whether it is open now.
// The server reads the same rules (backend common/utils/opening-hours.ts): a shift that closes
// at or before it opens runs past midnight and belongs to the day it opened on; equal times
// are the whole day; a shift ends just before its closing minute; no hours at all is closed.

/** Iran's week, Saturday first. `day` is JavaScript's day number (0 = Sunday), as stored. */
export const WEEK = [
  { key: 'saturday', day: 6 },
  { key: 'sunday', day: 0 },
  { key: 'monday', day: 1 },
  { key: 'tuesday', day: 2 },
  { key: 'wednesday', day: 3 },
  { key: 'thursday', day: 4 },
  { key: 'friday', day: 5 },
] as const;

export type DayKey = (typeof WEEK)[number]['key'];

/** One opening window, HH:MM. */
export type Shift = { open: string; close: string };

/** A day's shifts; none means closed that day. */
export type WeekHours = Record<number, Shift[]>;

export const DEFAULT_SHIFT: Shift = { open: '11:00', close: '23:00' };

/** Every day 11:00–23:00, what a new branch starts from. */
export const defaultWeek = (): WeekHours =>
  Object.fromEntries(WEEK.map(({ day }) => [day, [{ ...DEFAULT_SHIFT }]])) as WeekHours;

const hhmm = (time: string | null | undefined) => String(time || '00:00').slice(0, 5);

const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** True when the shift runs past midnight into the next day. */
export const runsPastMidnight = (shift: Shift) => toMinutes(shift.close) <= toMinutes(shift.open);

/** A shift as minutes from its day's midnight; `end` passes 1440 when it runs past midnight. */
const span = (shift: Shift) => {
  const start = toMinutes(shift.open);
  const close = toMinutes(shift.close);
  return { start, end: close <= start ? close + 1440 : close };
};

/**
 * The stored rows as a week, read as the server reads them: a day without shifts is closed,
 * and so is every day of a branch with no hours at all. Missing hours never mean "always open".
 */
export function weekFromRows(rows: BranchOperatingHour[]): WeekHours {
  const week: WeekHours = {};
  for (const { day } of WEEK) {
    week[day] = rows
      .filter((r) => r.day_of_week === day)
      .filter((r) => !r.is_closed)
      .map((r) => ({ open: hhmm(r.open_time), close: hhmm(r.close_time) }))
      .sort((a, b) => a.open.localeCompare(b.open));
  }
  return week;
}

/** The week as the server takes it: one row per shift, one closed row for a day with none. */
export function rowsFromWeek(week: WeekHours) {
  return WEEK.flatMap(({ day }) => {
    const shifts = week[day] || [];
    return shifts.length
      ? shifts.map((s) => ({ day_of_week: day, open_time: s.open, close_time: s.close, is_closed: false }))
      : [{ day_of_week: day, is_closed: true }];
  });
}

/** What is wrong with a day's shifts, by day; empty when the week can be saved. */
export function weekProblems(week: WeekHours): Partial<Record<number, 'overlap' | 'runsIntoNextDay'>> {
  const problems: Partial<Record<number, 'overlap' | 'runsIntoNextDay'>> = {};
  for (const { day } of WEEK) {
    const today = (week[day] || []).map(span).sort((a, b) => a.start - b.start);
    for (let i = 1; i < today.length; i++) {
      if (today[i].start < today[i - 1].end) problems[day] = 'overlap';
    }
    const last = today[today.length - 1];
    if (!problems[day] && last && last.end > 1440) {
      const tomorrow = (week[(day + 1) % 7] || []).map(span);
      if (tomorrow.some((s) => s.start < last.end - 1440)) problems[day] = 'runsIntoNextDay';
    }
  }
  return problems;
}

/** The weekday and minute of `at` on a branch's clock. */
function localClock(at: Date, timeZone: string) {
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

export type OpenStatus =
  | { open: true; allDay: boolean; until?: string }
  | { open: false; opensDay?: DayKey; opensAt?: string; never?: boolean };

/**
 * Whether the branch is open at `at` and, if not, when it next opens. `rows` are the stored
 * hours; a branch with none is closed every day.
 */
export function openStatus(rows: BranchOperatingHour[], timeZone: string, at: Date = new Date()): OpenStatus {
  const week = weekFromRows(rows);
  const { day, minute } = localClock(at, timeZone || 'Asia/Tehran');
  const yesterday = (day + 6) % 7;

  const current = [
    ...(week[day] || []).map((s) => ({ s, ...span(s), offset: 0 })),
    ...(week[yesterday] || []).map((s) => ({ s, ...span(s), offset: 1440 })),
  ].find(({ start, end, offset }) => minute + offset >= start && minute + offset < end);
  if (current) {
    const allDay = current.s.open === current.s.close;
    return { open: true, allDay, until: allDay ? undefined : current.s.close };
  }

  for (let ahead = 0; ahead <= 7; ahead++) {
    const d = (day + ahead) % 7;
    const next = (week[d] || [])
      .map((s) => ({ s, start: span(s).start }))
      .filter(({ start }) => ahead > 0 || start > minute)
      .sort((a, b) => a.start - b.start)[0];
    if (next) {
      return { open: false, opensDay: WEEK.find((w) => w.day === d)!.key, opensAt: next.s.open };
    }
  }
  return { open: false, never: true };
}
