import type { TFunction } from 'i18next';
import type {
  GridFilterItem,
  GridFilterModel,
  GridFilterOperator,
  GridFilterInputValueProps,
} from '@mui/x-data-grid-premium';
import type { OrderGridFilters, OrderGridFilterItem } from 'src/api/orderApi';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Box, Stack, Button, Popover } from '@mui/material';
import { getGridStringOperators, getGridNumericOperators, getGridSingleSelectOperators } from '@mui/x-data-grid-premium';

import { businessDate, businessToday, formatCalendarDate } from 'src/utils/calendar';

import { CalendarDateField } from 'src/components/calendar-date-field/calendar-date-field';

// The Orders grid's column filters: which ones each column offers, the date filter on the
// chain's calendar, how the filters sit in the address bar, and what the server is sent.
// The server (backend order-list.ts) accepts exactly these fields and operators.

/** The operators each filterable column offers, in menu order; the first is the header's default. */
export const FILTER_OPERATORS = {
  order_number: ['contains', 'equals', 'startsWith', 'endsWith'],
  branch_id: ['is', 'not', 'isAnyOf'],
  placed_at: ['today', 'yesterday', 'last7', 'last30', 'is', 'onOrAfter', 'onOrBefore', 'between'],
  channel: ['is', 'not', 'isAnyOf'],
  order_type: ['is', 'not', 'isAnyOf'],
  customer_name: ['contains', 'isEmpty', 'isNotEmpty'],
  items: ['contains'],
  grand_total: ['=', '!=', '>', '>=', '<', '<='],
  outstanding_total: ['=', '!=', '>', '>=', '<', '<='],
} as const satisfies Record<string, readonly string[]>;

type FilterField = keyof typeof FILTER_OPERATORS;

const NO_VALUE_OPERATORS = ['isEmpty', 'isNotEmpty', 'today', 'yesterday', 'last7', 'last30'];

const isFilterField = (field: string): field is FilterField => Object.prototype.hasOwnProperty.call(FILTER_OPERATORS, field);

const allows = (field: string, operator: string) =>
  isFilterField(field) && (FILTER_OPERATORS[field] as readonly string[]).includes(operator);

const pick = (operators: GridFilterOperator[], field: FilterField) =>
  FILTER_OPERATORS[field]
    .map((value) => operators.find((operator) => operator.value === value))
    .filter((operator): operator is GridFilterOperator => !!operator);

export const textFilters = (field: FilterField) => pick(getGridStringOperators(), field);
export const selectFilters = (field: FilterField) => pick(getGridSingleSelectOperators(), field);
export const numberFilters = (field: FilterField) => pick(getGridNumericOperators(), field);

// ----------------------------------------------------------------------

/** A business day (YYYY-MM-DD) moved by `days`, on the restaurants' clock. */
const shiftDay = (day: string, days: number) =>
  businessDate(new Date(new Date(`${day}T12:00:00+03:30`).getTime() + days * 86_400_000));

/** Midnight at the start of a business day in Tehran, which keeps no daylight saving. */
const startOfDay = (day: string) => `${day}T00:00:00+03:30`;

const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The placed-at window a date filter stands for, `[from, to)`; null when it has no day yet. */
const placedBounds = (operator: string, value: unknown): [string | null, string | null] | null => {
  const today = businessToday();
  switch (operator) {
    case 'today':
      return [startOfDay(today), startOfDay(shiftDay(today, 1))];
    case 'yesterday':
      return [startOfDay(shiftDay(today, -1)), startOfDay(today)];
    case 'last7':
      return [startOfDay(shiftDay(today, -6)), startOfDay(shiftDay(today, 1))];
    case 'last30':
      return [startOfDay(shiftDay(today, -29)), startOfDay(shiftDay(today, 1))];
    case 'is':
      return isDay(value) ? [startOfDay(value), startOfDay(shiftDay(value, 1))] : null;
    case 'onOrAfter':
      return isDay(value) ? [startOfDay(value), null] : null;
    case 'onOrBefore':
      return isDay(value) ? [null, startOfDay(shiftDay(value, 1))] : null;
    case 'between': {
      const [from, to] = Array.isArray(value) ? value : [];
      if (!isDay(from) && !isDay(to)) return null;
      return [isDay(from) ? startOfDay(from) : null, isDay(to) ? startOfDay(shiftDay(to, 1)) : null];
    }
    default:
      return null;
  }
};

/** One business day on the chain's calendar, in the header filter row or the filter panel. */
function CalendarDayInput({ item, applyValue, headerFilterMenu, clearButton, className, slotProps }: GridFilterInputValueProps) {
  return (
    <>
      <Box className={className} sx={{ minWidth: 0 }}>
        <CalendarDateField
          fullWidth
          label={slotProps?.root.label}
          onChange={(e) => applyValue({ ...item, value: e.target.value || undefined })}
          size="small"
          value={isDay(item.value) ? item.value : ''}
        />
      </Box>
      {headerFilterMenu}
      {clearButton}
    </>
  );
}

/**
 * A first and last business day, either left open. Two pickers do not fit a header filter
 * cell, so there it is a button naming the range, and the pickers open under it.
 */
