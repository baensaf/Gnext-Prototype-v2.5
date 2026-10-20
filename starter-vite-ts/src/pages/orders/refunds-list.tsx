import type { GridColDef, GridFilterModel, GridPaginationModel } from '@mui/x-data-grid-premium';
import type { RefundRecord } from 'src/api/refundApi';
import type { OrderGridFilters } from 'src/api/orderApi';
import type { PaymentMethod } from 'src/api/settingsApi';

import { useTranslation } from 'react-i18next';
import { useRef, useMemo, useState, useEffect, useCallback } from 'react';

import { Box, Typography } from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { serverText } from 'src/utils/server-text';
import { useCurrencyLabel } from 'src/utils/currency';
import { formatCalendarDateTime } from 'src/utils/calendar';
import { orderRefOf, useShowsOrderCode } from 'src/utils/order-ref';

import { refundApi } from 'src/api/refundApi';
import { settingsApi } from 'src/api/settingsApi';

import { ServerDataGrid } from 'src/components/server-data-grid';

import { placedAtFilters } from './order-grid-filters';

// The Refunded tab of the Orders page: money that went back, one row per payment given back.
// Its date filter is the time of the refund, so a refund made today on yesterday's order
// shows today. The filter sits in the same `placed_at` slot of the address bar as the other
// tabs' date filter, so a day picked on one tab holds on the others.

/** The window the date filter stands for, as the instants the refunds are bounded by. */
const windowOf = (filters?: OrderGridFilters): { from?: string; to?: string } => {
  const item = filters?.items.find((x) => x.field === 'placed_at');
  const [from, to] = Array.isArray(item?.value) ? (item.value as Array<string | null>) : [];
  return { from: from || undefined, to: to || undefined };
};

interface RefundListOptions {
  branchId?: string | null;
  /** The grid's filters as the server is sent them; only the date window applies to refunds. */
  filters?: OrderGridFilters;
  q?: string;
  page: number;
  pageSize: number;
  /** False while another tab is showing: one row is read, enough for the tab's count. */
  rowsWanted: boolean;
}

