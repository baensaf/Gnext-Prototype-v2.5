import { BadRequestException } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';
import { OrderHeader } from '../../entities/OrderHeader.entity';

/**
 * The order book's filters, shared by the paged list, its per-tab counts and the CSV export.
 *
 * The Orders page used to fetch one unpaged call, which the server capped at the newest 50,
 * and then filter, count and search those 50 in the browser. Every filter now runs here,
 * over the whole book.
 */

/**
 * Where an order sits for the person looking it up. The groups don't overlap, so the tab
 * counts add up to All. A completed order that gave money back is filed under REFUNDED, not
 * COMPLETED. How far the kitchen or courier has got is a detail of OPEN, not a group.
 */
export const LIFECYCLE_GROUPS = ['WAITING', 'OPEN', 'HELD', 'COMPLETED', 'REFUNDED', 'CANCELLED', 'OTHER'] as const;
export type LifecycleGroup = (typeof LIFECYCLE_GROUPS)[number];

export const OPEN_STATUSES = ['SUBMITTED', 'CONFIRMED', 'PREPARING', 'KITCHEN_PREPARING', 'READY', 'OUT_FOR_DELIVERY'];

/**
 * Groups that are still somebody's job, whenever they were placed. A date range on the list
 * picks which finished orders to look at; it must not hide a COD delivery waiting on its
 * courier, an order carried past day close, or one rung up at 23:50 once the clock turns.
 */
const CURRENT_GROUPS: LifecycleGroup[] = ['WAITING', 'OPEN', 'HELD'];

const inList = (values: string[]) => values.map((v) => `'${v}'`).join(', ');

/** A SQL expression naming the lifecycle group of `o`. It follows `status`, as the screens do. */
export const LIFECYCLE_SQL = `CASE
  WHEN o.status = 'PENDING_ACCEPTANCE' THEN 'WAITING'
  WHEN o.status IN (${inList(OPEN_STATUSES)}) THEN 'OPEN'
  WHEN o.status = 'DRAFT' THEN 'HELD'
  WHEN o.status = 'REFUNDED' OR (o.status = 'COMPLETED' AND o.refunded_total > 0) THEN 'REFUNDED'
  WHEN o.status = 'COMPLETED' THEN 'COMPLETED'
  WHEN o.status IN ('CANCELLED', 'REJECTED') THEN 'CANCELLED'
  ELSE 'OTHER'
END`;

/** The same grouping as `LIFECYCLE_SQL`, for an order already loaded. */
export function lifecycleGroupOf(order: { status: string; refunded_total?: string | null }): LifecycleGroup {
  const status = order.status;
  if (status === 'PENDING_ACCEPTANCE') return 'WAITING';
  if (OPEN_STATUSES.includes(status)) return 'OPEN';
  if (status === 'DRAFT') return 'HELD';
  if (status === 'REFUNDED' || (status === 'COMPLETED' && Number(order.refunded_total || 0) > 0)) return 'REFUNDED';
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'CANCELLED' || status === 'REJECTED') return 'CANCELLED';
  return 'OTHER';
}

/** The most rows one CSV export carries; a wider range is narrowed by date first. */
export const ORDER_EXPORT_LIMIT = 5000;

