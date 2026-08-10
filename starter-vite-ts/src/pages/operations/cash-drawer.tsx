import type { ReasonCode } from 'src/api/settingsApi';
import type { Branch, Terminal } from 'src/api/tenantApi';
import type { ActiveShiftResponse } from 'src/api/cashDrawerApi';

import React, { useState, useEffect, useCallback } from 'react';

import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import RemoveCircleIcon from '@mui/icons-material/RemoveCircle';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import {
  Box,
  Card,
  Chip,
  Grid,
  Stack,
  Alert,
  Paper,
  Table,
  Button,
  Dialog,
  Select,
  Divider,
  MenuItem,
  TableRow,
  TextField,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  InputLabel,
  CardContent,
  DialogTitle,
  FormControl,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { tenantApi } from 'src/api/tenantApi';
import { settingsApi } from 'src/api/settingsApi';
import { cashDrawerApi } from 'src/api/cashDrawerApi';

export function CashDrawerPage() {
  const [activeShiftData, setActiveShiftData] = useState<ActiveShiftResponse | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Open Shift Dialog
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [openBranchId, setOpenBranchId] = useState('');
  const [openTerminalId, setOpenTerminalId] = useState('');
  const [openingFloat, setOpeningFloat] = useState('5000000');

  // Transaction Dialog (Pay In / Pay Out / Safe Drop)
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [txType, setTxType] = useState<'PAY_IN' | 'PAY_OUT' | 'SAFE_DROP'>('PAY_IN');
  const [txAmount, setTxAmount] = useState('');
  const [txReasonId, setTxReasonId] = useState('');
  const [txNote, setTxNote] = useState('');

  // Close Shift Dialog
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [actualCashInput, setActualCashInput] = useState('');
  const [closeNotes, setCloseNotes] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const active = await cashDrawerApi.getActiveShift();
      setActiveShiftData(active);

      const bList = await tenantApi.getBranches();
      setBranches(bList);
      if (bList.length > 0 && !openBranchId) setOpenBranchId(bList[0].id);

      const tList = await tenantApi.getTerminals();
      setTerminals(tList);
      if (tList.length > 0 && !openTerminalId) setOpenTerminalId(tList[0].id);

      const rList = await settingsApi.getReasonCodes();
      setReasonCodes(rList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load cash drawer shift');
    } finally {
      setLoading(false);
    }
  }, [openBranchId, openTerminalId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await cashDrawerApi.openShift({
        branch_id: openBranchId,
        terminal_id: openTerminalId,
        user_id: '5b66e29d-8bf9-432c-b0df-aeb72547a9b5', // Admin user
        opening_float: openingFloat,
      });
      setOpenDialogOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to open shift');
    }
  };

  const handlePostTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShiftData) return;
    try {
      await cashDrawerApi.postTransaction(activeShiftData.shift.id, {
        transaction_type: txType,
        amount: txAmount,
        reason_code_id: txReasonId || undefined,
        note: txNote || undefined,
      });
      setTxDialogOpen(false);
      setTxAmount('');
      setTxNote('');
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to post cash transaction');
    }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShiftData) return;
    try {
      await cashDrawerApi.closeShift(activeShiftData.shift.id, {
        actual_cash: actualCashInput,
        notes: closeNotes || undefined,
      });
      setCloseDialogOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to close shift');
    }
  };

  const summary = activeShiftData?.summary;
  const shift = activeShiftData?.shift;
  const transactions = activeShiftData?.transactions || [];

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Cash Drawer & Shift Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            End-of-Day cash reconciliation, float initialization, and petty cash drops
          </Typography>
        </Box>
        {shift ? (
          <Button
            variant="contained"
            color="error"
            startIcon={<LockIcon />}
            onClick={() => {
              setActualCashInput(summary?.expected_cash || '0');
              setCloseDialogOpen(true);
            }}
            sx={{ fontWeight: 'bold' }}
          >
            End-of-Day Shift Close
          </Button>
        ) : (
          <Button
            variant="contained"
            color="success"
            startIcon={<LockOpenIcon />}
            onClick={() => setOpenDialogOpen(true)}
            sx={{ fontWeight: 'bold' }}
          >
            Open New Shift
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {shift ? (
        <Stack spacing={3}>
          {/* Active Shift Header Banner */}
          <Card sx={{ borderRadius: 3, boxShadow: 2, bgcolor: 'background.paper' }}>
            <CardContent sx={{ p: 3 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                    <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                      Shift #{shift.shift_number}
                    </Typography>
                    <Chip label="ACTIVE OPEN" color="success" size="small" />
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    Opened at: {new Date(shift.opened_at).toLocaleString()}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1.5}>
                  <Button
                    variant="outlined"
                    color="primary"
                    startIcon={<AddCircleIcon />}
                    onClick={() => {
                      setTxType('PAY_IN');
                      setTxDialogOpen(true);
                    }}
                  >
                    Pay In
                  </Button>
                  <Button
                    variant="outlined"
                    color="warning"
                    startIcon={<RemoveCircleIcon />}
                    onClick={() => {
                      setTxType('PAY_OUT');
                      setTxDialogOpen(true);
                    }}
                  >
                    Pay Out
                  </Button>
                  <Button
                    variant="outlined"
                    color="info"
                    startIcon={<AccountBalanceWalletIcon />}
                    onClick={() => {
                      setTxType('SAFE_DROP');
                      setTxDialogOpen(true);
                    }}
                  >
                    Safe Drop
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          {/* Metric Summary Cards */}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <Card sx={{ borderRadius: 3, boxShadow: 1, textAlign: 'center', p: 2 }}>
                <Typography variant="caption" color="text.secondary">Opening Float</Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1 }}>
                  {Number(summary?.opening_float).toLocaleString()}
                </Typography>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <Card sx={{ borderRadius: 3, boxShadow: 1, textAlign: 'center', p: 2 }}>
                <Typography variant="caption" color="text.secondary">Cash Sales</Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1, color: 'success.main' }}>
                  +{Number(summary?.cash_sales).toLocaleString()}
                </Typography>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <Card sx={{ borderRadius: 3, boxShadow: 1, textAlign: 'center', p: 2 }}>
                <Typography variant="caption" color="text.secondary">Pay In</Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1, color: 'info.main' }}>
                  +{Number(summary?.pay_in).toLocaleString()}
                </Typography>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <Card sx={{ borderRadius: 3, boxShadow: 1, textAlign: 'center', p: 2 }}>
                <Typography variant="caption" color="text.secondary">Pay Out</Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1, color: 'error.main' }}>
                  -{Number(summary?.pay_out).toLocaleString()}
                </Typography>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <Card sx={{ borderRadius: 3, boxShadow: 1, textAlign: 'center', p: 2 }}>
                <Typography variant="caption" color="text.secondary">Safe Drop</Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1, color: 'warning.main' }}>
                  -{Number(summary?.safe_drop).toLocaleString()}
                </Typography>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <Card sx={{ borderRadius: 3, boxShadow: 2, textAlign: 'center', p: 2, bgcolor: 'primary.lighter' }}>
                <Typography variant="caption" color="primary.dark font-bold">EXPECTED CASH</Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1, color: 'primary.main' }}>
                  {Number(summary?.expected_cash).toLocaleString()} IRR
                </Typography>
              </Card>
            </Grid>
          </Grid>

          {/* Transactions Table */}
          <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
                Shift Cash Transactions Log
              </Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Time</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell align="right">Amount (IRR)</TableCell>
                      <TableCell>Note / Reason</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {transactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell>{new Date(tx.recorded_at).toLocaleTimeString()}</TableCell>
                        <TableCell>
                          <Chip
                            label={tx.transaction_type}
                            color={tx.transaction_type === 'PAY_IN' ? 'info' : tx.transaction_type === 'PAY_OUT' ? 'error' : 'warning'}
                            size="small"
                          />
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                          {Number(tx.amount).toLocaleString()} IRR
                        </TableCell>
                        <TableCell>{tx.note || '—'}</TableCell>
                      </TableRow>
                    ))}
                    {transactions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          No cash drops or pay-ins posted for this shift yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Stack>
      ) : (
        <Card sx={{ borderRadius: 3, p: 4, textAlign: 'center' }}>
          <Typography variant="h6" color="text.secondary" sx={{ mb: 2 }}>
            No Active Cash Drawer Shift
          </Typography>
          <Button
            variant="contained"
            color="success"
            startIcon={<LockOpenIcon />}
            onClick={() => setOpenDialogOpen(true)}
            sx={{ fontWeight: 'bold' }}
          >
            Open Shift Now
          </Button>
        </Card>
      )}

      {/* Open Shift Modal */}
      <Dialog open={openDialogOpen} onClose={() => setOpenDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>Open Cash Drawer Shift</DialogTitle>
        <Box component="form" onSubmit={handleOpenShift}>
          <DialogContent sx={{ minWidth: 360, pt: 2 }}>
            <Stack spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Branch</InputLabel>
                <Select
                  value={openBranchId}
                  label="Branch"
                  onChange={(e) => setOpenBranchId(e.target.value)}
                >
                  {branches.map((b) => (
                    <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth size="small">
                <InputLabel>Terminal</InputLabel>
                <Select
                  value={openTerminalId}
                  label="Terminal"
                  onChange={(e) => setOpenTerminalId(e.target.value)}
                >
                  {terminals.map((t) => (
                    <MenuItem key={t.id} value={t.id}>{t.name} ({t.code})</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                size="small"
                label="Opening Float Amount (IRR)"
                type="number"
                required
                fullWidth
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" color="success" sx={{ fontWeight: 'bold' }}>
              Confirm Open Shift
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Post Transaction Modal */}
      <Dialog open={txDialogOpen} onClose={() => setTxDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          Post {txType} Transaction
        </DialogTitle>
        <Box component="form" onSubmit={handlePostTransaction}>
          <DialogContent sx={{ minWidth: 360, pt: 2 }}>
            <Stack spacing={2}>
              <TextField
                size="small"
                label="Amount (IRR)"
                type="number"
                required
                fullWidth
                value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
              />

              {(txType === 'PAY_OUT' || txType === 'SAFE_DROP') && (
                <FormControl fullWidth size="small" required>
                  <InputLabel>Reason Code</InputLabel>
                  <Select
                    value={txReasonId}
                    label="Reason Code"
                    onChange={(e) => setTxReasonId(e.target.value)}
                  >
                    {reasonCodes.map((r) => (
                      <MenuItem key={r.id} value={r.id}>
                        {r.name} ({r.code})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <TextField
                size="small"
                label="Note / Description"
                fullWidth
                multiline
                rows={2}
                value={txNote}
                onChange={(e) => setTxNote(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setTxDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" sx={{ fontWeight: 'bold' }}>
              Post Transaction
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* EOD Shift Close & Cash Reconciliation Modal */}
      <Dialog open={closeDialogOpen} onClose={() => setCloseDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          End-of-Day Shift Close & Cash Reconciliation
        </DialogTitle>
        <Box component="form" onSubmit={handleCloseShift}>
          <DialogContent sx={{ minWidth: 400, pt: 2 }}>
            {summary && (
              <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2, bgcolor: 'background.neutral' }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">Expected Cash in Drawer:</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                    {Number(summary.expected_cash).toLocaleString()} IRR
                  </Typography>
                </Stack>

                <Divider sx={{ my: 1 }} />

                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>Variance (Over/Short):</Typography>
                  <Typography
                    variant="subtitle2"
                    sx={{
                      fontWeight: 'bold',
                      color: Number(actualCashInput || '0') - Number(summary.expected_cash) >= 0 ? 'success.main' : 'error.main',
                    }}
                  >
                    {(Number(actualCashInput || '0') - Number(summary.expected_cash)).toLocaleString()} IRR
                  </Typography>
                </Stack>
              </Paper>
            )}

            <Stack spacing={2}>
              <TextField
                size="small"
                label="Actual Counted Cash in Drawer (IRR)"
                type="number"
                required
                fullWidth
                value={actualCashInput}
                onChange={(e) => setActualCashInput(e.target.value)}
              />

              <TextField
                size="small"
                label="Closing Notes / Discrepancy Reason"
                fullWidth
                multiline
                rows={2}
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCloseDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" color="error" sx={{ fontWeight: 'bold' }}>
              Confirm EOD Close & Reconcile
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
}
