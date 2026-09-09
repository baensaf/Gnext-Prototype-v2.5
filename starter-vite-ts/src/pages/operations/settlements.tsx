import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import {
  Box,
  Tab,
  Card,
  Grid,
  Chip,
  Tabs,
  Table,
  Paper,
  Stack,
  Button,
  Dialog,
  Divider,
  TableRow,
  Checkbox,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  CardContent,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';

import { httpClient as axios } from 'src/api/httpClient';

import { Iconify } from 'src/components/iconify';

interface CourierUnsettledSummary {
  courier_id: string;
  courier_name: string;
  courier_code: string;
  unsettled_count: number;
  expected_cash: string;
  expected_pos: string;
  total_delivery_fees: string;
}

interface SettlementBatch {
  id: string;
  settlement_number: string;
  courier_name: string;
  courier_code: string;
  status: 'DRAFT' | 'UNDER_REVIEW' | 'CLOSED' | 'REVERSED';
  settlement_date: string;
  expected_cash_amount: string;
  actual_cash_amount: string;
  cash_discrepancy_amount: string;
  expected_pos_amount: string;
  actual_pos_amount: string;
  pos_discrepancy_amount: string;
  total_compensation_amount: string;
  total_adjustment_amount: string;
  net_settlement_amount: string;
  line_count: number;
}

interface SettlementLine {
  id: string;
  delivery_assignment_id: string;
  order_number: string;
  delivery_status: string;
  payment_method_code: string;
  expected_cash: string;
  actual_cash: string;
  expected_pos: string;
  actual_pos: string;
  receipt_verified: boolean;
  delivery_fee_amount: string;
  notes?: string;
}

interface CourierSettlementsPageProps {
  hideHeader?: boolean;
}

export function CourierSettlementsPage({ hideHeader = false }: CourierSettlementsPageProps = {}) {
  const { t } = useTranslation();
  const [tabValue, setTabValue] = useState(0);

  const [unsettledSummaries, setUnsettledSummaries] = useState<CourierUnsettledSummary[]>([]);
  const [batches, setBatches] = useState<SettlementBatch[]>([]);

  // Dialog States
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedCourierId, setSelectedCourierId] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<any>(null);

  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [activeSettlementDetail, setActiveSettlementDetail] = useState<any>(null);
  const [editableLines, setEditableLines] = useState<SettlementLine[]>([]);
  const [compAmount, setCompAmount] = useState('0.00');
  const [adjAmount, setAdjAmount] = useState('0.00');

  const [statementModalOpen, setStatementModalOpen] = useState(false);
  const [statementData, setStatementData] = useState<any>(null);

  const fetchData = async () => {
    try {
      const summaryRes = await axios.get('/api/v1/delivery/settlements/unsettled-summary');
      const summaryArray = Array.isArray(summaryRes.data)
        ? summaryRes.data
        : Array.isArray(summaryRes.data?.data)
        ? summaryRes.data.data
        : [];
      setUnsettledSummaries(summaryArray);

      const batchesRes = await axios.get('/api/v1/delivery/settlements');
      const batchesArray = Array.isArray(batchesRes.data)
        ? batchesRes.data
        : Array.isArray(batchesRes.data?.data)
        ? batchesRes.data.data
        : [];
      setBatches(batchesArray);
    } catch (err) {
      console.error('Error fetching settlement data:', err);
      setUnsettledSummaries([]);
      setBatches([]);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleStartCreateSettlement = async (courierId: string) => {
    setSelectedCourierId(courierId);
    try {
      const res = await axios.post('/api/v1/delivery/settlements/preview', { courier_id: courierId });
      setPreviewData(res.data);
      setCreateDialogOpen(true);
    } catch (err) {
      alert(t('settlements.errors.previewFailed') + ': ' + ((err as any).response?.data?.message || (err as any).message));
    }
  };

  const handleConfirmCreateSettlement = async () => {
    if (!selectedCourierId) return;
    try {
      await axios.post('/api/v1/delivery/settlements', { courier_id: selectedCourierId });
      setCreateDialogOpen(false);
      fetchData();
    } catch (err) {
      alert(t('settlements.errors.createFailed') + ': ' + ((err as any).response?.data?.message || (err as any).message));
    }
  };

  const handleOpenDetail = async (settlementId: string) => {
    try {
      const res = await axios.get(`/api/v1/delivery/settlements/${settlementId}`);
      setActiveSettlementDetail(res.data);
      setEditableLines(res.data.lines || []);
      setCompAmount(res.data.total_compensation_amount || '0.00');
      setAdjAmount(res.data.total_adjustment_amount || '0.00');
      setDetailDialogOpen(true);
    } catch {
      alert(t('settlements.errors.detailFailed'));
    }
  };

  const handleLineReceiptToggle = (lineId: string) => {
    setEditableLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, receipt_verified: !l.receipt_verified } : l))
    );
  };

  const handleLineActualChange = (lineId: string, field: 'actual_cash' | 'actual_pos', value: string) => {
    setEditableLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, [field]: value } : l))
    );
  };

  const handleSaveSettlementDraft = async () => {
    if (!activeSettlementDetail) return;
    try {
      const linePayload = editableLines.map((l) => ({
        id: l.id,
        actual_cash: MoneyUtil.format(l.actual_cash || '0', 2),
        actual_pos: MoneyUtil.format(l.actual_pos || '0', 2),
        receipt_verified: l.receipt_verified,
      }));

      const res = await axios.patch(`/api/v1/delivery/settlements/${activeSettlementDetail.id}`, {
        lines: linePayload,
        total_compensation_amount: MoneyUtil.format(compAmount || '0', 2),
        total_adjustment_amount: MoneyUtil.format(adjAmount || '0', 2),
      });
      setActiveSettlementDetail(res.data);
      setEditableLines(res.data.lines || []);
      alert(t('settlements.alerts.draftUpdated'));
      fetchData();
    } catch {
      alert(t('settlements.errors.updateDraftFailed'));
    }
  };

  const handleReviewSettlement = async () => {
    if (!activeSettlementDetail) return;
    try {
      await handleSaveSettlementDraft();
      const res = await axios.post(`/api/v1/delivery/settlements/${activeSettlementDetail.id}/review`);
      setActiveSettlementDetail(res.data);
      alert(t('settlements.alerts.movedToReview'));
      fetchData();
    } catch {
      alert(t('settlements.errors.reviewFailed'));
    }
  };

  const handleCloseSettlement = async () => {
    if (!activeSettlementDetail) return;
    try {
      await axios.post(`/api/v1/delivery/settlements/${activeSettlementDetail.id}/close`);
      alert(t('settlements.alerts.closed'));
      setDetailDialogOpen(false);
      fetchData();
    } catch (err) {
      alert(t('settlements.errors.closeFailed') + ': ' + ((err as any).response?.data?.message || (err as any).message));
    }
  };

  const handleReverseSettlement = async () => {
    if (!activeSettlementDetail) return;
    const reason = prompt(t('settlements.prompts.reverseReason'));
    if (!reason) return;

    try {
      await axios.post(`/api/v1/delivery/settlements/${activeSettlementDetail.id}/reverse`, { reason });
      alert(t('settlements.alerts.reversed'));
      setDetailDialogOpen(false);
      fetchData();
    } catch {
      alert(t('settlements.errors.reverseFailed'));
    }
  };

  const handleViewStatement = async (settlementId: string) => {
    try {
      const res = await axios.get(`/api/v1/delivery/settlements/${settlementId}/statement`);
      setStatementData(res.data);
      setStatementModalOpen(true);
    } catch {
      alert(t('settlements.errors.statementFailed'));
    }
  };

  const getStatusChip = (status: string) => {
    switch (status) {
      case 'CLOSED':
        return <Chip label={t('settlements.statuses.closed')} color="success" size="small" />;
      case 'UNDER_REVIEW':
        return <Chip label={t('settlements.statuses.underReview')} color="warning" size="small" />;
      case 'REVERSED':
        return <Chip label={t('settlements.statuses.reversed')} color="error" size="small" />;
      default:
        return <Chip label={t('settlements.statuses.draft')} color="info" size="small" />;
    }
  };

  return (
    <Box sx={{ p: hideHeader ? 0 : 3 }}>
      {!hideHeader && (
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Box>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
                {t('settlements.title')}
              </Typography>
              <Chip label="V5" color="info" size="small" sx={{ fontWeight: 'bold' }} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {t('settlements.subtitle')}
            </Typography>
          </Box>
          <Button variant="outlined" startIcon={<Iconify icon="solar:restart-bold" />} onClick={fetchData}>
            {t('settlements.refresh')}
          </Button>
        </Stack>
      )}

      <Tabs value={tabValue} onChange={(_, val) => setTabValue(val)} sx={{ mb: 3 }}>
        <Tab label={t('settlements.tabs.overview')} />
        <Tab label={t('settlements.tabs.batches', { count: batches.length })} />
      </Tabs>

      {/* TAB 0: Unsettled Couriers Overview */}
      {tabValue === 0 && (
        <Grid container spacing={3}>
          {(Array.isArray(unsettledSummaries) ? unsettledSummaries : []).map((summary) => (
            <Grid key={summary.courier_id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card sx={{ border: '1px solid', borderColor: 'divider', height: '100%' }}>
                <CardContent>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Box>
                      <Typography variant="h6">{summary.courier_name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('settlements.overview.code')}: {summary.courier_code}
                      </Typography>
                    </Box>
                    <Chip
                      label={t('settlements.overview.unsettled', { count: summary.unsettled_count })}
                      color={summary.unsettled_count > 0 ? 'warning' : 'default'}
                      size="small"
                    />
                  </Stack>
                  <Divider sx={{ my: 1.5 }} />

                  <Stack spacing={1} sx={{ mb: 2 }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('settlements.overview.expectedCash')}
                      </Typography>
                      <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }} dir="ltr">
                        {MoneyUtil.formatCurrency(summary.expected_cash || 0)} IRR
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('settlements.overview.expectedPos')}
                      </Typography>
                      <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }} dir="ltr">
                        {MoneyUtil.formatCurrency(summary.expected_pos || 0)} IRR
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('settlements.overview.totalDeliveryFees')}
                      </Typography>
                      <Typography variant="body2" dir="ltr">
                        {MoneyUtil.formatCurrency(summary.total_delivery_fees || 0)} IRR
                      </Typography>
                    </Stack>
                  </Stack>

                  <Button
                    fullWidth
                    variant="contained"
                    color="primary"
                    disabled={summary.unsettled_count === 0}
                    onClick={() => handleStartCreateSettlement(summary.courier_id)}
                  >
                    {t('settlements.overview.startBatch')}
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
          {unsettledSummaries.length === 0 && (
            <Box sx={{ p: 4, width: '100%', textAlign: 'center' }}>
              <Typography color="text.secondary">{t('settlements.overview.empty')}</Typography>
            </Box>
          )}
        </Grid>
      )}

      {/* TAB 1: Settlement Batches List */}
      {tabValue === 1 && (
        <Card>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>{t('settlements.batches.settlementNumber')}</TableCell>
                  <TableCell>{t('settlements.batches.courier')}</TableCell>
                  <TableCell>{t('settlements.batches.status')}</TableCell>
                  <TableCell align="right">{t('settlements.batches.expectedCash')}</TableCell>
                  <TableCell align="right">{t('settlements.batches.actualCash')}</TableCell>
                  <TableCell align="right">{t('settlements.batches.cashDisc')}</TableCell>
                  <TableCell align="right">{t('settlements.batches.expectedPos')}</TableCell>
                  <TableCell align="right">{t('settlements.batches.actualPos')}</TableCell>
                  <TableCell align="right">{t('settlements.batches.netTotal')}</TableCell>
                  <TableCell align="center">{t('settlements.batches.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(Array.isArray(batches) ? batches : []).map((b) => (
                  <TableRow key={b.id} hover>
                    <TableCell sx={{ fontWeight: 'bold' }}>{b.settlement_number}</TableCell>
                    <TableCell>
                      {b.courier_name} ({b.courier_code})
                    </TableCell>
                    <TableCell>{getStatusChip(b.status)}</TableCell>
                    <TableCell align="right" dir="ltr">{MoneyUtil.formatCurrency(b.expected_cash_amount || 0)} IRR</TableCell>
                    <TableCell align="right" dir="ltr">{MoneyUtil.formatCurrency(b.actual_cash_amount || 0)} IRR</TableCell>
                    <TableCell align="right" dir="ltr" sx={{ color: MoneyUtil.lessThan(b.cash_discrepancy_amount || '0', '0') ? 'error.main' : 'text.primary' }}>
                      {MoneyUtil.formatCurrency(b.cash_discrepancy_amount || 0)} IRR
                    </TableCell>
                    <TableCell align="right" dir="ltr">{MoneyUtil.formatCurrency(b.expected_pos_amount || 0)} IRR</TableCell>
                    <TableCell align="right" dir="ltr">{MoneyUtil.formatCurrency(b.actual_pos_amount || 0)} IRR</TableCell>
                    <TableCell align="right" dir="ltr" sx={{ fontWeight: 'bold' }}>
                      {MoneyUtil.formatCurrency(b.net_settlement_amount || 0)} IRR
                    </TableCell>
                    <TableCell align="center">
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'center' }}>
                        <Button size="small" variant="outlined" onClick={() => handleOpenDetail(b.id)}>
                          {t('settlements.batches.detail')}
                        </Button>
                        <Button size="small" variant="text" onClick={() => handleViewStatement(b.id)}>
                          {t('settlements.batches.statement')}
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
                {batches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} align="center" sx={{ py: 3 }}>
                      {t('settlements.batches.empty')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      {/* DIALOG: Create Settlement Preview */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('settlements.previewModal.title')}</DialogTitle>
        <DialogContent dividers>
          {previewData && (
            <Stack spacing={2}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                {t('settlements.previewModal.courier')}: {previewData.courier_name} ({previewData.courier_code})
              </Typography>

              <Grid container spacing={2}>
                <Grid size={{ xs: 6 }}>
                  <Paper sx={{ p: 2, bgcolor: 'background.neutral' }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('settlements.previewModal.expectedCash')}
                    </Typography>
                    <Typography variant="h6" dir="ltr">{MoneyUtil.formatCurrency(previewData.expected_cash_amount || 0)} IRR</Typography>
                  </Paper>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Paper sx={{ p: 2, bgcolor: 'background.neutral' }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('settlements.previewModal.expectedPos')}
                    </Typography>
                    <Typography variant="h6" dir="ltr">{MoneyUtil.formatCurrency(previewData.expected_pos_amount || 0)} IRR</Typography>
                  </Paper>
                </Grid>
              </Grid>

              <Typography variant="subtitle2" sx={{ mt: 2 }}>
                {t('settlements.previewModal.deliveriesIncluded', { count: previewData.lines?.length || 0 })}
              </Typography>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('settlements.previewModal.orderNumber')}</TableCell>
                      <TableCell>{t('settlements.previewModal.status')}</TableCell>
                      <TableCell>{t('settlements.previewModal.paymentMethod')}</TableCell>
                      <TableCell align="right">{t('settlements.previewModal.expCash')}</TableCell>
                      <TableCell align="right">{t('settlements.previewModal.expPos')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {previewData.lines?.map((l: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell>{l.order_number}</TableCell>
                        <TableCell>{l.delivery_status}</TableCell>
                        <TableCell>{l.payment_method_code}</TableCell>
                        <TableCell align="right" dir="ltr">{MoneyUtil.formatCurrency(l.expected_cash || 0)} IRR</TableCell>
                        <TableCell align="right" dir="ltr">{MoneyUtil.formatCurrency(l.expected_pos || 0)} IRR</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>{t('settlements.previewModal.cancel')}</Button>
          <Button variant="contained" color="primary" onClick={handleConfirmCreateSettlement}>
            {t('settlements.previewModal.createDraft')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* DIALOG: Settlement Detail & Verification */}
      <Dialog open={detailDialogOpen} onClose={() => setDetailDialogOpen(false)} maxWidth="lg" fullWidth>
        {activeSettlementDetail && (
          <>
            <DialogTitle>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography component="span" variant="h6">
                  {t('settlements.detailModal.title', { number: activeSettlementDetail.settlement_number, name: activeSettlementDetail.courier_name })}
                </Typography>
                {getStatusChip(activeSettlementDetail.status)}
              </Stack>
            </DialogTitle>

            <DialogContent dividers>
              <Stack spacing={3}>
                {/* Summary Row */}
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 3 }}>
                    <Paper sx={{ p: 2, bgcolor: 'background.neutral' }}>
                      <Typography variant="caption" color="text.secondary">
                        {t('settlements.detailModal.expectedActualCash')}
                      </Typography>
                      <Typography variant="body1" sx={{ fontWeight: 'bold' }} dir="ltr">
                        {MoneyUtil.formatCurrency(activeSettlementDetail.expected_cash_amount || 0)} / {MoneyUtil.formatCurrency(activeSettlementDetail.actual_cash_amount || 0)} IRR
                      </Typography>
                      <Typography variant="caption" dir="ltr" color={MoneyUtil.notEqual(activeSettlementDetail.cash_discrepancy_amount || '0', '0') ? 'error.main' : 'success.main'}>
                        {t('settlements.detailModal.discrepancy')}: {MoneyUtil.formatCurrency(activeSettlementDetail.cash_discrepancy_amount || 0)} IRR
                      </Typography>
                    </Paper>
                  </Grid>

                  <Grid size={{ xs: 12, sm: 3 }}>
                    <Paper sx={{ p: 2, bgcolor: 'background.neutral' }}>
                      <Typography variant="caption" color="text.secondary">
                        {t('settlements.detailModal.expectedActualPos')}
                      </Typography>
                      <Typography variant="body1" sx={{ fontWeight: 'bold' }} dir="ltr">
                        {MoneyUtil.formatCurrency(activeSettlementDetail.expected_pos_amount || 0)} / {MoneyUtil.formatCurrency(activeSettlementDetail.actual_pos_amount || 0)} IRR
                      </Typography>
                      <Typography variant="caption" dir="ltr" color={MoneyUtil.notEqual(activeSettlementDetail.pos_discrepancy_amount || '0', '0') ? 'error.main' : 'success.main'}>
                        {t('settlements.detailModal.discrepancy')}: {MoneyUtil.formatCurrency(activeSettlementDetail.pos_discrepancy_amount || 0)} IRR
                      </Typography>
                    </Paper>
                  </Grid>

                  <Grid size={{ xs: 12, sm: 3 }}>
                    <Paper sx={{ p: 2, bgcolor: 'background.neutral' }}>
                      <Typography variant="caption" color="text.secondary">
                        {t('settlements.detailModal.compensationsAdjustments')}
                      </Typography>
                      <Typography variant="body2" dir="ltr">{t('settlements.detailModal.comp')} {MoneyUtil.formatCurrency(activeSettlementDetail.total_compensation_amount || 0)} IRR</Typography>
                      <Typography variant="body2" dir="ltr">{t('settlements.detailModal.adj')} {MoneyUtil.formatCurrency(activeSettlementDetail.total_adjustment_amount || 0)} IRR</Typography>
                    </Paper>
                  </Grid>

                  <Grid size={{ xs: 12, sm: 3 }}>
                    <Paper sx={{ p: 2, bgcolor: 'primary.light', color: 'primary.contrastText' }}>
                      <Typography variant="caption">{t('settlements.detailModal.netSettlementTotal')}</Typography>
                      <Typography variant="h5" sx={{ fontWeight: 'bold' }} dir="ltr">
                        {MoneyUtil.formatCurrency(activeSettlementDetail.net_settlement_amount || 0)} IRR
                      </Typography>
                    </Paper>
                  </Grid>
                </Grid>

                {/* Adjustments & Notes */}
                {['DRAFT', 'UNDER_REVIEW'].includes(activeSettlementDetail.status) && (
                  <Stack direction="row" spacing={2}>
                    <TextField
                      label={t('settlements.detailModal.totalComp')}
                      size="small"
                      value={compAmount}
                      onChange={(e) => setCompAmount(e.target.value)}
                    />
                    <TextField
                      label={t('settlements.detailModal.totalAdj')}
                      size="small"
                      value={adjAmount}
                      onChange={(e) => setAdjAmount(e.target.value)}
                    />
                    <Button variant="outlined" size="small" onClick={handleSaveSettlementDraft}>
                      {t('settlements.detailModal.recalculateSave')}
                    </Button>
                  </Stack>
                )}

                {/* Line Items Table */}
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                  {t('settlements.detailModal.lineItemsTitle')}
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">{t('settlements.detailModal.verified')}</TableCell>
                        <TableCell>{t('settlements.detailModal.orderNumber')}</TableCell>
                        <TableCell>{t('settlements.detailModal.status')}</TableCell>
                        <TableCell>{t('settlements.detailModal.method')}</TableCell>
                        <TableCell align="right">{t('settlements.detailModal.expCash')}</TableCell>
                        <TableCell align="right" width={120}>
                          {t('settlements.detailModal.actCash')}
                        </TableCell>
                        <TableCell align="right">{t('settlements.detailModal.expPos')}</TableCell>
                        <TableCell align="right" width={120}>
                          {t('settlements.detailModal.actPos')}
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {editableLines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={line.receipt_verified}
                              disabled={!['DRAFT', 'UNDER_REVIEW'].includes(activeSettlementDetail.status)}
                              onChange={() => handleLineReceiptToggle(line.id)}
                            />
                          </TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>{line.order_number}</TableCell>
                          <TableCell>{line.delivery_status}</TableCell>
                          <TableCell>{line.payment_method_code}</TableCell>
                          <TableCell align="right" dir="ltr">{MoneyUtil.formatCurrency(line.expected_cash || 0)} IRR</TableCell>
                          <TableCell align="right">
                            {['DRAFT', 'UNDER_REVIEW'].includes(activeSettlementDetail.status) ? (
                              <TextField
                                size="small"
                                variant="outlined"
                                value={line.actual_cash}
                                onChange={(e) => handleLineActualChange(line.id, 'actual_cash', e.target.value)}
                                slotProps={{ htmlInput: { style: { textAlign: 'right', padding: '4px 8px' } } }}
                              />
                            ) : (
                              <span dir="ltr">{MoneyUtil.formatCurrency(line.actual_cash || 0)} IRR</span>
                            )}
                          </TableCell>
                          <TableCell align="right" dir="ltr">{MoneyUtil.formatCurrency(line.expected_pos || 0)} IRR</TableCell>
                          <TableCell align="right">
                            {['DRAFT', 'UNDER_REVIEW'].includes(activeSettlementDetail.status) ? (
                              <TextField
                                size="small"
                                variant="outlined"
                                value={line.actual_pos}
                                onChange={(e) => handleLineActualChange(line.id, 'actual_pos', e.target.value)}
                                slotProps={{ htmlInput: { style: { textAlign: 'right', padding: '4px 8px' } } }}
                              />
                            ) : (
                              <span dir="ltr">{MoneyUtil.formatCurrency(line.actual_pos || 0)} IRR</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Stack>
            </DialogContent>

            <DialogActions>
              <Button onClick={() => setDetailDialogOpen(false)}>{t('settlements.detailModal.closeWindow')}</Button>

              {activeSettlementDetail.status === 'DRAFT' && (
                <Button variant="contained" color="warning" onClick={handleReviewSettlement}>
                  {t('settlements.detailModal.submitReview')}
                </Button>
              )}

              {['DRAFT', 'UNDER_REVIEW'].includes(activeSettlementDetail.status) && (
                <Button variant="contained" color="success" onClick={handleCloseSettlement}>
                  {t('settlements.detailModal.finalizeClose')}
                </Button>
              )}

              {activeSettlementDetail.status === 'CLOSED' && (
                <Button variant="outlined" color="error" onClick={handleReverseSettlement}>
                  {t('settlements.detailModal.reverseSettlement')}
                </Button>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* DIALOG: Statement Printable Modal */}
      <Dialog open={statementModalOpen} onClose={() => setStatementModalOpen(false)} maxWidth="md" fullWidth>
        {statementData && (
          <>
            <DialogTitle>{statementData.statement_title}</DialogTitle>
            <DialogContent dividers>
              <Paper sx={{ p: 4, fontFamily: 'monospace' }} variant="outlined">
                <Typography variant="h5" align="center" gutterBottom sx={{ fontWeight: 'bold' }}>
                  {t('settlements.statementModal.title')}
                </Typography>
                <Typography variant="subtitle2" align="center" color="text.secondary" gutterBottom>
                  {statementData.settlement_number} | {t('settlements.statementModal.date')}: {new Date(statementData.settlement_date).toLocaleString()}
                </Typography>
                <Divider sx={{ my: 2 }} />

                <Typography variant="body1">{t('settlements.statementModal.courier')}: {statementData.courier_name} ({statementData.courier_code})</Typography>
                <Typography variant="body1">{t('settlements.statementModal.status')}: {statementData.status}</Typography>

                <Box sx={{ my: 3 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>{t('settlements.statementModal.summary')}</Typography>
                  <Typography>{t('settlements.statementModal.expectedCash')} {MoneyUtil.formatCurrency(statementData.summary?.expected_cash_amount || 0)} IRR</Typography>
                  <Typography>{t('settlements.statementModal.actualCash')}   {MoneyUtil.formatCurrency(statementData.summary?.actual_cash_amount || 0)} IRR</Typography>
                  <Typography>{t('settlements.statementModal.cashDisc')}     {MoneyUtil.formatCurrency(statementData.summary?.cash_discrepancy_amount || 0)} IRR</Typography>
                  <Typography>{t('settlements.statementModal.expectedPos')}  {MoneyUtil.formatCurrency(statementData.summary?.expected_pos_amount || 0)} IRR</Typography>
                  <Typography>{t('settlements.statementModal.actualPos')}    {MoneyUtil.formatCurrency(statementData.summary?.actual_pos_amount || 0)} IRR</Typography>
                  <Typography>{t('settlements.statementModal.posDisc')}      {MoneyUtil.formatCurrency(statementData.summary?.pos_discrepancy_amount || 0)} IRR</Typography>
                  <Typography sx={{ mt: 1, fontWeight: 'bold' }}>
                    {t('settlements.statementModal.netTotal')} {MoneyUtil.formatCurrency(statementData.summary?.net_settlement_amount || 0)} IRR
                  </Typography>
                </Box>
              </Paper>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setStatementModalOpen(false)}>{t('settlements.statementModal.close')}</Button>
              <Button variant="contained" onClick={() => window.print()}>
                {t('settlements.statementModal.print')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}

export default CourierSettlementsPage;
