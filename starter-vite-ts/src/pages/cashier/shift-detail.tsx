import type { CashierShift } from '../../api/shiftApi';

import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router';
import { useState, useEffect, useCallback } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import HistoryIcon from '@mui/icons-material/History';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import {
  Box,
  Card,
  Grid,
  Chip,
  Stack,
  Table,
  Alert,
  Button,
  Divider,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Container,
  Typography,
  IconButton,
  CardHeader,
  CardContent,
  CircularProgress,
} from '@mui/material';

import { shiftApi } from '../../api/shiftApi';

export function ShiftDetailPage() {
  const params = useParams<{ id?: string; shiftId?: string }>();
  const id = params.id || params.shiftId;
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [shift, setShift] = useState<CashierShift | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchShift = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await shiftApi.getShiftById(id);
      setShift(data);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to load shift');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchShift();
  }, [fetchShift]);

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error || !shift) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/cashier/shifts')} sx={{ mb: 2 }}>
          {t('common.back', 'Back to Shifts')}
        </Button>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || t('cashier.shiftNotFound', 'Shift not found')}
        </Alert>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchShift}>
          {t('common.retry', 'Retry')}
        </Button>
      </Container>
    );
  }

  const getShiftColor = (state?: string) => {
    switch (state) {
      case 'OPEN':
        return 'success';
      case 'CLOSING_REVIEW':
        return 'warning';
      case 'CLOSED':
        return 'default';
      default:
        return 'default';
    }
  };

  const getMovementColor = (type?: string) => {
    switch (type) {
      case 'OPENING_FLOAT':
      case 'CASH_PAYMENT':
      case 'PAID_IN':
        return 'success';
      case 'CASH_REFUND':
      case 'PAID_OUT':
        return 'error';
      default:
        return 'default';
    }
  };

  const shortOver = Number(shift.short_over || shift.over_short_amount || 0);

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Stack sx={{ flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 2, mb: 3 }}>
        <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/cashier/shifts')}>
            {t('common.back', 'Back')}
          </Button>
          <Box>
            <Typography variant="h4" sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              {t('cashier.shiftDetail', 'Cashier Shift')} <span dir="ltr">#{shift.shift_number || shift.id?.slice(0, 8)}</span>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('cashier.businessDate', 'Business Date')}: <strong>{shift.business_date}</strong> | {t('cashier.terminal', 'Terminal')}: <strong>{shift.terminal_id}</strong>
            </Typography>
          </Box>
        </Stack>
        <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
          <Chip
            label={shift.state || shift.status || 'OPEN'}
            color={getShiftColor(shift.state || shift.status)}
            variant="filled"
          />
          <IconButton onClick={fetchShift} title={t('common.refresh', 'Refresh')}>
            <RefreshIcon />
          </IconButton>
        </Stack>
      </Stack>

      <Grid container spacing={3}>
        {/* Cash Balances */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardHeader
              avatar={<PointOfSaleIcon color="primary" />}
              title={t('cashier.shiftSummary', 'Drawer Cash Reconciliation')}
            />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('cashier.openingFloat', 'Opening Float / Cash')}:</Typography>
                  <Typography sx={{ fontWeight: 600 }} dir="ltr">
                    {Number(shift.opening_cash || shift.opening_float || 0).toLocaleString()} {shift.currency_code || 'IRR'}
                  </Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('cashier.expectedCash', 'Expected Cash Drawer Balance')}:</Typography>
                  <Typography sx={{ fontWeight: 600 }} dir="ltr">
                    {Number(shift.expected_cash || 0).toLocaleString()} {shift.currency_code || 'IRR'}
                  </Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('cashier.actualCash', 'Actual Counted Cash')}:</Typography>
                  <Typography sx={{ fontWeight: 600 }} dir="ltr">
                    {shift.actual_cash !== undefined && shift.actual_cash !== null
                      ? `${Number(shift.actual_cash).toLocaleString()} ${shift.currency_code || 'IRR'}`
                      : t('cashier.uncounted', 'Pending Count (Open)')}
                  </Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('cashier.shortOver', 'Cash Variance (Short/Over)')}:</Typography>
                  <Typography
                    sx={{
                      fontWeight: 600,
                      color: shortOver === 0 ? 'text.primary' : shortOver > 0 ? 'info.main' : 'error.main',
                    }}
                    dir="ltr"
                  >
                    {shortOver > 0 ? `+${shortOver.toLocaleString()}` : shortOver.toLocaleString()} {shift.currency_code || 'IRR'}
                  </Typography>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Shift Details & Timing */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardHeader
              avatar={<ReceiptLongIcon color="info" />}
              title={t('cashier.shiftInfo', 'Shift Timestamps & Status')}
            />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('cashier.openedAt', 'Opened At')}:</Typography>
                  <Typography dir="ltr">{new Date(shift.opened_at).toLocaleString()}</Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('cashier.closedAt', 'Closed At')}:</Typography>
                  <Typography dir="ltr">{shift.closed_at ? new Date(shift.closed_at).toLocaleString() : t('cashier.currentlyActive', 'Currently Active')}</Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('cashier.branch', 'Branch')}:</Typography>
                  <Typography>{shift.branch_id}</Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('cashier.closingNote', 'Closing Notes')}:</Typography>
                  <Typography>{shift.closing_note || t('common.none', 'None')}</Typography>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Cash Movements Ledger */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardHeader
              avatar={<HistoryIcon color="action" />}
              title={t('cashier.movements', 'Cash Drawer Movements & Audit Trail')}
            />
            <Divider />
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('cashier.movementType', 'Movement Type')}</TableCell>
                  <TableCell>{t('cashier.amount', 'Amount')}</TableCell>
                  <TableCell>{t('cashier.postedAt', 'Timestamp')}</TableCell>
                  <TableCell>{t('cashier.reason', 'Reason / Ref')}</TableCell>
                  <TableCell>{t('cashier.link', 'Related Payment/Refund')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shift.movements && shift.movements.length > 0 ? (
                  shift.movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <Chip
                          size="small"
                          label={m.type}
                          color={getMovementColor(m.type)}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell dir="ltr" sx={{ fontWeight: 600 }}>
                        {Number(m.amount).toLocaleString()} {m.currency_code || shift.currency_code || 'IRR'}
                      </TableCell>
                      <TableCell dir="ltr">
                        {new Date(m.posted_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {m.reason_text || m.reference || '-'}
                      </TableCell>
                      <TableCell dir="ltr">
                        {m.payment_id ? `Payment: ${m.payment_id.slice(0, 8)}` : m.refund_id ? `Refund: ${m.refund_id.slice(0, 8)}` : '-'}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                      {t('cashier.noMovements', 'No individual cash movements recorded in this shift yet.')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}

export default ShiftDetailPage;
