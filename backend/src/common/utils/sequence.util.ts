import { EntityManager } from 'typeorm';
import { loadBusinessClock } from './business-clock';

/**
 * The next number in a tenant's counter for `prefix` (e.g. `PAY-20261014`), taken in one
 * statement. Counting today's rows and adding one handed two payments taken at the same moment
 * the same number; the upsert locks the counter row until the caller's transaction ends, so
 * numbers are unique, and a rolled-back sale gives its number back.
 */
export async function nextSequenceValue(em: EntityManager, tenantId: string, prefix: string): Promise<number> {
  const rows = await em.query(
    `INSERT INTO "order_sequence" ("tenant_id", "prefix", "last_value")
     VALUES ($1, $2, 1)
     ON CONFLICT ("tenant_id", "prefix")
     DO UPDATE SET "last_value" = "order_sequence"."last_value" + 1, "updated_at" = now()
     RETURNING "last_value"`,
    [tenantId, prefix],
  );
  return Number(rows[0].last_value);
}

/** `PREFIX-0001`: the counter's value padded to four digits. */
export async function nextNumber(em: EntityManager, tenantId: string, prefix: string): Promise<string> {
  const value = await nextSequenceValue(em, tenantId, prefix);
  return `${prefix}-${String(value).padStart(4, '0')}`;
}

/**
 * `TAG-YYYYMMDD-0001` dated by the branch's business day: its own time zone and the chain's
 * cutoff, so a sale at 01:30 is numbered with the night it belongs to, and a branch in another
 * time zone numbers by its own day rather than Tehran's.
 */
export async function nextBranchNumber(
  em: EntityManager,
  tenantId: string,
  branchId: string | null | undefined,
  tag: string,
): Promise<string> {
  const day = (await loadBusinessClock(em, tenantId, branchId)).today().replace(/-/g, '');
  return nextNumber(em, tenantId, `${tag}-${day}`);
}
