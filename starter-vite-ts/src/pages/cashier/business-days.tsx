import type { GridColDef } from '@mui/x-data-grid';
import type { BusinessDayClose, DayCloseOpenOrder, DayCloseOpenOrders } from '../../api/shiftApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import LockIcon from '@mui/icons-material/Lock';
import TodayIcon from '@mui/icons-material/Today';
import RefreshIcon from '@mui/icons-material/Refresh';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import {
  Box,
  Card,
  Grid,
  Chip,
  Link,
  Stack,
  Alert,
  Button,
  Dialog,
  Checkbox,
  TextField,
  Typography,
  IconButton,
  CardHeader,
  CardContent,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  FormControlLabel,
} from '@mui/material';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { fDate , fDateTime } from 'src/utils/format-time';
import { businessDate as businessDayOf } from 'src/utils/calendar';

import { useBranchContext } from 'src/contexts/branch-context';

import { CalendarDateField } from 'src/components/calendar-date-field';

import { shiftApi } from '../../api/shiftApi';
import { ServerDataGrid } from '../../components/server-data-grid';

const errorText = (err: any, fallback: string) =>
  err?.response?.data?.message || err?.detail || err?.message || fallback;

/** The day after `date` (YYYY-MM-DD), but never a day that has not started yet. */
const nextBusinessDate = (date: string) => {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + 1);
  const nextText = businessDayOf(next);
  const today = businessDayOf();
  return nextText > today ? today : nextText;
};

const ISSUE_FALLBACK: Record<string, string> = {
  UNPAID: 'Unpaid',
  NOT_SUBMITTED: 'Draft, never sent',
  AWAITING_ACCEPTANCE: 'Waiting for acceptance',
  DELIVERY_NOT_FINISHED: 'Delivery not finished',
};

/** One open order in the close dialog, linked to where it can be settled. */
function OpenOrderLine({ order }: { order: DayCloseOpenOrder }) {
  const { t } = useTranslation();
  const href =
    order.issue === 'AWAITING_ACCEPTANCE'
      ? `${paths.app.orders.incoming}?order=${order.id}`
      : paths.app.orders.detail(order.id);
  const amount = order.issue === 'UNPAID' ? order.outstandingTotal : order.grandTotal;

  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1, py: 0.75, flexWrap: 'wrap' }}>
      <Link component={RouterLink} href={href} target="_blank" rel="noopener" variant="subtitle2" dir="ltr">
        {order.orderNumber}
      </Link>
      <Typography variant="caption" color="text.secondary">
        {order.tableNumber ? `${order.orderType} · ${order.tableNumber}` : order.orderType} ·{' '}
        <span dir="ltr">{fDate(order.businessDate)}</span>
      </Typography>
      <Box sx={{ flexGrow: 1 }} />
      {order.issue && (
        <Chip
          size="small"
          color="warning"
          variant="outlined"
          label={t(`cashier.openOrders.issue.${order.issue}`, ISSUE_FALLBACK[order.issue])}
        />
      )}
      <Typography variant="body2" dir="ltr">
        {Number(amount || 0).toLocaleString()} IRR
      </Typography>
    </Stack>
  );
}

