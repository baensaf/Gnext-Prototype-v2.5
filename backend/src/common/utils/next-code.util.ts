import type { Repository, ObjectLiteral } from 'typeorm';

/**
 * The next free `PREFIX-n` code among the rows matching `where`. Nobody types these codes: they
 * are what exports, imports and logs use to name a row. Archived rows count, so a code is never
 * handed to something new.
 */
export async function nextCode<T extends ObjectLiteral>(repo: Repository<T>, where: Record<string, unknown>, prefix: string): Promise<string> {
  const rows = (await repo.find({ where: where as any, withDeleted: true, select: ['code'] as any })) || [];
  const taken = new Set(rows.map((r: any) => String(r.code || '').toUpperCase()));
  let n = rows.length + 1;
  while (taken.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

/** A code the user typed, tidied, or none. */
export const typedCode = (code?: string | null) => (code || '').trim().toUpperCase() || null;
