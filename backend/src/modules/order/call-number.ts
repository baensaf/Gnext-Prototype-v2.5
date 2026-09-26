import { EntityManager, IsNull } from 'typeorm';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { loadBusinessClock } from '../../common/utils/business-clock';

/**
 * The number a branch calls an order by, as Iranian counters do (HAMI and the like): 2–3
 * digits, starting over each business day. The order number (ORD-20260922-0012) stays the
 * chain-wide identity; this one is only unique at its branch, for its day.
 *
 * Each channel counts in its own range, so a kiosk order and a till order are never handed
 * the same number at once, and staff can tell where an order came from by its number. A
 * range that runs out wraps back to its start: by then the first order with that number has
 * long gone out.
 */
export const CALL_NUMBER_SETTING_KEY = 'ORDER_CALL_NUMBERS';

export type CallChannelGroup = 'POS' | 'KIOSK' | 'ONLINE';

export interface CallNumberRange {
  start: number;
  end: number;
}

export const DEFAULT_CALL_NUMBER_RANGES: Record<CallChannelGroup, CallNumberRange> = {
  POS: { start: 100, end: 399 },
  KIOSK: { start: 400, end: 499 },
  ONLINE: { start: 500, end: 599 },
};

export function callChannelGroup(channel?: string | null): CallChannelGroup {
  const c = String(channel || '').toUpperCase();
  if (c === 'KIOSK') return 'KIOSK';
  if (['AGGREGATOR', 'SNAPPFOOD', 'ONLINE', 'WEB', 'APP'].includes(c)) return 'ONLINE';
  return 'POS';
}

/** Head office's ranges, each checked; a range that makes no sense falls back to the default. */
export function readCallNumberRanges(value: any): Record<CallChannelGroup, CallNumberRange> {
  const ranges = { ...DEFAULT_CALL_NUMBER_RANGES };
  for (const group of Object.keys(ranges) as CallChannelGroup[]) {
    const r = value?.ranges?.[group];
    const start = Number(r?.start);
    const end = Number(r?.end);
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start && end <= 99999) {
      ranges[group] = { start, end };
    }
  }
  return ranges;
}

/**
 * How many numbers one of the branch's ranges has handed out on a business day: the count, not
 * the last number. The agent's offline till carries on from it: POS for its own sales (protocol
 * §12.2, §13.9), ONLINE for the Snappfood orders it takes (§17.5).
 */
export async function callCount(
  em: Pick<EntityManager, 'query'>,
  tenantId: string,
  branchId: string,
  businessDate: string,
  group: CallChannelGroup,
): Promise<number> {
  const rows = await em.query(
    `SELECT "last_value" FROM "order_call_counter" WHERE "tenant_id" = $1 AND "branch_id" = $2 AND "business_date" = $3 AND "channel_group" = $4`,
    [tenantId, branchId, businessDate, group],
  );
  return Number(rows?.[0]?.last_value || 0);
}

/** The POS range's count (§13.9). */
export function posCallCount(em: Pick<EntityManager, 'query'>, tenantId: string, branchId: string, businessDate: string): Promise<number> {
  return callCount(em, tenantId, branchId, businessDate, 'POS');
}

/** The n-th number handed out today in a range, wrapping back to its start when it runs out. */
export function nthInRange(n: number, range: CallNumberRange): number {
  const size = range.end - range.start + 1;
  return range.start + ((n - 1) % size);
}

/**
 * Gives the order its call number if it has none yet, and returns it. The day's counter is one
 * row per branch, business day and channel, bumped in a single statement, so two tills (or a
 * till and a kiosk) cannot draw the same number.
 */
export async function assignCallNumber(em: EntityManager, order: OrderHeader): Promise<number | null> {
  if (order.call_number) return order.call_number;
  // A caller without a real entity manager (a unit test's fake) simply gets no number.
  if (typeof em?.query !== 'function' || typeof em?.findOne !== 'function') return null;
  const group = callChannelGroup(order.channel);
  // The business day the order was stamped with, which turns over at the branch's cutoff, so
  // a shop open past midnight does not start again at 100 in the middle of service.
  const businessDate = String(order.business_date || (await loadBusinessClock(em, order.tenant_id, order.branch_id)).today()).slice(0, 10);

  const setting = await em.findOne(TenantSetting, {
    where: { tenant_id: order.tenant_id, key: CALL_NUMBER_SETTING_KEY, branch_id: IsNull() },
  });
  const range = readCallNumberRanges(setting?.value)[group];

  const rows = await em.query(
    `INSERT INTO "order_call_counter" ("tenant_id", "branch_id", "business_date", "channel_group", "last_value")
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT ("tenant_id", "branch_id", "business_date", "channel_group")
     DO UPDATE SET "last_value" = "order_call_counter"."last_value" + 1
     RETURNING "last_value"`,
    [order.tenant_id, order.branch_id, businessDate, group],
  );
  const n = Number(rows?.[0]?.last_value);
  if (!Number.isFinite(n) || n < 1) return null;

  const callNumber = nthInRange(n, range);
  // Only if nothing else numbered it meanwhile: the first number given is the one on the paper.
  await em.update(OrderHeader, { id: order.id, tenant_id: order.tenant_id, call_number: IsNull() }, { call_number: callNumber });
  const saved = await em.findOne(OrderHeader, { where: { id: order.id, tenant_id: order.tenant_id } });
  order.call_number = saved?.call_number ?? callNumber;
  return order.call_number;
}
