/**
 * Categories nest one level: a top-level category ("Drinks") may hold sub-categories ("Hot",
 * "Cold"), and a sub-category holds none. Menus list them in tree order: each top-level
 * category in its own order, followed by its sub-categories in theirs.
 */
export interface CategoryNode {
  id: string;
  code: string;
  parent_id?: string | null;
  sort_order: number;
}

const bySortThenCode = (a: CategoryNode, b: CategoryNode) => (a.sort_order || 0) - (b.sort_order || 0) || (a.code || '').localeCompare(b.code || '');

/** Every category, parents first, each followed by its children. A child whose parent is gone lists as top level. */
export function inTreeOrder<T extends CategoryNode>(rows: T[]): T[] {
  const ids = new Set(rows.map((r) => r.id));
  const isTop = (r: T) => !r.parent_id || !ids.has(r.parent_id);
  const out: T[] = [];
  for (const top of rows.filter(isTop).sort(bySortThenCode)) {
    out.push(top);
    out.push(...rows.filter((r) => r.parent_id === top.id).sort(bySortThenCode));
  }
  return out;
}