function CalendarRangeInput({ item, applyValue, headerFilterMenu, clearButton, className }: GridFilterInputValueProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [from, to] = Array.isArray(item.value) ? item.value : [];
  const set = (index: 0 | 1, day: string) => {
    const next = [from ?? '', to ?? ''];
    next[index] = day;
    applyValue({ ...item, value: next[0] || next[1] ? next : undefined });
  };
  const fields = (
    <>
      <CalendarDateField label={t('orders.filters.from')} onChange={(e) => set(0, e.target.value)} size="small" sx={{ width: 180 }} value={isDay(from) ? from : ''} />
      <CalendarDateField label={t('orders.filters.to')} onChange={(e) => set(1, e.target.value)} size="small" sx={{ width: 180 }} value={isDay(to) ? to : ''} />
    </>
  );

  if (!headerFilterMenu) {
    return (
      <Box className={className} sx={{ display: 'flex', gap: 1 }}>
        {fields}
      </Box>
    );
  }

  const summary = isDay(from) || isDay(to) ? `${isDay(from) ? formatCalendarDate(from) : '…'} – ${isDay(to) ? formatCalendarDate(to) : '…'}` : t('orders.filters.between');
  return (
    <>
      <Box className={className} sx={{ minWidth: 0 }}>
        <Button
          color="inherit"
          fullWidth
          onClick={(e) => setAnchor(e.currentTarget)}
          size="small"
          sx={{ justifyContent: 'flex-start', fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden' }}
          variant="outlined"
        >
          <span dir="ltr">{summary}</span>
        </Button>
      </Box>
      <Popover anchorEl={anchor} onClose={() => setAnchor(null)} open={!!anchor}>
        {/* Keys typed into the pickers are theirs, not the grid's header navigation. */}
        <Stack onKeyDown={(e) => e.stopPropagation()} spacing={1.5} sx={{ p: 2 }}>
          {fields}
        </Stack>
      </Popover>
      {headerFilterMenu}
      {clearButton}
    </>
  );
}

/** The placed-at filters: quick ranges on the business clock, and days on the chain's calendar. */
export const placedAtFilters = (t: TFunction): GridFilterOperator[] => {
  const operator = (value: string, label: string, input?: Partial<GridFilterOperator>): GridFilterOperator => ({
    value,
    label,
    headerLabel: label,
    // The server filters; the grid never does.
    getApplyFilterFn: () => null,
    ...(input ?? { requiresFilterValue: false }),
  });
  return [
    operator('today', t('orders.filters.ranges.today')),
    operator('yesterday', t('orders.filters.ranges.yesterday')),
    operator('last7', t('orders.filters.ranges.7d')),
    operator('last30', t('orders.filters.ranges.30d')),
    operator('is', t('orders.filters.on'), { InputComponent: CalendarDayInput }),
    operator('onOrAfter', t('orders.filters.onOrAfter'), { InputComponent: CalendarDayInput }),
    operator('onOrBefore', t('orders.filters.onOrBefore'), { InputComponent: CalendarDayInput }),
    operator('between', t('orders.filters.between'), { InputComponent: CalendarRangeInput }),
  ];
};

// ----------------------------------------------------------------------

/** A plain /app/orders is today's orders. */
export const DEFAULT_FILTER_MODEL: GridFilterModel = {
  items: [{ id: 'placed_at', field: 'placed_at', operator: 'today' }],
};

/** The filters as they sit in the address bar, under `f`. */
export const encodeFilterModel = (model: GridFilterModel): string =>
  JSON.stringify({
    items: model.items.map(({ id, field, operator, value }) => ({ id, field, operator, ...(value !== undefined ? { value } : {}) })),
    ...(model.logicOperator === 'or' ? { logic: 'or' } : {}),
  });

/** Reads `f` back; null when it is missing or unreadable. Filters the page no longer has are dropped. */
export const decodeFilterModel = (raw: string | null): GridFilterModel | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.items)) return null;
    const items: GridFilterItem[] = parsed.items
      .filter((item: any) => item && allows(String(item.field), String(item.operator)))
      .map((item: any, index: number) => ({
        id: typeof item.id === 'string' || typeof item.id === 'number' ? item.id : `f${index}`,
        field: item.field,
        operator: item.operator,
        ...(item.value !== undefined ? { value: item.value } : {}),
      }));
    return { items, ...(parsed.logic === 'or' ? { logicOperator: 'or' as GridFilterModel['logicOperator'] } : {}) };
  } catch {
    return null;
  }
};

/** Links saved before the grid filtered: `range`, `from`, `to`, `type` and `channel`. */
export const legacyFilterModel = (params: URLSearchParams): GridFilterModel | null => {
  const [range, from, to, type, channel] = ['range', 'from', 'to', 'type', 'channel'].map((key) => params.get(key) || '');
  if (!range && !type && !channel) return null;
  const quick: Record<string, string> = { today: 'today', yesterday: 'yesterday', '7d': 'last7', '30d': 'last30' };
  const items: GridFilterItem[] = [];
  if (!range || quick[range]) items.push({ id: 'placed_at', field: 'placed_at', operator: quick[range] || 'today' });
  else if (range === 'custom' && (from || to)) items.push({ id: 'placed_at', field: 'placed_at', operator: 'between', value: [from, to] });
  if (type) items.push({ id: 'order_type', field: 'order_type', operator: 'is', value: type });
  if (channel) items.push({ id: 'channel', field: 'channel', operator: 'is', value: channel });
  return { items };
};

const hasValue = (value: unknown) =>
  value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);

/** What the server is sent: finished filters only, and dates as instants on the business clock. */
export const toServerFilters = (model: GridFilterModel): OrderGridFilters | undefined => {
  const items = model.items.flatMap((item): OrderGridFilterItem[] => {
    if (!allows(item.field, item.operator)) return [];
    if (item.field === 'placed_at') {
      const bounds = placedBounds(item.operator, item.value);
      return bounds ? [{ field: 'placed_at', operator: 'between', value: bounds }] : [];
    }
    if (!NO_VALUE_OPERATORS.includes(item.operator) && !hasValue(item.value)) return [];
    return [{ field: item.field, operator: item.operator, value: item.value }];
  });
  if (!items.length) return undefined;
  return { items, ...(model.logicOperator === 'or' ? { logic: 'or' as const } : {}) };
};
