import { DataSource } from 'typeorm';
import { loadBusinessClock } from '../../src/common/utils/business-clock';
import { addDays } from '../../src/common/utils/business-day';

/**
 * Waits out a branch's business-day turnover (04:00 in Tehran by default) when it is only
 * moments away. A test that sets today's stock and then sells against it needs both on the
 * same business day; one that straddles the cutoff meets a genuinely new day with no count on
 * it. Read from the same clock the services use, so it holds whatever the branch's cutoff.
 */
export async function clearOfDayTurnover(dataSource: DataSource, tenantId: string, branchId: string, marginMs = 5_000): Promise<void> {
  const clock = await loadBusinessClock(dataSource.manager, tenantId, branchId);
  const now = new Date();
  const turnover = clock.startOf(addDays(clock.today(now), 1)).getTime();
  const wait = turnover - now.getTime();
  if (wait < marginMs) await new Promise((resolve) => setTimeout(resolve, wait + 500));
}