export function BusinessDaysPage() {
  const { t } = useTranslation();

  const [businessDays, setBusinessDays] = useState<BusinessDayClose[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Close Dialog State
  const [openCloseDialog, setOpenCloseDialog] = useState<boolean>(false);
  // The day closed is the day of the branch you are working in. It was a picker, which let
  // a manager standing in one shop close another's day; the header already says which.
  const { branches, selectedBranchId: branchId, selectedBranch } = useBranchContext();
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));
  // The local operating day: the UTC one is yesterday in Tehran until 03:30.
  const [businessDate, setBusinessDate] = useState<string>(businessDayOf());

  // What the close would do with the branch's open orders, read again whenever the day changes.
  const [openOrders, setOpenOrders] = useState<DayCloseOpenOrders | null>(null);
  const [openOrdersLoading, setOpenOrdersLoading] = useState<boolean>(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [carryOver, setCarryOver] = useState<boolean>(false);
  const [carryOverReason, setCarryOverReason] = useState<string>('');

  // Reopen Dialog State
  const [selectedDay, setSelectedDay] = useState<BusinessDayClose | null>(null);
  const [reopenReason, setReopenReason] = useState<string>('');

  const fetchBusinessDays = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await shiftApi.getBusinessDays({ branch: branchId || undefined });
      setBusinessDays(res.data);
      setTotalCount(res.total);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to load business days');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    fetchBusinessDays();
  }, [fetchBusinessDays]);

  const loadOpenOrders = useCallback(async () => {
    if (!branchId || !businessDate) {
      setOpenOrders(null);
      return;
    }
    setOpenOrdersLoading(true);
    try {
      setOpenOrders(await shiftApi.getDayCloseOpenOrders({ branchId, businessDate, currencyCode: 'IRR' }));
    } catch (err: any) {
      setOpenOrders(null);
      setCloseError(errorText(err, t('cashier.openOrders.loadFailed', 'Could not check the open orders')));
    } finally {
      setOpenOrdersLoading(false);
    }
  }, [branchId, businessDate, t]);

  // Closing a day this branch has already closed would only be refused, so say so up front.
  const alreadyClosed = businessDays.some(
    (day) => day.branch_id === branchId && day.business_date === businessDate && day.status === 'CLOSED'
  );

  useEffect(() => {
    if (openCloseDialog && !alreadyClosed) loadOpenOrders();
  }, [openCloseDialog, alreadyClosed, loadOpenOrders]);

  const openDialog = () => {
    setCloseError(null);
    setCarryOver(false);
    setCarryOverReason('');
    setOpenCloseDialog(true);
  };

  const toComplete = alreadyClosed ? [] : (openOrders?.toComplete ?? []);
  const needsDecision = alreadyClosed ? [] : (openOrders?.needsDecision ?? []);
  const carryingOver = needsDecision.length > 0;
  const canClose =
    Boolean(branchId) &&
    !alreadyClosed &&
    !openOrdersLoading &&
    openOrders !== null &&
    (!carryingOver || (carryOver && carryOverReason.trim().length > 0));

  const handleCloseDay = async () => {
    setCloseError(null);
    try {
      await shiftApi.closeBusinessDay({
        branchId,
        businessDate,
        currencyCode: 'IRR',
        ...(carryingOver ? { carryOverReason: carryOverReason.trim() } : {}),
      });
      setSuccess(t('cashier.dayClosed', 'Business day {{date}} closed', { date: businessDate }));
      setOpenCloseDialog(false);
      // The dialog kept the day just closed, which could only be refused next time.
      setBusinessDate(nextBusinessDate(businessDate));
      fetchBusinessDays();
    } catch (err: any) {
      setCloseError(errorText(err, 'Failed to close business day'));
      // An order may have been paid, cancelled or opened since the list was read.
      loadOpenOrders();
    }
  };

  const handleReopenDay = async () => {
    if (!selectedDay) return;
    try {
      await shiftApi.reopenBusinessDay(selectedDay.id, { reason: reopenReason.trim() });
      setSuccess(t('cashier.dayReopened', 'Business day {{date}} reopened', { date: fDate(selectedDay.business_date) }));
      setSelectedDay(null);
      setReopenReason('');
      fetchBusinessDays();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to reopen business day');
    }
  };

  const closedCount = businessDays.filter((b) => b.status === 'CLOSED').length;
  const reopenedCount = businessDays.filter((b) => b.status === 'REOPENED').length;

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
      // The raw uuid told an operator nothing about which of their shops this row was.
      renderCell: (params) => (
        <Typography variant="body2">{branchNameById.get(params.value) || params.value}</Typography>
      ),
    },
    {
      field: 'status',
      headerName: t('common.status', 'Status'),
      width: 130,
      renderCell: (params) => (
        <Chip
          size="small"
          label={params.value}
          color={params.value === 'CLOSED' ? 'default' : 'warning'}
          variant={params.value === 'CLOSED' ? 'filled' : 'outlined'}
        />
      ),
    },
    // The day's figures sit beside its status, ahead of the timestamps: at the end of the row
    // they were the part a narrow screen scrolled out of view.
    {
      field: 'totals',
      headerName: t('cashier.totals', 'EOD Summary'),
      minWidth: 240,
      flex: 1,
      renderCell: (params) => {
        const totals = params.value;
        if (!totals) return <Typography variant="caption" color="text.secondary">-</Typography>;
        // The close stores the day's order count and sales; "Shifts" was read from a field
        // it never writes, so every row said zero.
        return (
          <Typography variant="caption">
            {t('cashier.ordersCount', 'Orders')}: {totals.orderCount ?? 0} · {t('cashier.sales', 'Sales')}:{' '}
            <span dir="ltr">{Number(totals.grossSales || totals.totalSales || 0).toLocaleString()} IRR</span>
          </Typography>
        );
      },
    },
    {
      field: 'carried_over',
      headerName: t('cashier.openOrders.carriedOver', 'Carried over'),
      width: 120,
      sortable: false,
      renderCell: (params) => {
        const count = params.row.totals?.carriedOverOrders ?? 0;
        if (!count) return <Typography variant="caption" color="text.secondary">-</Typography>;
        return (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label={count}
            title={params.row.totals?.carryOverReason || undefined}
          />
        );
      },
    },
    {
      field: 'closed_at',
      headerName: t('cashier.closedAt', 'Closed At'),
      width: 190,
      renderCell: (params) => (
        <Typography variant="body2" dir="ltr">
          {params.value ? fDateTime(params.value) : '-'}
        </Typography>
      ),
    },
    {
      field: 'reopened_at',
      headerName: t('cashier.reopenedAt', 'Reopened At'),
      width: 190,
      renderCell: (params) => (
        <Typography variant="body2" dir="ltr">
          {params.value ? fDateTime(params.value) : '-'}
        </Typography>
      ),
    },
    {
      field: 'actions',
      headerName: t('common.actions', 'Actions'),
      width: 140,
      sortable: false,
      renderCell: (params) => {
        const row = params.row as BusinessDayClose;
        if (row.status === 'CLOSED') {
          return (
            <Button
              size="small"
              variant="outlined"
              color="warning"
              startIcon={<LockOpenIcon />}
              onClick={() => setSelectedDay(row)}
            >
              {t('cashier.reopen', 'Reopen')}
            </Button>
          );
        }
        return (
          <Chip size="small" label={t('cashier.reopened', 'Reopened')} color="warning" />
        );
      },
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      {/* Header */}
      <Stack sx={{ flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 2, mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('cashier.businessDays', 'Business Day Operations & EOD Ledger')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('cashier.businessDaysSubtitle', 'End-of-day store closures, branch reconciliation, and supervisor reopen authorizations')}
          </Typography>
        </Box>
        <Stack sx={{ flexDirection: 'row', gap: 1.5 }}>
          <IconButton onClick={fetchBusinessDays} title={t('common.refresh', 'Refresh')}>
            <RefreshIcon />
          </IconButton>
          <Button
            variant="contained"
            color="primary"
            startIcon={<LockIcon />}
            onClick={openDialog}
          >
            {t('cashier.closeDay', 'Close Business Day (EOD)')}
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {/* KPI Metrics */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card>
            <CardHeader
              avatar={<TodayIcon color="primary" />}
              title={t('cashier.totalDays', 'Total Recorded Days')}
            />
            <CardContent sx={{ pt: 0 }}>
              <Typography variant="h3" sx={{ fontWeight: 700 }}>
                {totalCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card>
            <CardHeader
              avatar={<EventAvailableIcon color="success" />}
              title={t('cashier.closedDays', 'Closed Days (Finalized)')}
            />
            <CardContent sx={{ pt: 0 }}>
              <Typography variant="h3" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                {closedCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card>
            <CardHeader
              avatar={<WarningAmberIcon color="warning" />}
              title={t('cashier.reopenedDays', 'Reopened Days')}
            />
            <CardContent sx={{ pt: 0 }}>
              <Typography variant="h3" sx={{ fontWeight: 700, color: 'warning.main' }}>
                {reopenedCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Main Ledger Table */}
      <ServerDataGrid
        rows={businessDays}
        columns={columns}
        loading={loading}
        height={560}
        emptyTitle={t('cashier.noBusinessDays', 'No business day closure records found')}
      />

      {/* Close Business Day Dialog */}
      <Dialog open={openCloseDialog} onClose={() => setOpenCloseDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('cashier.closeBusinessDayTitle', 'Close Business Day (EOD)')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t(
              'cashier.closeDayWarning',
              'Every drawer at the branch must be counted down first. Closing the day fixes the branch’s sales for that date.'
            )}
          </Typography>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t('cashier.branch', 'Branch')}
              </Typography>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {selectedBranch?.name || '-'}
              </Typography>
            </Box>
            <CalendarDateField
              label={t('cashier.businessDate', 'Business Date')}
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />

            {!branchId && (
              <Alert severity="info">
                {t('cashier.openOrders.pickBranch', 'Pick a branch in the header to close its day.')}
              </Alert>
            )}

            {alreadyClosed && (
              <Alert severity="info">
                {t(
                  'cashier.openOrders.alreadyClosed',
                  'This day is already closed at this branch. Pick another date, or reopen it from the list.'
                )}
              </Alert>
            )}

            {!alreadyClosed && openOrdersLoading && (
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  {t('cashier.openOrders.checking', 'Checking open orders…')}
                </Typography>
              </Stack>
            )}

            {!alreadyClosed && !openOrdersLoading && openOrders && toComplete.length === 0 && needsDecision.length === 0 && (
              <Alert severity="success">
                {t('cashier.openOrders.noneOpen', 'No orders are left open for this day.')}
              </Alert>
            )}

            {!openOrdersLoading && toComplete.length > 0 && (
              <Box>
                <Typography variant="subtitle2">
                  {t('cashier.openOrders.toComplete', '{{count}} paid order(s) will be marked completed', {
                    count: toComplete.length,
                  })}
                </Typography>
                <Box sx={{ maxHeight: 180, overflowY: 'auto' }}>
                  {toComplete.map((order) => (
                    <OpenOrderLine key={order.id} order={order} />
                  ))}
                </Box>
              </Box>
            )}

            {!openOrdersLoading && needsDecision.length > 0 && (
              <Box>
                <Alert severity="warning" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2">
                    {t('cashier.openOrders.needsDecision', '{{count}} order(s) need a decision before the day closes', {
                      count: needsDecision.length,
                    })}
                  </Typography>
                  <Typography variant="body2">
                    {t(
                      'cashier.openOrders.needsDecisionHelp',
                      'Take the payment, cancel, or finish the delivery for each, or carry them over to the next day with a reason.'
                    )}
                  </Typography>
                </Alert>
                <Box sx={{ maxHeight: 220, overflowY: 'auto' }}>
                  {needsDecision.map((order) => (
                    <OpenOrderLine key={order.id} order={order} />
                  ))}
                </Box>
                <FormControlLabel
                  sx={{ mt: 1 }}
                  control={<Checkbox checked={carryOver} onChange={(e) => setCarryOver(e.target.checked)} />}
                  label={t('cashier.openOrders.carryOver', 'Close anyway and carry these orders over')}
                />
                {carryOver && (
                  <TextField
                    label={t('cashier.openOrders.carryOverReason', 'Why they are carried over')}
                    value={carryOverReason}
                    onChange={(e) => setCarryOverReason(e.target.value)}
                    multiline
                    rows={2}
                    fullWidth
                    required
                    sx={{ mt: 1 }}
                  />
                )}
              </Box>
            )}

            {closeError && <Alert severity="error">{closeError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCloseDialog(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="primary" disabled={!canClose} onClick={handleCloseDay}>
            {carryingOver
              ? t('cashier.openOrders.closeAndCarryOver', 'Close day and carry over')
              : t('cashier.confirmClose', 'Confirm Close')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reopen Business Day Dialog */}
      <Dialog open={Boolean(selectedDay)} onClose={() => setSelectedDay(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('cashier.reopenBusinessDayTitle', 'Reopen Business Day')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('cashier.reopenWarningManager', 'Only a manager can reopen a closed day, and the reason is kept in the audit log.')}
          </Typography>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t('cashier.reason', 'Reopen Reason')}
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="e.g. Unreconciled evening shift correction"
              multiline
              rows={2}
              fullWidth
              required
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedDay(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="warning" disabled={!reopenReason.trim()} onClick={handleReopenDay}>
            {t('cashier.confirmReopen', 'Confirm Reopen')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default BusinessDaysPage;
