import { Branch } from '../../entities/Branch.entity';
import { Tenant } from '../../entities/Tenant.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { BUSINESS_TIME_ZONE } from './business-date.util';
import { BUSINESS_DAY_SETTING_KEY, BusinessClock, isTimeZone, readBusinessDayConfig } from './business-day';

export { BusinessClock } from './business-day';

function canRead(em: any): boolean {
  return typeof em?.find === 'function' && typeof em?.findOne === 'function';
}

/**
 * The business clock of a branch (or, without one, of the chain): head office's BUSINESS_DAY
 * cutoff on the branch's time zone. A caller with no real entity manager (a unit test's fake)
 * gets the default clock: a 05:00 cutoff on BUSINESS_TIME_ZONE.
 */
export async function loadBusinessClock(em: any, tenantId: string, branchId?: string | null): Promise<BusinessClock> {
  if (!canRead(em) || !tenantId) return BusinessClock.fromConfig();
  try {
    const [rows, branch] = await Promise.all([
      em.find(TenantSetting, { where: { tenant_id: tenantId, key: BUSINESS_DAY_SETTING_KEY } }),
      branchId ? em.findOne(Branch, { where: { id: branchId, tenant_id: tenantId }, withDeleted: true }) : Promise.resolve(null),
    ]);
    // The cutoff is the chain's own; branches do not set it.
    const chainRow = Array.isArray(rows) ? rows.find((r: any) => r?.key === BUSINESS_DAY_SETTING_KEY && !r.branch_id) : undefined;
    const config = readBusinessDayConfig(chainRow?.value);
    let timeZone = isTimeZone(branch?.time_zone) ? branch!.time_zone : null;
    if (!timeZone) {
      const tenant = await em.findOne(Tenant, { where: { id: tenantId } });
      timeZone = isTimeZone(tenant?.time_zone) ? tenant!.time_zone : BUSINESS_TIME_ZONE;
    }
    const clock = new BusinessClock({ ...config, timeZone, since: null });
    if (branch?.created_at) clock.policy.since = clock.dateOf(branch.created_at);
    return clock;
  } catch {
    return BusinessClock.fromConfig();
  }
}

/** Today's business date at a branch. */
export async function businessToday(em: any, tenantId: string, branchId?: string | null, now: Date = new Date()): Promise<string> {
  return (await loadBusinessClock(em, tenantId, branchId)).today(now);
}
