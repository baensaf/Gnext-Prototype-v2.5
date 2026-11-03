import { EntityManager, IsNull } from 'typeorm';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { loadBusinessClock } from '../../common/utils/business-clock';

/**
 * The number a branch calls an order by, as Iranian counters do (HAMI and the like): 2–3
 * digits, starting over each business day. The order number (ORD-20260922-0012) stays the
 * chain-wide identity; this one is only unique at its branch, for its day.
 *
 * Two sets, split by whether the customer waits at the branch for the number (O-42). Dine-in,
 * takeaway and pickup share one queue, whether rung at the till, the kiosk or online. Orders
 * that go out to the customer count apart: there the number only serves the kitchen. A set
 * that runs out wraps back to its start: by then the first order with that number has long
 * gone out.
 */
export const CALL_NUMBER_SETTING_KEY = 'ORDER_CALL_NUMBERS';

export type CallNumberSet = 'ON_SITE' | 'REMOTE';

export interface CallNumberRange {
  start: number;
  end: number;
}

export const DEFAULT_CALL_NUMBER_RANGES: Record<CallNumberSet, CallNumberRange> = {
  ON_SITE: { start: 100, end: 499 },
  REMOTE: { start: 500, end: 999 },
};

/** How the order leaves decides the set, not where it was rung up: a delivery typed at the till is REMOTE. */
export function callNumberSet(order: Pick<OrderHeader, 'order_type' | 'aggregator_expedition'>): CallNumberSet {
  const type = String(order.order_type || '').toUpperCase();
  if (type === 'DELIVERY') return 'REMOTE';
  if (type === 'AGGREGATOR') return order.aggregator_expedition === 'PICKUP' ? 'ON_SITE' : 'REMOTE';
  return 'ON_SITE';
}

/** Head office's ranges, each checked; a range that makes no sense falls back to the default. */
export function readCallNumberRanges(value: any): Record<CallNumberSet, CallNumberRange> {
  const ranges = { ...DEFAULT_CALL_NUMBER_RANGES };
  for (const set of Object.keys(ranges) as CallNumberSet[]) {
    const r = value?.ranges?.[set];
    const start = Number(r?.start);
    const end = Number(r?.end);
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start && end <= 99999) {
      ranges[set] = { start, end };
    }
  }
  return ranges;
}

/**
 * Why head office's ranges can't be saved, or null. Each counts upwards and none shares a
 * number with the other set, or two orders could be called by the same number (O-39).
 */
export function callNumberRangesProblem(value: any): string | null {
  const list = (Object.keys(DEFAULT_CALL_NUMBER_RANGES) as CallNumberSet[]).map((set) => {
    const r = value?.ranges?.[set] ?? DEFAULT_CALL_NUMBER_RANGES[set];
    return { set, start: Number(r?.start), end: Number(r?.end) };
  });
  const bad = list.find((r) => !Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 1 || r.end < r.start || r.end > 99999);
  if (bad) return `The ${bad.set} call-number range must start at 1 or more and end at or after its start.`;
  const overlap = list.some((a, i) => list.some((b, j) => i < j && a.start <= b.end && b.start <= a.end));
  return overlap ? 'The call-number ranges overlap, so two orders could get the same number.' : null;
}

/**
 * The ranges a business day counts in. A change applies from the next business day (O-39):
 * until then the day keeps the ranges it started with, so numbers already called out stay
 * apart from the ones still to come.
 */
export function callNumberRangesFor(value: any, businessDate: string): Record<CallNumberSet, CallNumberRange> {
  if (value?.previous && value?.changed_on && businessDate <= String(value.changed_on)) {
    return readCallNumberRanges({ ranges: value.previous });
  }
  return readCallNumberRanges(value);
}

/**
 * The setting to store when head office saves new ranges on `today`: the new ranges, and the
 * ones today keeps (what was in force today, even if they were changed earlier today).
 */
export function callNumberSettingToSave(stored: any, incoming: any, today: string) {
  return {
    ranges: readCallNumberRanges(incoming),
    previous: callNumberRangesFor(stored, today),
    changed_on: today,
  };
}

/** The n-th number handed out today in a range, wrapping back to its start when it runs out. */
export function nthInRange(n: number, range: CallNumberRange): number {
  const size = range.end - range.start + 1;
  return range.start + ((n - 1) % size);
}

/**
 * Gives the order its call number if it has none yet, and returns it. The day's counter is one
 * row per branch, business day and set, bumped in a single statement, so two tills (or a till
 * and a kiosk) cannot draw the same number.
 */
export async function assignCallNumber(em: EntityManager, order: OrderHeader): Promise<number | null> {
  if (order.call_number) return order.call_number;
  // A caller without a real entity manager (a unit test's fake) simply gets no number.
  if (typeof em?.query !== 'function' || typeof em?.findOne !== 'function') return null;
  const set = callNumberSet(order);
  // The business day the order was stamped with, which turns over at the branch's cutoff, so
  // a shop open past midnight does not start again at 100 in the middle of service.
  const businessDate = String(order.business_date || (await loadBusinessClock(em, order.tenant_id, order.branch_id)).today()).slice(0, 10);

  const setting = await em.findOne(TenantSetting, {
    where: { tenant_id: order.tenant_id, key: CALL_NUMBER_SETTING_KEY, branch_id: IsNull() },
  });
  const range = callNumberRangesFor(setting?.value, businessDate)[set];

  const rows = await em.query(
    `INSERT INTO "order_call_counter" ("tenant_id", "branch_id", "business_date", "channel_group", "last_value")
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT ("tenant_id", "branch_id", "business_date", "channel_group")
     DO UPDATE SET "last_value" = "order_call_counter"."last_value" + 1
     RETURNING "last_value"`,
    [order.tenant_id, order.branch_id, businessDate, set],
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
