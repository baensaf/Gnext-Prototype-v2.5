import { EntityManager } from 'typeorm';
import { Branch } from '../../entities/Branch.entity';
import { BranchOperatingHour } from '../../entities/BranchOperatingHour.entity';
import { localClock } from './availability-schedule.util';
import { BUSINESS_TIME_ZONE } from './business-date.util';

/**
 * A branch's weekly opening hours: each weekday is closed or has one opening time (a row; the
 * code calls one a shift, which has nothing to do with a cashier's cash shift). One that closes
 * at or before it opens runs past midnight into the next day and belongs to the day it opened
 * on; equal times are the whole day. The same reading as selling windows.
 *
 * Hours do not stop the till. They decide whether an order is marked after hours, and from
 * V3 they will close the online channels.
 */
export interface OpeningHoursRow {
  /** JavaScript's day number, 0 = Sunday. */
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
}

const minutes = (time: string | null) => {
  const [h, m] = String(time || '00:00').split(':').map(Number);
  return h * 60 + m;
};

/** A shift as minutes from its day's midnight; `end` is past 1440 when it runs past midnight. */
export function shiftSpan(row: Pick<OpeningHoursRow, 'open_time' | 'close_time'>): { start: number; end: number } {
  const start = minutes(row.open_time);
  const close = minutes(row.close_time);
  return { start, end: close <= start ? close + 1440 : close };
}

/**
 * True when `at`, on the branch's clock, falls inside one of its shifts. A branch with no
 * hours is closed: missing hours never mean "always open" (Branch Management spec).
 */
export function isOpenAt(rows: OpeningHoursRow[], at: Date, timeZone: string): boolean {
  const shifts = rows.filter((r) => !r.is_closed && r.open_time && r.close_time);
  const { day, minute } = localClock(at, timeZone);
  const yesterday = (day + 6) % 7;
  return shifts.some((row) => {
    const { start, end } = shiftSpan(row);
    if (row.day_of_week === day) return minute >= start && minute < end;
    if (row.day_of_week === yesterday) return minute + 1440 < end;
    return false;
  });
}

/**
 * Why a week of hours cannot be saved, or null when it can. V1 takes one opening time a day
 * (several a day, such as lunch and dinner, are V4), and one that runs past midnight may close
 * as the next day opens but not after.
 */
export function hoursProblem(rows: OpeningHoursRow[]): string | null {
  const open = rows.filter((r) => !r.is_closed);
  for (let day = 0; day < 7; day++) {
    const today = open.filter((r) => r.day_of_week === day).map(shiftSpan);
    if (today.length > 1) return `Day ${day} has more than one opening time; V1 takes one a day`;
    const [hours] = today;
    if (hours && hours.end > 1440) {
      const tomorrow = open.filter((r) => r.day_of_week === (day + 1) % 7).map(shiftSpan);
      if (tomorrow.some((s) => s.start < hours.end - 1440)) {
        return `The opening time past midnight on day ${day} closes after the next day opens`;
      }
    }
  }
  return null;
}

/**
 * Whether a branch was outside its opening hours at `at`, read from the database. An order
 * sent then is marked after hours; nothing is refused.
 */
export async function isAfterHours(em: EntityManager, tenantId: string, branchId: string | null | undefined, at: Date): Promise<boolean> {
  if (!branchId) return false;
  const branch = await em.findOne(Branch, { where: { id: branchId, tenant_id: tenantId }, withDeleted: true });
  if (!branch) return false;
  const rows = await em.find(BranchOperatingHour, { where: { tenant_id: tenantId, branch_id: branchId } });
  return !isOpenAt(rows, at, branch.time_zone || BUSINESS_TIME_ZONE);
}