/** The refunds of the window in view, and how many there are (the Refunded tab's count). */
export function useRefundList({ branchId, filters, q, page, pageSize, rowsWanted }: RefundListOptions) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<RefundRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Answers can come back out of order when filters change quickly; only the latest counts.
  const seqRef = useRef(0);

  const filtersKey = JSON.stringify(filters ?? null);
  const load = useCallback(
    async (silent = false) => {
      const seq = ++seqRef.current;
      if (!silent) setLoading(true);
      try {
        const { from, to } = windowOf(JSON.parse(filtersKey) ?? undefined);
        const res = await refundApi.listRefunds({
          branchId: branchId || undefined,
          from,
          to,
          q: q || undefined,
          page: rowsWanted ? page + 1 : 1,
          limit: rowsWanted ? pageSize : 1,
        });
        if (seq !== seqRef.current) return;
        setRows(rowsWanted ? res.data : []);
        setTotal(res.total);
        setError(null);
      } catch (err: any) {
        if (seq === seqRef.current) setError(err.detail || t('refunds.loadFailed'));
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [branchId, filtersKey, q, page, pageSize, rowsWanted, t]
  );

  useEffect(() => {
    load();
  }, [load]);

  return { rows, total, loading, error, reload: load };
}

interface RefundsGridProps {
  rows: RefundRecord[];
  total: number;
  loading: boolean;
  /** The tabs, on the toolbar's line as on the other tabs. */
  toolbarStart: React.ReactNode;
  filterModel: GridFilterModel;
  onFilterModelChange: (model: GridFilterModel) => void;
  paginationModel: GridPaginationModel;
  onPaginationModelChange: (model: GridPaginationModel) => void;
  pageSizeOptions: number[];
  onOpenOrder: (orderId: string) => void;
}

export function RefundsGrid({
  rows,
  total,
  loading,
  toolbarStart,
  filterModel,
  onFilterModelChange,
  paginationModel,
  onPaginationModelChange,
  pageSizeOptions,
  onOpenOrder,
}: RefundsGridProps) {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();
  const showOrderCode = useShowsOrderCode();

  // Names for the methods a refund went back to; the refund itself carries only their ids.
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  useEffect(() => {
    settingsApi.getPaymentMethods().then(setMethods).catch(() => setMethods([]));
  }, []);
  const methodNames = useMemo(() => Object.fromEntries(methods.map((m) => [m.id, m.name])), [methods]);

  const columns: GridColDef<RefundRecord>[] = [
    {
      field: 'order_number',
      headerName: t('refunds.col.order'),
      width: 150,
      sortable: false,
      filterable: false,
      renderCell: ({ row }) => (
        <Box sx={{ minWidth: 0 }}>
          {/* A cashier knows the order by the call number the guest heard. */}
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }} noWrap>
            {orderRefOf({ call_number: row.order_call_number, order_number: row.order_number }, showOrderCode)}
          </Typography>
          {showOrderCode && row.order_call_number ? (
            <Typography color="text.secondary" variant="caption" noWrap sx={{ display: 'block', fontFamily: 'monospace' }}>
              <bdi dir="ltr">{row.order_number}</bdi>
            </Typography>
          ) : null}
        </Box>
      ),
    },
    {
      // The refund's own time. The field is `placed_at` so the date filter is the one the
      // other tabs use, now bounding when the money went back.
      field: 'placed_at',
      headerName: t('refunds.col.time'),
      width: 150,
      sortable: false,
      filterOperators: placedAtFilters(t),
      renderCell: ({ row }) => (
        <Typography variant="caption" dir="ltr">
          {formatCalendarDateTime(row.created_at)}
        </Typography>
      ),
    },
    {
      field: 'amount',
      headerName: t('refunds.amount'),
      width: 150,
      align: 'right',
      headerAlign: 'right',
      sortable: false,
      filterable: false,
      renderCell: ({ row }) => (
        <Typography variant="body2" sx={{ fontWeight: 700, color: 'error.main' }}>
          <bdi dir="ltr">-{MoneyUtil.formatCurrency(row.total_refund_amount || row.amount)}</bdi> {currency}
        </Typography>
      ),
    },
    {
      // How the money went back: the method the order was paid with.
      field: 'method',
      headerName: t('refunds.payBack.label'),
      width: 150,
      sortable: false,
      filterable: false,
      valueGetter: (_value, row) => (row.method_id && methodNames[row.method_id]) || row.method_kind || '-',
    },
    {
      field: 'reason',
      headerName: t('refunds.reason'),
      minWidth: 180,
      flex: 1,
      sortable: false,
      filterable: false,
      valueGetter: (_value, row) => serverText(row.note, t) || '-',
    },
    {
      field: 'approved_by_name',
      headerName: t('refunds.col.approvedBy'),
      width: 150,
      sortable: false,
      filterable: false,
      valueGetter: (_value, row) => row.approved_by_name || '-',
    },
    {
      field: 'code',
      headerName: t('refunds.col.code'),
      width: 170,
      sortable: false,
      filterable: false,
      renderCell: ({ row }) => (
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
          <bdi dir="ltr">{row.code}</bdi>
        </Typography>
      ),
    },
  ];

  return (
    <ServerDataGrid<RefundRecord>
      columns={columns}
      rows={rows}
      rowCount={total}
      loading={loading}
      toolbarStart={toolbarStart}
      density="compact"
      emptyTitle={t('refunds.empty')}
      filterModel={filterModel}
      onFilterModelChange={onFilterModelChange}
      paginationModel={paginationModel}
      onPaginationModelChange={onPaginationModelChange}
      pageSizeOptions={pageSizeOptions}
      // The row opens its order, where the refund also reads under Payments.
      onRowClick={(params) => onOpenOrder(params.row.order_id)}
      quickFilterPlaceholder={t('refunds.searchPlaceholder')}
      height={680}
      sx={{
        borderRadius: 3,
        boxShadow: 2,
        '& .MuiDataGrid-row': { cursor: 'pointer' },
      }}
    />
  );
}
