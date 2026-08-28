import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router';
import { useState, useEffect, useCallback } from 'react';

import InfoIcon from '@mui/icons-material/Info';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
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

import { deliveryApi } from '../../api/deliveryApi';

export function SettlementDetailPage() {
  const params = useParams<{ id?: string; settlementId?: string }>();
  const id = params.id || params.settlementId;
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [settlement, setSettlement] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchSettlement = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await deliveryApi.getSettlementDetail(id);
      setSettlement(data);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to load settlement');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchSettlement();
  }, [fetchSettlement]);

  const handleReview = async () => {
    if (!id) return;
    try {
      await deliveryApi.reviewSettlement(id);
      setActionMessage(t('settlements.alerts.movedToReview'));
      fetchSettlement();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || t('settlements.errors.reviewFailed'));
    }
  };

  const handleClose = async () => {
    if (!id) return;
    try {
      await deliveryApi.closeSettlement(id);
      setActionMessage(t('settlements.alerts.closed'));
      fetchSettlement();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || t('settlements.errors.closeFailed'));
    }
  };

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error || !settlement) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/delivery/settlements')} sx={{ mb: 2 }}>
          {t('common.back', 'Back to Settlements')}
        </Button>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || t('settlements.notFound', 'Settlement not found')}
        </Alert>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchSettlement}>
          {t('common.retry', 'Retry')}
        </Button>
      </Container>
    );
  }

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'CLOSED':
        return 'success';
      case 'REVIEWED':
      case 'PENDING':
      case 'UNDER_REVIEW':
        return 'warning';
      case 'DRAFT':
        return 'info';
      case 'REVERSED':
      case 'CANCELLED':
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status?: string) => {
    switch (status) {
      case 'CLOSED':
        return t('settlements.statuses.closed');
      case 'REVIEWED':
        return t('settlements.statuses.reviewed');
      case 'PENDING':
        return t('settlements.statuses.pending');
      case 'UNDER_REVIEW':
        return t('settlements.statuses.underReview');
      case 'REVERSED':
        return t('settlements.statuses.reversed');
      default:
        return t('settlements.statuses.draft');
    }
  };

  const variance = Number(settlement.variance || settlement.over_short_amount || 0);

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Stack sx={{ flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 2, mb: 3 }}>
        <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/delivery/settlements')}>
            {t('common.back', 'Back')}
          </Button>
          <Box>
            <Typography variant="h4" sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              {t('settlements.detailTitle', 'Courier Settlement')} <span dir="ltr">#{settlement.settlement_number || settlement.id?.slice(0, 8)}</span>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('delivery.courier', 'Courier')}: <strong>{settlement.courier_name || settlement.courier?.name || settlement.courier_id}</strong>
            </Typography>
          </Box>
        </Stack>
        <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
          <Chip label="V5" color="info" size="small" sx={{ fontWeight: 'bold' }} />
          <Chip
            label={getStatusLabel(settlement.status)}
            color={getStatusColor(settlement.status)}
            variant="filled"
          />
          <IconButton onClick={fetchSettlement} title={t('common.refresh', 'Refresh')}>
            <RefreshIcon />
          </IconButton>
        </Stack>
      </Stack>

      {actionMessage && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setActionMessage(null)}>
          {actionMessage}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Balances & Cash Breakdown */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardHeader
              avatar={<AccountBalanceWalletIcon color="primary" />}
              title={t('settlements.summary', 'Financial Reconciliation')}
            />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('settlements.expectedCash', 'Expected Cash')}:</Typography>
                  <Typography sx={{ fontWeight: 600 }} dir="ltr">
                    {Number(settlement.expected_cash || 0).toLocaleString()} {settlement.currency_code || 'IRR'}
                  </Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('settlements.actualCash', 'Actual Cash Submitted')}:</Typography>
                  <Typography sx={{ fontWeight: 600 }} dir="ltr">
                    {Number(settlement.actual_cash || 0).toLocaleString()} {settlement.currency_code || 'IRR'}
                  </Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('settlements.variance', 'Cash Variance (Over/Short)')}:</Typography>
                  <Typography
                    sx={{
                      fontWeight: 600,
                      color: variance === 0 ? 'success.main' : variance > 0 ? 'info.main' : 'error.main',
                    }}
                    dir="ltr"
                  >
                    {variance > 0 ? `+${variance.toLocaleString()}` : variance.toLocaleString()} {settlement.currency_code || 'IRR'}
                  </Typography>
                </Stack>
                <Divider />
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('settlements.posAmount', 'Mobile POS Total')}:</Typography>
                  <Typography dir="ltr">
                    {Number(settlement.pos_collected || settlement.mobile_pos_amount || 0).toLocaleString()} {settlement.currency_code || 'IRR'}
                  </Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('settlements.compensation', 'Courier Compensation/Fee')}:</Typography>
                  <Typography sx={{ fontWeight: 600, color: 'success.main' }} dir="ltr">
                    {Number(settlement.total_compensation || settlement.commission_amount || 0).toLocaleString()} {settlement.currency_code || 'IRR'}
                  </Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('settlements.netRemittance', 'Net Cash Due to Merchant')}:</Typography>
                  <Typography sx={{ fontWeight: 700, color: 'primary.main' }} dir="ltr">
                    {Number(settlement.net_amount || (Number(settlement.actual_cash || 0) - Number(settlement.total_compensation || 0))).toLocaleString()} {settlement.currency_code || 'IRR'}
                  </Typography>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Metadata & Actions */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Stack spacing={3}>
            <Card>
              <CardHeader
                avatar={<InfoIcon color="info" />}
                title={t('settlements.meta', 'Settlement Information')}
              />
              <Divider />
              <CardContent>
                <Stack spacing={2}>
                  <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Typography color="text.secondary">{t('settlements.status', 'Status')}:</Typography>
                    <Chip size="small" label={getStatusLabel(settlement.status)} color={getStatusColor(settlement.status)} />
                  </Stack>
                  <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Typography color="text.secondary">{t('settlements.businessDate', 'Business Date')}:</Typography>
                    <Typography dir="ltr">{settlement.business_date || t('common.today', 'Today')}</Typography>
                  </Stack>
                  <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Typography color="text.secondary">{t('settlements.created', 'Created At')}:</Typography>
                    <Typography dir="ltr">{settlement.created_at ? new Date(settlement.created_at).toLocaleString() : '-'}</Typography>
                  </Stack>
                  <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Typography color="text.secondary">{t('settlements.notes', 'Notes')}:</Typography>
                    <Typography>{settlement.notes || t('common.none', 'None')}</Typography>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            {/* Lifecycle Action Buttons */}
            <Card sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                {t('settlements.actions', 'Settlement Actions')}
              </Typography>
              <Stack spacing={1.5}>
                {settlement.status === 'DRAFT' && (
                  <Button
                    variant="contained"
                    color="warning"
                    fullWidth
                    onClick={handleReview}
                  >
                    {t('settlements.review', 'Mark as Reviewed')}
                  </Button>
                )}
                {(settlement.status === 'DRAFT' || settlement.status === 'REVIEWED') && (
                  <Button
                    variant="contained"
                    color="success"
                    fullWidth
                    onClick={handleClose}
                  >
                    {t('settlements.close', 'Close Settlement')}
                  </Button>
                )}
              </Stack>
            </Card>
          </Stack>
        </Grid>

        {/* Deliveries / Settlement Lines Table */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardHeader
              avatar={<AssignmentTurnedInIcon color="action" />}
              title={t('settlements.deliveries', 'Included Deliveries & Orders')}
            />
            <Divider />
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('orders.orderNumber', 'Order #')}</TableCell>
                  <TableCell>{t('delivery.customer', 'Customer')}</TableCell>
                  <TableCell>{t('delivery.grandTotal', 'Order Total')}</TableCell>
                  <TableCell>{t('delivery.cashCollected', 'Cash Collected')}</TableCell>
                  <TableCell>{t('delivery.posCollected', 'POS Collected')}</TableCell>
                  <TableCell>{t('delivery.compensation', 'Fee')}</TableCell>
                  <TableCell>{t('common.status', 'Status')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {settlement.lines && settlement.lines.length > 0 ? (
                  settlement.lines.map((line: any) => (
                    <TableRow key={line.id}>
                      <TableCell dir="ltr">
                        <strong>{line.order_number || line.order_id?.slice(0, 8)}</strong>
                      </TableCell>
                      <TableCell>{line.customer_name || '-'}</TableCell>
                      <TableCell dir="ltr">{Number(line.order_total || line.grand_total || 0).toLocaleString()} IRR</TableCell>
                      <TableCell dir="ltr">{Number(line.cash_collected || 0).toLocaleString()} IRR</TableCell>
                      <TableCell dir="ltr">{Number(line.pos_collected || line.pos_amount || 0).toLocaleString()} IRR</TableCell>
                      <TableCell dir="ltr" sx={{ color: 'success.main', fontWeight: 600 }}>
                        {Number(line.compensation_amount || line.fee || 0).toLocaleString()} IRR
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={line.status || line.state || 'COMPLETED'} color="success" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                      {t('settlements.noLines', 'No individual delivery lines recorded for this settlement.')}
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

export default SettlementDetailPage;
