import type { ReasonCode } from 'src/api/settingsApi';
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

import { MoneyUtil } from 'src/utils/money.util';

import { settingsApi } from 'src/api/settingsApi';
import { cashDrawerApi } from 'src/api/cashDrawerApi';

import { RegisterNotice } from 'src/components/shift/register-notice';
import { OpenShiftDialog } from 'src/components/shift/open-shift-dialog';
import { CloseShiftDialog } from 'src/components/shift/close-shift-dialog';
import { useRegisterShift } from 'src/components/shift/use-register-shift';
import { DeviceTerminalDialog } from 'src/components/shift/device-terminal-dialog';


export function CashDrawerPage() {
  const [activeShiftData, setActiveShiftData] = useState<ActiveShiftResponse | null>(null);
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The drawer is this device's register; its branch is the register's. Nobody picks either.
  const register = useRegisterShift();
  const { terminal, mismatch } = register;
  const [setupOpen, setSetupOpen] = useState(false);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);

  // Transaction Dialog (Pay In / Pay Out / Safe Drop)
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [txType, setTxType] = useState<'PAY_IN' | 'PAY_OUT' | 'SAFE_DROP'>('PAY_IN');
  const [txAmount, setTxAmount] = useState('');
  const [txReasonId, setTxReasonId] = useState('');
  const [txNote, setTxNote] = useState('');

  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const active =
        terminal && !mismatch ? await cashDrawerApi.getActiveShift(terminal.branch_id, terminal.id) : null;
      setActiveShiftData(active);

      const rList = await settingsApi.getReasonCodes();
      setReasonCodes(rList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load cash drawer shift');
    } finally {
      setLoading(false);
    }
  }, [terminal, mismatch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const ready = !!terminal && !mismatch;

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
            onClick={() => setCloseDialogOpen(true)}
            sx={{ fontWeight: 'bold' }}
          >
            Close Shift
          </Button>
        ) : ready ? (
          <Button
            variant="contained"
            color="success"
            startIcon={<LockOpenIcon />}
            onClick={() => setOpenDialogOpen(true)}
            sx={{ fontWeight: 'bold' }}
          >
            Open New Shift
          </Button>
        ) : null}
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
                  {MoneyUtil.formatCurrency(summary?.opening_float)}
                </Typography>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <Card sx={{ borderRadius: 3, boxShadow: 1, textAlign: 'center', p: 2 }}>
                <Typography variant="caption" color="text.secondary">Cash Sales</Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1, color: 'success.main' }}>
                  {activeShiftData?.blind ? '—' : `+${MoneyUtil.formatCurrency(summary?.cash_sales)}`}
                </Typography>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <Card sx={{ borderRadius: 3, boxShadow: 1, textAlign: 'center', p: 2 }}>
                <Typography variant="caption" color="text.secondary">Pay In</Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1, color: 'info.main' }}>
                  +{MoneyUtil.formatCurrency(summary?.pay_in)}
                </Typography>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <Card sx={{ borderRadius: 3, boxShadow: 1, textAlign: 'center', p: 2 }}>
                <Typography variant="caption" color="text.secondary">Pay Out</Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1, color: 'error.main' }}>
                  -{MoneyUtil.formatCurrency(summary?.pay_out)}
                </Typography>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <Card sx={{ borderRadius: 3, boxShadow: 1, textAlign: 'center', p: 2 }}>
                <Typography variant="caption" color="text.secondary">Safe Drop</Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1, color: 'warning.main' }}>
                  -{MoneyUtil.formatCurrency(summary?.safe_drop)}
                </Typography>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <Card sx={{ borderRadius: 3, boxShadow: 2, textAlign: 'center', p: 2, bgcolor: 'primary.lighter' }}>
                <Typography variant="caption" color="primary.dark font-bold">EXPECTED CASH</Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1, color: 'primary.main' }}>
                  {/* Withheld from whoever will count this drawer down until they have. */}
                  {activeShiftData?.blind ? '—' : `${MoneyUtil.formatCurrency(summary?.expected_cash)} IRR`}
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
                          {MoneyUtil.formatCurrency(tx.amount)} IRR
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
      ) : !ready ? (
        <RegisterNotice
          terminal={terminal}
          mismatch={mismatch}
          terminalBranchName={register.terminalBranchName}
          branchName={register.branchName}
          onSetup={() => setSetupOpen(true)}
        />
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

      {terminal && ready && (
        <OpenShiftDialog
          open={openDialogOpen}
          onClose={() => setOpenDialogOpen(false)}
          terminal={terminal}
          branchName={register.terminalBranchName}
          defaultFloat={register.defaultFloat}
          onOpened={() => loadData()}
        />
      )}

      <DeviceTerminalDialog
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        branchId={register.branchId}
        branchName={register.branchName}
        current={terminal}
        onAssigned={register.setTerminal}
      />

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

      {shift && (
        <CloseShiftDialog
          open={closeDialogOpen}
          onClose={() => setCloseDialogOpen(false)}
          shiftId={shift.id}
          shiftNumber={shift.shift_number}
          onClosed={() => loadData()}
        />
      )}
    </Box>
  );
}