/** Sortable columns, by the name the client sends. Anything else falls back to newest first. */
const SORTABLE: Record<string, string> = {
  placed_at: 'o.placed_at',
  grand_total: 'o.grand_total',
  outstanding_total: 'o.outstanding_total',
  order_number: 'o.order_number',
};

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Persian and Arabic-Indic digits typed on a Persian keyboard, read as the digits they are. */
export function normaliseDigits(text: string): string {
  return text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * The same mobile as the other spelling it may be stored under. Staff type `0912…`; Snappfood
 * and older imports keep `+98912…`. Works on a partial number too, since it only swaps the
 * prefix. Null when the text is not a number in either form.
 */
export function alternatePhonePrefix(text: string): string | null {
  if (/^0\d{3,}$/.test(text)) return `+98${text.slice(1)}`;
  if (/^\+98\d{3,}$/.test(text)) return `0${text.slice(3)}`;
  return null;
}

function validDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Applies every filter the list understands. `group` is left out when counting the tabs,
 * since each tab counts its own group under the same other filters. `currentAnyDate` lets
 * waiting, open and held orders through whatever the date range says, as the Orders page
 * wants; the CSV export keeps the range strict.
 */
export function applyOrderFilters(
  qb: SelectQueryBuilder<OrderHeader>,
  query: any,
  options: { withGroup?: boolean; currentAnyDate?: boolean } = {},
) {
  const { withGroup = true, currentAnyDate = false } = options;
  const branchVal = query.branch || query.branch_id || query.branchId;
  if (branchVal) qb.andWhere('o.branch_id = :branch', { branch: branchVal });

  // A single raw state, as the POS held-orders list asks for. The tabs use `group`.
  const stateVal = query.state || query.status;
  if (stateVal) qb.andWhere('(o.state = :state OR o.status = :state)', { state: stateVal });

  if (withGroup && query.group && query.group !== 'ALL') {
    const group = String(query.group).toUpperCase();
    if ((LIFECYCLE_GROUPS as readonly string[]).includes(group)) {
      qb.andWhere(`(${LIFECYCLE_SQL}) = :group`, { group });
    }
  }

  if (query.type) qb.andWhere('o.order_type = :type', { type: query.type });
  if (query.channel) qb.andWhere('o.channel = :channel', { channel: query.channel });
  if (query.customer) qb.andWhere('o.customer_id = :customer', { customer: query.customer });
  if (query.table) qb.andWhere('o.table_id = :table', { table: query.table });
  if (query.shift) qb.andWhere('o.shift_id = :shift', { shift: query.shift });
  if (query.terminal) qb.andWhere('o.terminal_id = :terminal', { terminal: query.terminal });

  const from = validDate(query.from);
  const to = validDate(query.to);
  const bounds = [from && 'o.placed_at >= :from', to && 'o.placed_at < :to'].filter(Boolean).join(' AND ');
  if (bounds) {
    const params = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
    qb.andWhere(currentAnyDate ? `((${LIFECYCLE_SQL}) IN (${inList(CURRENT_GROUPS)}) OR (${bounds}))` : bounds, params);
  }

  // Only orders that took money, for choosing one to refund.
  if (query.paid === '1' || query.paid === 'true') qb.andWhere('o.paid_total > 0');

  applyGridFilters(qb, parseGridFilters(query.filters), currentAnyDate);

  if (query.ids) {
    const ids = String(query.ids).split(',').map((id) => id.trim()).filter((id) => UUID_PATTERN.test(id));
    qb.andWhere(ids.length ? 'o.id IN (:...ids)' : '1 = 0', { ids });
  }

  const q = normaliseDigits(String(query.q || '').trim());
  if (q) {
    const like = `%${q}%`;
    const otherPhone = alternatePhonePrefix(q);
    const clauses = [
      'o.order_number ILIKE :like',
      'o.notes ILIKE :like',
      'o.table_number ILIKE :like',
      customerMatchSql('like', otherPhone ? 'phoneLike' : null),
      itemMatchSql('like'),
    ];
    // A Snappfood order keeps its customer's number in the notes, in the +98 form.
    if (otherPhone) clauses.push('o.notes ILIKE :phoneLike');
    // The call number is what the customer hears and says back: "forty-two".
    const params: Record<string, unknown> = { like, ...(otherPhone ? { phoneLike: `%${otherPhone}%` } : {}) };
    if (/^\d{1,6}$/.test(q)) {
      clauses.push('o.call_number = :callNumber');
      params.callNumber = Number(q);
    }
    qb.andWhere(`(${clauses.join(' OR ')})`, params);
  }
}

/** An order whose customer's name, mobile or phone matches `:like` (or the other mobile spelling). */
function customerMatchSql(likeParam: string, phoneParam: string | null): string {
  const phoneMatch = phoneParam ? ` OR c.mobile ILIKE :${phoneParam} OR c.phone ILIKE :${phoneParam}` : '';
  return `EXISTS (SELECT 1 FROM customer c WHERE c.id = o.customer_id AND c.tenant_id = o.tenant_id
        AND (concat_ws(' ', c.first_name, c.last_name) ILIKE :${likeParam} OR c.full_name ILIKE :${likeParam}
             OR c.mobile ILIKE :${likeParam} OR c.phone ILIKE :${likeParam}${phoneMatch}))`;
}

/** An order with an item whose name matches `:like`. */
function itemMatchSql(likeParam: string): string {
  return `EXISTS (SELECT 1 FROM order_item i WHERE i.order_id = o.id AND i.product_name ILIKE :${likeParam})`;
}

/**
 * The grid's own column filters (the header filters and filter panel of MUI X DataGrid Pro),
 * sent as `filters={"items":[{"field","operator","value"}],"logic":"and"|"or"}`.
 *
 * Only the fields and operators below are understood. An unknown one is refused rather than
 * skipped: a list that quietly ignores a filter reads as if it had applied it. An item with no
 * value yet (the user picked "contains" and has not typed) filters nothing, as in the grid.
 */
export interface GridFilterItem {
  field: string;
  operator: string;
  value?: unknown;
}

export interface GridFilters {
  items: GridFilterItem[];
  logic: 'and' | 'or';
}

/** More conditions than anyone builds by hand; a cap on what one request can make the database do. */
export const MAX_GRID_FILTERS = 12;
const MAX_ANY_OF = 50;

type Condition = { sql: string; params: Record<string, unknown> };
/** SQL for one condition, with its parameters named from `p`; null when it has no value yet. */
type OperatorSql = (value: unknown, p: string) => Condition | null;

const refuse = (message: string): never => {
  throw new BadRequestException(message);
};

/** `%` and `_` typed into a filter are the characters, not wildcards. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

const textOf = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? normaliseDigits(String(value).trim()) : '';

const textOperators = (column: string): Record<string, OperatorSql> => {
  const like = (pattern: (text: string) => string): OperatorSql => (value, p) => {
    const text = textOf(value);
    return text ? { sql: `${column} ILIKE :${p}`, params: { [p]: pattern(escapeLike(text)) } } : null;
  };
  return {
    contains: like((text) => `%${text}%`),
    equals: like((text) => text),
    startsWith: like((text) => `${text}%`),
    endsWith: like((text) => `%${text}`),
  };
};

const selectOperators = (column: string, valid: (value: string) => boolean = () => true): Record<string, OperatorSql> => {
  const one = (value: unknown): string | null => {
    if (value === undefined || value === null || value === '') return null;
    return typeof value === 'string' && value.length <= 64 && valid(value) ? value : refuse(`Not a value for ${column}: ${String(value)}`);
  };
  return {
    is: (value, p) => {
      const v = one(value);
      return v ? { sql: `${column} = :${p}`, params: { [p]: v } } : null;
    },
    not: (value, p) => {
      const v = one(value);
      return v ? { sql: `${column} IS DISTINCT FROM :${p}`, params: { [p]: v } } : null;
    },
    isAnyOf: (value, p) => {
      const list = (Array.isArray(value) ? value : []).map(one).filter((v): v is string => !!v);
      if (list.length > MAX_ANY_OF) refuse(`At most ${MAX_ANY_OF} values in one filter`);
      return list.length ? { sql: `${column} IN (:...${p})`, params: { [p]: list } } : null;
    },
  };
};

const numberOperators = (column: string): Record<string, OperatorSql> => {
  const compare = (sqlOperator: string): OperatorSql => (value, p) => {
    const text = textOf(value);
    if (!text) return null;
    if (!/^-?\d+(\.\d+)?$/.test(text)) refuse(`Not a number: ${text}`);
    return { sql: `${column} ${sqlOperator} :${p}`, params: { [p]: text } };
  };
  return {
    '=': compare('='),
    '!=': compare('<>'),
    '>': compare('>'),
    '>=': compare('>='),
    '<': compare('<'),
    '<=': compare('<='),
  };
};

/**
 * `between` takes `[from, to]`, instants with `to` exclusive, either end open. The browser
 * works out the business day's bounds (today, a Jalali day, a range) on the restaurants'
 * clock, as the date filter always has; the server only compares instants.
 */
const placedAtOperators: Record<string, OperatorSql> = {
  between: (value, p) => {
    const [rawFrom, rawTo] = Array.isArray(value) ? value : [];
    const from = rawFrom ? validDate(rawFrom) || refuse(`Not a date: ${String(rawFrom)}`) : null;
    const to = rawTo ? validDate(rawTo) || refuse(`Not a date: ${String(rawTo)}`) : null;
    const bounds = [from && `o.placed_at >= :${p}_from`, to && `o.placed_at < :${p}_to`].filter(Boolean);
    if (!bounds.length) return null;
    return { sql: bounds.join(' AND '), params: { ...(from ? { [`${p}_from`]: from } : {}), ...(to ? { [`${p}_to`]: to } : {}) } };
  },
};

const GRID_FIELDS: Record<string, Record<string, OperatorSql>> = {
  order_number: textOperators('o.order_number'),
  placed_at: placedAtOperators,
  channel: selectOperators('o.channel'),
  order_type: selectOperators('o.order_type'),
  branch_id: selectOperators('o.branch_id', (v) => UUID_PATTERN.test(v)),
  customer_name: {
    contains: (value, p) => {
      const text = textOf(value);
      if (!text) return null;
      const otherPhone = alternatePhonePrefix(text);
      return {
        sql: customerMatchSql(p, otherPhone ? `${p}_phone` : null),
        params: { [p]: `%${escapeLike(text)}%`, ...(otherPhone ? { [`${p}_phone`]: `%${escapeLike(otherPhone)}%` } : {}) },
      };
    },
    // A walk-in: no customer on the order.
    isEmpty: () => ({ sql: 'o.customer_id IS NULL', params: {} }),
    isNotEmpty: () => ({ sql: 'o.customer_id IS NOT NULL', params: {} }),
  },
  items: {
    contains: (value, p) => {
      const text = textOf(value);
      return text ? { sql: itemMatchSql(p), params: { [p]: `%${escapeLike(text)}%` } } : null;
    },
  },
  grand_total: numberOperators('o.grand_total'),
  outstanding_total: numberOperators('o.outstanding_total'),
  // Sent while the branch was outside its opening hours: `yes` or `no`.
  after_hours: {
    is: (value) => {
      if (value === undefined || value === null || value === '') return null;
      if (value !== 'yes' && value !== 'no') refuse(`Not a value for after_hours: ${String(value)}`);
      return { sql: value === 'yes' ? 'o.after_hours = true' : 'o.after_hours = false', params: {} };
    },
  },
};

/** Reads the `filters` parameter; null when there is none. */
export function parseGridFilters(raw: unknown): GridFilters | null {
  if (raw === undefined || raw === null || raw === '') return null;
  let parsed: any = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      refuse('filters is not valid JSON');
    }
  }
  if (!parsed || !Array.isArray(parsed.items)) refuse('filters needs a list of items');
  if (parsed.items.length > MAX_GRID_FILTERS) refuse(`At most ${MAX_GRID_FILTERS} filters`);

  const items: GridFilterItem[] = parsed.items.map((item: any) => {
    const field = String(item?.field ?? '');
    const operator = String(item?.operator ?? '');
    if (!Object.prototype.hasOwnProperty.call(GRID_FIELDS, field)) refuse(`Orders cannot be filtered by ${field}`);
    if (!Object.prototype.hasOwnProperty.call(GRID_FIELDS[field], operator)) refuse(`Unknown filter on ${field}: ${operator}`);
    return { field, operator, value: item.value };
  });
  return { items, logic: parsed.logic === 'or' ? 'or' : 'and' };
}

