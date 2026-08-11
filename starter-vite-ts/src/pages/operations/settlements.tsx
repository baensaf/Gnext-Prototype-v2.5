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

export function CourierSettlementsPage() {
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
      alert('Failed to preview settlement: ' + ((err as any).response?.data?.message || (err as any).message));
    }
  };

  const handleConfirmCreateSettlement = async () => {
    if (!selectedCourierId) return;
    try {
      await axios.post('/api/v1/delivery/settlements', { courier_id: selectedCourierId });
      setCreateDialogOpen(false);
      fetchData();
    } catch (err) {
      alert('Error creating settlement: ' + ((err as any).response?.data?.message || (err as any).message));
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
      alert('Failed to load settlement details');
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
      alert('Settlement draft updated successfully.');
      fetchData();
    } catch {
      alert('Failed to update settlement draft');
    }
  };

  const handleReviewSettlement = async () => {
    if (!activeSettlementDetail) return;
    try {
      await handleSaveSettlementDraft();
      const res = await axios.post(`/api/v1/delivery/settlements/${activeSettlementDetail.id}/review`);
      setActiveSettlementDetail(res.data);
      alert('Settlement status moved to UNDER_REVIEW');
      fetchData();
    } catch {
      alert('Error changing status to review');
    }
  };

  const handleCloseSettlement = async () => {
    if (!activeSettlementDetail) return;
    try {
      await axios.post(`/api/v1/delivery/settlements/${activeSettlementDetail.id}/close`);
      alert('Settlement closed successfully!');
      setDetailDialogOpen(false);
      fetchData();
    } catch (err) {
      alert('Error closing settlement: ' + ((err as any).response?.data?.message || (err as any).message));
    }
  };

  const handleReverseSettlement = async () => {
    if (!activeSettlementDetail) return;
    const reason = prompt('Enter reason for settlement reversal:');
    if (!reason) return;

    try {
      await axios.post(`/api/v1/delivery/settlements/${activeSettlementDetail.id}/reverse`, { reason });
      alert('Settlement reversed successfully.');
      setDetailDialogOpen(false);
      fetchData();
    } catch {
      alert('Error reversing settlement');
    }
  };

  const handleViewStatement = async (settlementId: string) => {
    try {
      const res = await axios.get(`/api/v1/delivery/settlements/${settlementId}/statement`);
      setStatementData(res.data);
      setStatementModalOpen(true);
    } catch {
      alert('Failed to load statement payload');
    }
  };

  const getStatusChip = (status: string) => {
    switch (status) {
      case 'CLOSED':
        return <Chip label="CLOSED" color="success" size="small" />;
      case 'UNDER_REVIEW':
        return <Chip label="UNDER REVIEW" color="warning" size="small" />;
      case 'REVERSED':
        return <Chip label="REVERSED" color="error" size="small" />;
      default:
        return <Chip label="DRAFT" color="info" size="small" />;
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('Courier Settlements') || 'Courier Settlements'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('Reconcile courier cash, mobile POS collections, discrepancies, and statements (Slice 17)') ||
              'Reconcile courier cash, mobile POS collections, discrepancies, and statements'}
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<Iconify icon="solar:restart-bold" />} onClick={fetchData}>
          Refresh
        </Button>
      </Stack>

      <Tabs value={tabValue} onChange={(_, val) => setTabValue(val)} sx={{ mb: 3 }}>
        <Tab label="Unsettled Couriers Overview" />
        <Tab label={`Settlement Batches (${batches.length})`} />
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
                        Code: {summary.courier_code}
                      </Typography>
                    </Box>
                    <Chip
                      label={`${summary.unsettled_count} Unsettled`}
                      color={summary.unsettled_count > 0 ? 'warning' : 'default'}
                      size="small"
                    />
                  </Stack>
                  <Divider sx={{ my: 1.5 }} />

                  <Stack spacing={1} sx={{ mb: 2 }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Expected Cash:
                      </Typography>
                      <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                        ${summary.expected_cash}
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Expected Mobile POS:
                      </Typography>
                      <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                        ${summary.expected_pos}
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Total Delivery Fees:
                      </Typography>
                      <Typography variant="body2">${summary.total_delivery_fees}</Typography>
                    </Stack>
                  </Stack>

                  <Button
                    fullWidth
                    variant="contained"
                    color="primary"
                    disabled={summary.unsettled_count === 0}
                    onClick={() => handleStartCreateSettlement(summary.courier_id)}
                  >
                    Start Settlement Batch
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
          {unsettledSummaries.length === 0 && (
            <Box sx={{ p: 4, width: '100%', textAlign: 'center' }}>
              <Typography color="text.secondary">No couriers found or no active delivery assignments.</Typography>
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
                  <TableCell sx={{ fontWeight: 'bold' }}>Settlement #</TableCell>
                  <TableCell>Courier</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Expected Cash</TableCell>
                  <TableCell align="right">Actual Cash</TableCell>
                  <TableCell align="right">Cash Disc.</TableCell>
                  <TableCell align="right">Expected POS</TableCell>
                  <TableCell align="right">Actual POS</TableCell>
                  <TableCell align="right">Net Total</TableCell>
                  <TableCell align="center">Actions</TableCell>
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
                    <TableCell align="right">${b.expected_cash_amount}</TableCell>
                    <TableCell align="right">${b.actual_cash_amount}</TableCell>
                    <TableCell align="right" sx={{ color: MoneyUtil.lessThan(b.cash_discrepancy_amount || '0', '0') ? 'error.main' : 'text.primary' }}>
                      ${b.cash_discrepancy_amount}
                    </TableCell>
                    <TableCell align="right">${b.expected_pos_amount}</TableCell>
                    <TableCell align="right">${b.actual_pos_amount}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                      ${b.net_settlement_amount}
                    </TableCell>
                    <TableCell align="center">
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'center' }}>
                        <Button size="small" variant="outlined" onClick={() => handleOpenDetail(b.id)}>
                          Detail
                        </Button>
                        <Button size="small" variant="text" onClick={() => handleViewStatement(b.id)}>
                          Statement
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
                {batches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} align="center" sx={{ py: 3 }}>
                      No settlement batches created yet.
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
        <DialogTitle>Preview New Courier Settlement</DialogTitle>
        <DialogContent dividers>
          {previewData && (
            <Stack spacing={2}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                Courier: {previewData.courier_name} ({previewData.courier_code})
              </Typography>

              <Grid container spacing={2}>
                <Grid size={{ xs: 6 }}>
                  <Paper sx={{ p: 2, bgcolor: 'background.neutral' }}>
                    <Typography variant="caption" color="text.secondary">
                      Expected Cash Collection
                    </Typography>
                    <Typography variant="h6">${previewData.expected_cash_amount}</Typography>
                  </Paper>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Paper sx={{ p: 2, bgcolor: 'background.neutral' }}>
                    <Typography variant="caption" color="text.secondary">
                      Expected Mobile POS Collection
                    </Typography>
                    <Typography variant="h6">${previewData.expected_pos_amount}</Typography>
                  </Paper>
                </Grid>
              </Grid>

              <Typography variant="subtitle2" sx={{ mt: 2 }}>
                Deliveries Included ({previewData.lines?.length || 0}):
              </Typography>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Order #</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Payment Method</TableCell>
                      <TableCell align="right">Exp Cash</TableCell>
                      <TableCell align="right">Exp POS</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {previewData.lines?.map((l: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell>{l.order_number}</TableCell>
                        <TableCell>{l.delivery_status}</TableCell>
                        <TableCell>{l.payment_method_code}</TableCell>
                        <TableCell align="right">${l.expected_cash}</TableCell>
                        <TableCell align="right">${l.expected_pos}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={handleConfirmCreateSettlement}>
            Create Draft Settlement
          </Button>
        </DialogActions>
      </Dialog>

      {/* DIALOG: Settlement Detail & Verification */}
      <Dialog open={detailDialogOpen} onClose={() => setDetailDialogOpen(false)} maxWidth="lg" fullWidth>
        {activeSettlementDetail && (
          <>
            <DialogTitle>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">
                  Settlement #{activeSettlementDetail.settlement_number} - {activeSettlementDetail.courier_name}
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
                        Expected Cash / Actual Cash
                      </Typography>
                      <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                        ${activeSettlementDetail.expected_cash_amount} / ${activeSettlementDetail.actual_cash_amount}
                      </Typography>
                      <Typography variant="caption" color={MoneyUtil.notEqual(activeSettlementDetail.cash_discrepancy_amount || '0', '0') ? 'error.main' : 'success.main'}>
                        Discrepancy: ${activeSettlementDetail.cash_discrepancy_amount}
                      </Typography>
                    </Paper>
                  </Grid>

                  <Grid size={{ xs: 12, sm: 3 }}>
                    <Paper sx={{ p: 2, bgcolor: 'background.neutral' }}>
                      <Typography variant="caption" color="text.secondary">
                        Expected POS / Actual POS
                      </Typography>
                      <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                        ${activeSettlementDetail.expected_pos_amount} / ${activeSettlementDetail.actual_pos_amount}
                      </Typography>
                      <Typography variant="caption" color={MoneyUtil.notEqual(activeSettlementDetail.pos_discrepancy_amount || '0', '0') ? 'error.main' : 'success.main'}>
                        Discrepancy: ${activeSettlementDetail.pos_discrepancy_amount}
                      </Typography>
                    </Paper>
                  </Grid>

                  <Grid size={{ xs: 12, sm: 3 }}>
                    <Paper sx={{ p: 2, bgcolor: 'background.neutral' }}>
                      <Typography variant="caption" color="text.secondary">
                        Compensations / Adjustments
                      </Typography>
                      <Typography variant="body2">Comp: ${activeSettlementDetail.total_compensation_amount}</Typography>
                      <Typography variant="body2">Adj: ${activeSettlementDetail.total_adjustment_amount}</Typography>
                    </Paper>
                  </Grid>

                  <Grid size={{ xs: 12, sm: 3 }}>
                    <Paper sx={{ p: 2, bgcolor: 'primary.light', color: 'primary.contrastText' }}>
                      <Typography variant="caption">Net Settlement Total</Typography>
                      <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                        ${activeSettlementDetail.net_settlement_amount}
                      </Typography>
                    </Paper>
                  </Grid>
                </Grid>

                {/* Adjustments & Notes */}
                {['DRAFT', 'UNDER_REVIEW'].includes(activeSettlementDetail.status) && (
                  <Stack direction="row" spacing={2}>
                    <TextField
                      label="Total Compensation"
                      size="small"
                      value={compAmount}
                      onChange={(e) => setCompAmount(e.target.value)}
                    />
                    <TextField
                      label="Total Adjustment"
                      size="small"
                      value={adjAmount}
                      onChange={(e) => setAdjAmount(e.target.value)}
                    />
                    <Button variant="outlined" size="small" onClick={handleSaveSettlementDraft}>
                      Recalculate & Save Draft
                    </Button>
                  </Stack>
                )}

                {/* Line Items Table */}
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                  Line Items & Receipt Verification
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">Verified</TableCell>
                        <TableCell>Order #</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Method</TableCell>
                        <TableCell align="right">Exp Cash</TableCell>
                        <TableCell align="right" width={120}>
                          Act Cash
                        </TableCell>
                        <TableCell align="right">Exp POS</TableCell>
                        <TableCell align="right" width={120}>
                          Act POS
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
                          <TableCell align="right">${line.expected_cash}</TableCell>
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
                              `$${line.actual_cash}`
                            )}
                          </TableCell>
                          <TableCell align="right">${line.expected_pos}</TableCell>
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
                              `$${line.actual_pos}`
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
              <Button onClick={() => setDetailDialogOpen(false)}>Close Window</Button>

              {activeSettlementDetail.status === 'DRAFT' && (
                <Button variant="contained" color="warning" onClick={handleReviewSettlement}>
                  Submit for Review
                </Button>
              )}

              {['DRAFT', 'UNDER_REVIEW'].includes(activeSettlementDetail.status) && (
                <Button variant="contained" color="success" onClick={handleCloseSettlement}>
                  Finalize & Close Settlement
                </Button>
              )}

              {activeSettlementDetail.status === 'CLOSED' && (
                <Button variant="outlined" color="error" onClick={handleReverseSettlement}>
                  Reverse Settlement
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
                  COURIER SETTLEMENT STATEMENT
                </Typography>
                <Typography variant="subtitle2" align="center" color="text.secondary" gutterBottom>
                  {statementData.settlement_number} | Date: {new Date(statementData.settlement_date).toLocaleString()}
                </Typography>
                <Divider sx={{ my: 2 }} />

                <Typography variant="body1">Courier: {statementData.courier_name} ({statementData.courier_code})</Typography>
                <Typography variant="body1">Status: {statementData.status}</Typography>

                <Box sx={{ my: 3 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>Summary:</Typography>
                  <Typography>Expected Cash: ${statementData.summary?.expected_cash_amount}</Typography>
                  <Typography>Actual Cash:   ${statementData.summary?.actual_cash_amount}</Typography>
                  <Typography>Cash Disc:     ${statementData.summary?.cash_discrepancy_amount}</Typography>
                  <Typography>Expected POS:  ${statementData.summary?.expected_pos_amount}</Typography>
                  <Typography>Actual POS:    ${statementData.summary?.actual_pos_amount}</Typography>
                  <Typography>POS Disc:      ${statementData.summary?.pos_discrepancy_amount}</Typography>
                  <Typography sx={{ mt: 1, fontWeight: 'bold' }}>
                    NET SETTLEMENT TOTAL: ${statementData.summary?.net_settlement_amount}
                  </Typography>
                </Box>
              </Paper>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setStatementModalOpen(false)}>Close</Button>
              <Button variant="contained" onClick={() => window.print()}>
                Print Statement
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}

export default CourierSettlementsPage;
