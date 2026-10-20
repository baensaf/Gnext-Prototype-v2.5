import type { GridColDef } from '@mui/x-data-grid';
import type { BusinessDayClose } from '../../api/shiftApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import { Box, Chip, Stack, Alert, Typography, IconButton } from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyLabel } from 'src/utils/currency';
import { fDate, fDateTime } from 'src/utils/format-time';

import { useBranchContext } from 'src/contexts/branch-context';

import { shiftApi } from '../../api/shiftApi';
import { ServerDataGrid } from '../../components/server-data-grid';
import { businessDayApi, type CurrentBusinessDay } from '../../api/businessDayApi';

/**
 * The branch's closed business days, read-only. A day closes by itself once it has ended at the
 * cutoff and every shift on it is counted: the paid orders still open are completed and the rest
 * carried over to the next day. Nobody closes or reopens a day by hand.
 */
export function BusinessDaysPage() {
  const currencyLabel = useCurrencyLabel();
  const { t } = useTranslation();

  const [businessDays, setBusinessDays] = useState<BusinessDayClose[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const { branches, selectedBranchId: branchId } = useBranchContext();
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

  // The branch's business day now.
  const [currentDay, setCurrentDay] = useState<CurrentBusinessDay | null>(null);

  useEffect(() => {
    businessDayApi
      .getCurrent(branchId || undefined)
      .then(setCurrentDay)
      .catch(() => setCurrentDay(null));
  }, [branchId]);

  const fetchBusinessDays = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await shiftApi.getBusinessDays({ branch: branchId || undefined });
      setBusinessDays(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to load business days');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    fetchBusinessDays();
  }, [fetchBusinessDays]);

  const count = (value?: number) => (
    <Stack sx={{ height: '100%', justifyContent: 'center', alignItems: 'flex-start' }}>
      {value ? (
        <Chip size="small" variant="outlined" label={value} />
      ) : (
        <Typography variant="caption" color="text.secondary">
          -
        </Typography>
      )}
    </Stack>
  );

  const columns: GridColDef[] = [
    {
      field: 'business_date',
      headerName: t('cashier.businessDate', 'Business Date'),
      width: 140,
      renderCell: (params) => (
        <Typography sx={{ fontWeight: 600 }} dir="ltr">
          {fDate(params.value)}
        </Typography>
      ),
    },
    {
      field: 'branch_id',
      headerName: t('cashier.branch', 'Branch'),
      width: 180,
      renderCell: (params) => (
        <Typography variant="body2">{branchNameById.get(params.value) || params.value}</Typography>
      ),
    },
    {
      field: 'totals',
      headerName: t('cashier.totals', 'Day summary'),
      minWidth: 240,
      flex: 1,
      renderCell: (params) => {
        const totals = params.value;
        if (!totals) return <Typography variant="caption" color="text.secondary">-</Typography>;
        return (
          <Typography variant="caption">
            {t('cashier.ordersCount', 'Orders')}: {totals.orderCount ?? 0} · {t('cashier.sales', 'Sales')}:{' '}
            <span><bdi dir="ltr">{MoneyUtil.formatCurrency(totals.totalSales || 0)}</bdi> {currencyLabel}</span>
          </Typography>
        );
      },
    },
    {
      field: 'auto_completed',
      headerName: t('cashier.autoCompleted', 'Completed at close'),
      width: 150,
      sortable: false,
      renderCell: (params) => count(params.row.totals?.autoCompletedOrders),
    },
    {
      field: 'carried_over',
      headerName: t('cashier.openOrders.carriedOver', 'Carried over'),
      width: 120,
      sortable: false,
      renderCell: (params) => count(params.row.totals?.carriedOverOrders),
    },
    {
      field: 'closed_at',
      headerName: t('cashier.closedAt', 'Closed at'),
      width: 190,
      renderCell: (params) => (
        <Typography variant="body2" dir="ltr">
          {params.value ? fDateTime(params.value) : '-'}
        </Typography>
      ),
    },
  ];

  return (
    <Box sx={{ pb: 6 }}>
      <Stack sx={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('cashier.businessDays', 'Business Days')}
          </Typography>
          {currentDay && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t('cashier.currentDay', 'Business day now: {{date}} · turns over at {{cutoff}}', {
                date: fDate(currentDay.businessDate),
                cutoff: currentDay.cutoff,
              })}
            </Typography>
          )}
        </Box>
        <IconButton onClick={fetchBusinessDays} title={t('common.refresh', 'Refresh')}>
          <RefreshIcon />
        </IconButton>
      </Stack>

      <Alert severity="info" sx={{ mb: 3 }}>
        {t(
          'cashier.daysCloseThemselves',
          'The date moves on at the cutoff and new shifts open on the new day. Each day closes by itself once every shift on it is counted: paid orders still open are completed, the rest are carried over to the next day.'
        )}
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <ServerDataGrid
        rows={businessDays}
        columns={columns}
        loading={loading}
        height={560}
        emptyTitle={t('cashier.noBusinessDays', 'No business day has been closed yet')}
      />
    </Box>
  );
}

export default BusinessDaysPage;