/**
 * Adds the grid's filters as one bracketed condition, so "or" between them never loosens the
 * tenant, branch or tab around it. With `currentAnyDate`, a date filter lets waiting, open and
 * held orders through, as the list's date range does.
 */
export function applyGridFilters(qb: SelectQueryBuilder<OrderHeader>, filters: GridFilters | null, currentAnyDate = false) {
  if (!filters) return;
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};
  filters.items.forEach((item, index) => {
    const condition = GRID_FIELDS[item.field][item.operator](item.value, `gf${index}`);
    if (!condition) return;
    const sql =
      item.field === 'placed_at' && currentAnyDate
        ? `((${LIFECYCLE_SQL}) IN (${inList(CURRENT_GROUPS)}) OR (${condition.sql}))`
        : `(${condition.sql})`;
    conditions.push(sql);
    Object.assign(params, condition.params);
  });
  if (conditions.length) qb.andWhere(`(${conditions.join(filters.logic === 'or' ? ' OR ' : ' AND ')})`, params);
}

export function applyOrderSort(qb: SelectQueryBuilder<OrderHeader>, query: any) {
  const column = SORTABLE[String(query.sort || '')] || 'o.placed_at';
  const direction = String(query.dir || query.order || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  qb.orderBy(column, direction);
  // Ties (the same total, a bulk import at one instant) still come back in a stable order.
  if (column !== 'o.placed_at') qb.addOrderBy('o.placed_at', 'DESC');
  qb.addOrderBy('o.id', 'DESC');
}

/** RFC 4180 quoting for one CSV field. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
