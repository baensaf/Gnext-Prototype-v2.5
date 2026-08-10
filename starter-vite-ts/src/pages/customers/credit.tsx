import React, { useState, useEffect } from 'react';

import PaymentsIcon from '@mui/icons-material/Payments';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
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
  TableRow,
  TextField,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  CardContent,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { customerApi } from 'src/api/customerApi';

export function CustomerCreditPage() {
  const [agingData, setAgingData] = useState<any[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Repayment Modal
  const [repayDialogOpen, setRepayDialogOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [repayAmount, setRepayAmount] = useState('1000000');
  const [repayNote, setRepayNote] = useState('');

  // Statement Modal
  const [statementDialogOpen, setStatementDialogOpen] = useState(false);
  const [statementData, setStatementData] = useState<any | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await customerApi.getCreditAgingReport();
      setAgingData(data);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load customer credit subledger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenRepay = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setRepayAmount('1000000');
    setRepayNote('Credit balance top-up / repayment');
    setRepayDialogOpen(true);
  };

  const handleConfirmRepayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId) return;
    try {
      await customerApi.postRepayment(selectedCustomerId, {
        amount: repayAmount,
        note: repayNote || undefined,
      });
      setRepayDialogOpen(false);
      setSelectedCustomerId(null);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Repayment failed');
    }
  };

  const handleViewStatement = async (customerId: string) => {
    try {
      const res = await customerApi.getCreditStatement(customerId);
      setStatementData(res);
      setStatementDialogOpen(true);
    } catch (err: any) {
      setError(err.detail || 'Failed to load statement');
    }
  };

  const totalLimit = agingData.reduce((acc, c) => acc + Number(c.credit_limit || 0), 0);
  const totalBalance = agingData.reduce((acc, c) => acc + Number(c.current_balance || 0), 0);
  const totalAvailable = agingData.reduce((acc, c) => acc + Number(c.available_credit || 0), 0);

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Customer Credit Subledger & Aging
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Credit limits, repayments, statement ledgers, and credit aging reports (AD-12 / Section 8.6)
          </Typography>
        </Box>
        <Button variant="outlined" onClick={loadData} sx={{ fontWeight: 'bold' }}>
          Refresh Subledger
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Summary Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4, md: 4 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 2, p: 2 }}>
            <Typography variant="caption" color="text.secondary">Total Approved Credit Limit</Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 1, color: 'primary.main' }}>
              {totalLimit.toLocaleString()} IRR
            </Typography>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 4, md: 4 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 2, p: 2 }}>
            <Typography variant="caption" color="text.secondary">Total Current Balance (Deposits)</Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 1, color: 'success.main' }}>
              +{totalBalance.toLocaleString()} IRR
            </Typography>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 4, md: 4 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 2, p: 2 }}>
            <Typography variant="caption" color="text.secondary">Total Available Purchasing Credit</Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 1, color: 'info.main' }}>
              {totalAvailable.toLocaleString()} IRR
            </Typography>
          </Card>
        </Grid>
      </Grid>

      {/* Credit Accounts Table */}
      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Customer Credit Accounts Directory
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Customer Code</TableCell>
                  <TableCell>Customer Name</TableCell>
                  <TableCell align="right">Credit Limit (IRR)</TableCell>
                  <TableCell align="right">Current Balance</TableCell>
                  <TableCell align="right">Available Credit</TableCell>
                  <TableCell align="right">Aging (Current 0-30d)</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {agingData.map((row) => (
                  <TableRow key={row.customer_id}>
                    <TableCell><code>{row.customer_code}</code></TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{row.customer_name}</TableCell>
                    <TableCell align="right">{Number(row.credit_limit).toLocaleString()}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', color: Number(row.current_balance) >= 0 ? 'success.main' : 'error.main' }}>
                      {Number(row.current_balance).toLocaleString()}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                      {Number(row.available_credit).toLocaleString()}
                    </TableCell>
                    <TableCell align="right">{Number(row.aging.current_0_30).toLocaleString()}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          variant="contained"
                          color="success"
                          startIcon={<PaymentsIcon />}
                          onClick={() => handleOpenRepay(row.customer_id)}
                        >
                          Repayment / Top-Up
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<ReceiptLongIcon />}
                          onClick={() => handleViewStatement(row.customer_id)}
                        >
                          Statement
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Repayment Modal */}
      <Dialog open={repayDialogOpen} onClose={() => setRepayDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          Post Credit Repayment / Top-Up
        </DialogTitle>
        <Box component="form" onSubmit={handleConfirmRepayment}>
          <DialogContent sx={{ minWidth: 360, pt: 2 }}>
            <Stack spacing={2}>
              <TextField
                size="small"
                label="Repayment Amount (IRR)"
                type="number"
                required
                fullWidth
                value={repayAmount}
                onChange={(e) => setRepayAmount(e.target.value)}
              />

              <TextField
                size="small"
                label="Note / Reference"
                fullWidth
                multiline
                rows={2}
                value={repayNote}
                onChange={(e) => setRepayNote(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRepayDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" color="success" sx={{ fontWeight: 'bold' }}>
              Confirm Repayment
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Statement Modal */}
      <Dialog open={statementDialogOpen} onClose={() => setStatementDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          Customer Credit Statement — {statementData?.customer.name} ({statementData?.customer.code})
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {statementData && (
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'background.neutral' }}>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <Typography variant="caption" color="text.secondary">Mobile:</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{statementData.customer.mobile}</Typography>
                  </Grid>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <Typography variant="caption" color="text.secondary">Credit Limit:</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{Number(statementData.credit_account.credit_limit).toLocaleString()} IRR</Typography>
                  </Grid>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <Typography variant="caption" color="text.secondary">Current Balance:</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'success.main' }}>{Number(statementData.credit_account.current_balance).toLocaleString()} IRR</Typography>
                  </Grid>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <Typography variant="caption" color="text.secondary">Available Credit:</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'primary.main' }}>{Number(statementData.credit_account.available_credit).toLocaleString()} IRR</Typography>
                  </Grid>
                </Grid>
              </Paper>

              <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                Subledger Transaction History
              </Typography>

              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Time</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell align="right">Amount (IRR)</TableCell>
                      <TableCell>Note</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {statementData.transactions.map((tx: any) => (
                      <TableRow key={tx.id}>
                        <TableCell>{new Date(tx.recorded_at).toLocaleString()}</TableCell>
                        <TableCell>
                          <Chip
                            label={tx.transaction_type}
                            color={tx.transaction_type === 'CHARGE' ? 'success' : tx.transaction_type === 'DEBIT' ? 'error' : 'info'}
                            size="small"
                          />
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold', color: tx.transaction_type === 'DEBIT' ? 'error.main' : 'success.main' }}>
                          {tx.transaction_type === 'DEBIT' ? `-${Number(tx.amount).toLocaleString()}` : `+${Number(tx.amount).toLocaleString()}`} IRR
                        </TableCell>
                        <TableCell>{tx.note || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatementDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
