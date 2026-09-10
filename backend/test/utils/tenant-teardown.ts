import { DataSource } from 'typeorm';

/**
 * Removes a fixture tenant and everything hanging off it.
 *
 * These suites run against the real database rather than a throwaway one, and each creates
 * its own tenant in `beforeAll` so runs cannot collide. Nothing removed them afterwards, so
 * the database accumulated one abandoned tenant per suite per run — with its branches,
 * users, catalogue and orders still attached.
 *
 * The table list is read from the schema instead of being written out here, because a
 * hardcoded list silently stops covering whatever gets added next. Rows point at each other,
 * so one pass hits foreign keys no matter what order it picks; repeating until a pass clears
 * nothing separates "deleted in the wrong order" from "genuinely still referenced".
 */
export async function deleteTenantData(dataSource: DataSource, tenantId?: string): Promise<void> {
  if (!tenantId) return;

  const tables: Array<{ table_name: string }> = await dataSource.query(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
  );

  let remaining = tables.map((row) => row.table_name);
  while (remaining.length) {
    const blocked: string[] = [];
    for (const table of remaining) {
      try {
        await dataSource.query(`DELETE FROM "${table}" WHERE tenant_id = $1`, [tenantId]);
      } catch {
        blocked.push(table);
      }
    }
    if (blocked.length === remaining.length) break;
    remaining = blocked;
  }

  try {
    await dataSource.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
  } catch {
    // A tenant still referenced by something outside this sweep is worth leaving behind
    // rather than failing a suite that has already made its assertions.
  }
}
