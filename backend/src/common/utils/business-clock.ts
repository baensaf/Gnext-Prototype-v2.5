import { EntityManager } from 'typeorm';
import { Branch } from '../../entities/Branch.entity';
import { Tenant } from '../../entities/Tenant.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { BUSINESS_TIME_ZONE } from './business-date.util';
import {
  BUSINESS_DAY_SETTING_KEY,
  BusinessClock,
  isTimeZone,
  policyFor,
  readBusinessDayConfig,
  readTimeline,
  timelineAfterChange,
} from './business-day';
import { pickSettingValue } from './setting-scope.util';

export { BusinessClock } from './business-day';

type Reader = Pick<EntityManager, 'find' | 'findOne'>;

function canRead(em: any): em is Reader {
  return typeof em?.find === 'function' && typeof em?.findOne === 'function';
}

/**
 * The business clock of a branch (or, without one, of the chain): head office's BUSINESS_DAY
 * setting under the branch's own override, on the branch's time zone, through the rules the
 * branch has run under. A caller with no real entity manager (a unit test's fake) gets the
 * default clock: a 04:00 cutoff on BUSINESS_TIME_ZONE.
 */
export async function loadBusinessClock(em: any, tenantId: string, branchId?: string | null): Promise<BusinessClock> {
  if (!canRead(em) || !tenantId) return BusinessClock.fromConfig();
  try {
    const [rows, branch] = await Promise.all([
      em.find(TenantSetting, { where: { tenant_id: tenantId, key: BUSINESS_DAY_SETTING_KEY } }),
      branchId ? em.findOne(Branch, { where: { id: branchId, tenant_id: tenantId }, withDeleted: true }) : Promise.resolve(null),
    ]);
    const settingRows = Array.isArray(rows) ? rows.filter((r: any) => r?.key === BUSINESS_DAY_SETTING_KEY) : [];
    const config = readBusinessDayConfig(pickSettingValue(settingRows, branchId));
    let timeZone = isTimeZone(branch?.time_zone) ? branch!.time_zone : null;
    if (!timeZone) {
      const tenant = await em.findOne(Tenant, { where: { id: tenantId } });
      timeZone = isTimeZone(tenant?.time_zone) ? tenant!.time_zone : BUSINESS_TIME_ZONE;
    }
    return new BusinessClock(policyFor(config, timeZone, readTimeline(branch?.business_day_timeline), branch?.created_at));
  } catch {
    return BusinessClock.fromConfig();
  }
}

/** Today's business date at a branch. */
export async function businessToday(em: any, tenantId: string, branchId?: string | null, now: Date = new Date()): Promise<string> {
  return (await loadBusinessClock(em, tenantId, branchId)).today(now);
}

/**
 * Wraps anything that may change which rule a branch's day runs under — the BUSINESS_DAY
 * setting at either level, a branch's time zone, the chain's time zone — and records the change
 * on each affected branch's timeline, so the new rule applies from now on and nothing before it
 * is re-dated.
 */
export async function trackBusinessDayChange<T>(
  em: EntityManager,
  tenantId: string,
  change: () => Promise<T>,
  now: Date = new Date(),
): Promise<T> {
  if (!canRead(em)) return await change();
  const branches = await em.find(Branch, { where: { tenant_id: tenantId } });
  const before = new Map<string, BusinessClock>();
  for (const b of branches) before.set(b.id, await loadBusinessClock(em, tenantId, b.id));

  const result = await change();

  for (const b of branches) {
    const old = before.get(b.id)!;
    const next = await loadBusinessClock(em, tenantId, b.id);
    const nextRule = { cutoff: next.policy.cutoff, time_zone: next.policy.timeZone };
    const timeline = timelineAfterChange(old, nextRule, now, old.policy.since);
    if (timeline.rules !== old.policy.rules || !readTimeline(b.business_day_timeline)) {
      await em.update(Branch, { id: b.id, tenant_id: tenantId }, { business_day_timeline: timeline as any });
    }
  }
  return result;
}
