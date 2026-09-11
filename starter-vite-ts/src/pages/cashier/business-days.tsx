import type { GridColDef } from '@mui/x-data-grid';
import type { BusinessDayClose } from '../../api/shiftApi';

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
  Stack,
  Alert,
  Button,
  Dialog,
  TextField,
  Typography,
  IconButton,
  CardHeader,
  CardContent,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { useBranchContext } from 'src/contexts/branch-context';

import { shiftApi } from '../../api/shiftApi';
import { ServerDataGrid } from '../../components/server-data-grid';

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
  const [businessDate, setBusinessDate] = useState<string>(new Date().toISOString().slice(0, 10));

  // Reopen Dialog State
  const [selectedDay, setSelectedDay] = useState<BusinessDayClose | null>(null);
  const [reopenReason, setReopenReason] = useState<string>('');
  const [approvalRequestId, setApprovalRequestId] = useState<string>('appr-auto');

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

  const handleCloseDay = async () => {
    try {
      await shiftApi.closeBusinessDay({
        branchId,
        businessDate,
        currencyCode: 'IRR',
      });
      setSuccess(`Business Day ${businessDate} closed successfully`);
      setOpenCloseDialog(false);
      fetchBusinessDays();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to close business day');
    }
  };

  const handleReopenDay = async () => {
    if (!selectedDay) return;
    try {
      await shiftApi.reopenBusinessDay(selectedDay.id, {
        reason: reopenReason,
        approvalRequestId,
      });
      setSuccess(`Business Day ${selectedDay.business_date} reopened successfully`);
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
          {params.value}
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
    {
      field: 'closed_at',
      headerName: t('cashier.closedAt', 'Closed At'),
      width: 190,
      renderCell: (params) => (
        <Typography variant="body2" dir="ltr">
          {params.value ? new Date(params.value).toLocaleString() : '-'}
        </Typography>
      ),
    },
    {
      field: 'reopened_at',
      headerName: t('cashier.reopenedAt', 'Reopened At'),
      width: 190,
      renderCell: (params) => (
        <Typography variant="body2" dir="ltr">
          {params.value ? new Date(params.value).toLocaleString() : '-'}
        </Typography>
      ),
    },
    {
      field: 'totals',
      headerName: t('cashier.totals', 'EOD Summary'),
      flex: 1,
      minWidth: 200,
      renderCell: (params) => {
        const totals = params.value;
        if (!totals) return <Typography variant="caption" color="text.secondary">-</Typography>;
        return (
          <Typography variant="caption" dir="ltr">
            Shifts: {totals.shiftCount || totals.totalShifts || 0} | Sales: {Number(totals.grossSales || totals.totalSales || 0).toLocaleString()} IRR
          </Typography>
        );
      },
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
            onClick={() => setOpenCloseDialog(true)}
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
      <Dialog open={openCloseDialog} onClose={() => setOpenCloseDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('cashier.closeBusinessDayTitle', 'Close Business Day (EOD)')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('cashier.closeDayWarning', 'Closing the business day locks all cashier shifts and finalizes daily branch financial totals.')}
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
            <TextField
              label={t('cashier.businessDate', 'Business Date (YYYY-MM-DD)')}
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCloseDialog(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="primary" onClick={handleCloseDay}>
            {t('cashier.confirmClose', 'Confirm Close')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reopen Business Day Dialog */}
      <Dialog open={Boolean(selectedDay)} onClose={() => setSelectedDay(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('cashier.reopenBusinessDayTitle', 'Reopen Business Day')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('cashier.reopenWarning', 'Reopening a closed business day requires supervisor authorization and a recorded reason.')}
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
            <TextField
              label={t('cashier.approvalId', 'Approval Request ID')}
              value={approvalRequestId}
              onChange={(e) => setApprovalRequestId(e.target.value)}
              fullWidth
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
