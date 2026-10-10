import type { Customer } from 'src/api/customerApi';
import type { CreditMode, CreditAccount } from 'src/api/creditApi';

import { useTranslation } from 'react-i18next';
import React, { useMemo, useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
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
  Select,
  TableRow,
  MenuItem,
  TextField,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  InputLabel,
  DialogTitle,
  FormControl,
  DialogContent,
  DialogActions,
  InputAdornment,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { useParams } from 'src/routes/hooks';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';
import { toToman, fromToman, useCurrencyLabel } from 'src/utils/currency';

import { creditApi } from 'src/api/creditApi';
import { customerApi } from 'src/api/customerApi';

const MODES: CreditMode[] = ['FINITE', 'UNLIMITED', 'POLICY'];

const customerName = (c?: { first_name?: string; last_name?: string; name?: string } | null) =>
  c ? c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim() : '';

export function CustomerCreditPage() {
  const currencyLabel = useCurrencyLabel();
  const { t } = useTranslation();
  const { id: routeAccountId } = useParams();

  const [accounts, setAccounts] = useState<CreditAccount[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Repayment
  const [repayAccount, setRepayAccount] = useState<CreditAccount | null>(null);
  const [repayAmount, setRepayAmount] = useState('0');
  const [repayReference, setRepayReference] = useState('');
  const [repayNote, setRepayNote] = useState('');

  // Limit
  const [limitAccount, setLimitAccount] = useState<CreditAccount | null>(null);
  const [limitMode, setLimitMode] = useState<CreditMode>('FINITE');
  const [limitValue, setLimitValue] = useState('0');
  const [limitNote, setLimitNote] = useState('');

  // Open an account
  const [openAccountDialogOpen, setOpenAccountDialogOpen] = useState(false);
  const [newCustomerId, setNewCustomerId] = useState('');
  const [newAccountMode, setNewAccountMode] = useState<CreditMode>('FINITE');
  const [newAccountLimit, setNewAccountLimit] = useState('10000000');
  const [newAccountNote, setNewAccountNote] = useState('');

  // One account's transactions
  const [detail, setDetail] = useState<CreditAccount | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [accRes, custList] = await Promise.all([creditApi.getAccounts(), customerApi.getCustomers()]);
      setAccounts(accRes.data || []);
      setCustomers(custList || []);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('credit.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleViewTransactions = useCallback(
    async (accountId: string) => {
      setDetail(null);
      setDetailOpen(true);
      setDetailLoading(true);
      try {
        setDetail(await creditApi.getAccountById(accountId));
      } catch (err: any) {
        setError(err.detail || err.message || t('credit.transactionsModal.error'));
        setDetailOpen(false);
      } finally {
        setDetailLoading(false);
      }
    },
    [t]
  );

  // Opened straight from /app/credit/accounts/:id
  useEffect(() => {
    if (routeAccountId) handleViewTransactions(routeAccountId);
  }, [routeAccountId, handleViewTransactions]);

  const totalApprovedLimit = useMemo(
    () => accounts.reduce((sum, a) => MoneyUtil.add(sum, a.credit_limit || '0', 0), '0'),
    [accounts]
  );

  const totalOwed = useMemo(
    () =>
      accounts
        .filter((a) => MoneyUtil.lessThan(a.current_balance, '0'))
        .reduce((sum, a) => MoneyUtil.add(sum, MoneyUtil.abs(a.current_balance), 0), '0'),
    [accounts]
  );

  const totalAvailableCredit = useMemo(
    () => accounts.reduce((sum, a) => MoneyUtil.add(sum, a.availableCredit || '0', 0), '0'),
    [accounts]
  );

  const customerMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return accounts
      .map((acc) => {
        const cust = acc.customer || customerMap.get(acc.customer_id);
        return {
          ...acc,
          custName: customerName(cust),
          custCode: cust?.code || acc.customer_id.slice(0, 8),
          custMobile: cust?.mobile || '',
        };
      })
      .filter(
        (acc) =>
          !q ||
          acc.custName.toLowerCase().includes(q) ||
          acc.custCode.toLowerCase().includes(q) ||
          acc.custMobile.includes(q)
      );
  }, [accounts, customerMap, searchQuery]);

  // Customers who do not currently have a credit account
  const eligibleCustomersForNewAccount = useMemo(() => {
    const withAccount = new Set(accounts.map((a) => a.customer_id));
    return customers.filter((c) => !withAccount.has(c.id));
  }, [accounts, customers]);

  const owedBy = (acc?: CreditAccount | null) =>
    acc && MoneyUtil.lessThan(acc.current_balance, '0') ? MoneyUtil.abs(acc.current_balance) : '0';

  const handleOpenRepay = (acc: CreditAccount) => {
    setRepayAccount(acc);
    // What is owed is the starting amount.
    setRepayAmount(owedBy(acc));
    setRepayReference('');
    setRepayNote('');
  };

  const handleConfirmRepayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repayAccount) return;
    try {
      await creditApi.postRepayment(repayAccount.id, {
        amount: repayAmount,
        reference: repayReference || undefined,
        reason: repayNote || undefined,
      });
      setSuccess(t('credit.repayDialog.success'));
      setRepayAccount(null);
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('credit.repayDialog.error'));
    }
  };

  const handleOpenLimit = (acc: CreditAccount) => {
    setLimitAccount(acc);
    setLimitMode(acc.mode);
    setLimitValue(acc.credit_limit || '0');
    setLimitNote(acc.policy_note || '');
  };

  const handleConfirmLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!limitAccount) return;
    try {
      await creditApi.updateAccount(limitAccount.id, {
        mode: limitMode,
        creditLimit: limitMode === 'UNLIMITED' ? undefined : limitValue,
        policyNote: limitNote,
      });
      setSuccess(t('credit.limitDialog.success'));
      setLimitAccount(null);
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('credit.limitDialog.error'));
    }
  };

  const handleConfirmOpenAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerId) return;
    try {
      await creditApi.createAccount(newCustomerId, {
        mode: newAccountMode,
        creditLimit: newAccountLimit,
        policyNote: newAccountNote || undefined,
      });
      setSuccess(t('credit.openDialog.success'));
      setOpenAccountDialogOpen(false);
      setNewCustomerId('');
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('credit.openDialog.error'));
    }
  };

  const modeLabel = (mode: CreditMode) => t(`credit.mode.${mode.toLowerCase()}`);

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 2, mb: 3 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('credit.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('credit.subtitle')}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1.5}>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={() => setOpenAccountDialogOpen(true)}
            sx={{ fontWeight: 'bold' }}
          >
            {t('credit.openAccount')}
          </Button>
          <Button variant="outlined" onClick={loadData} sx={{ fontWeight: 'bold' }}>
            {t('credit.refresh')}
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

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card sx={{ borderRadius: 2.5, boxShadow: 1, p: 2.5, borderLeft: '4px solid', borderColor: 'primary.main' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'medium' }}>
              {t('credit.totalLimit')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5, color: 'primary.main' }}>
              {MoneyUtil.formatCurrency(totalApprovedLimit)} {currencyLabel}
            </Typography>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <Card sx={{ borderRadius: 2.5, boxShadow: 1, p: 2.5, borderLeft: '4px solid', borderColor: 'error.main' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'medium' }}>
              {t('credit.totalOwed')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5, color: 'error.main' }}>
              {MoneyUtil.formatCurrency(totalOwed)} {currencyLabel}
            </Typography>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <Card sx={{ borderRadius: 2.5, boxShadow: 1, p: 2.5, borderLeft: '4px solid', borderColor: 'info.main' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'medium' }}>
              {t('credit.totalAvailable')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5, color: 'info.main' }}>
              {MoneyUtil.formatCurrency(totalAvailableCredit)} {currencyLabel}
            </Typography>
          </Card>
        </Grid>
      </Grid>

      <Card sx={{ borderRadius: 2.5, boxShadow: 1, mb: 3, p: 2 }}>
        <TextField
          size="small"
          fullWidth
          placeholder={t('credit.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ maxWidth: 420 }}
        />
      </Card>

      <Card sx={{ borderRadius: 2.5, boxShadow: 1 }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('credit.table.customerCode')}</TableCell>
                <TableCell>{t('credit.table.customerName')}</TableCell>
                <TableCell>{t('credit.table.mode')}</TableCell>
                <TableCell align="right">{t('credit.table.creditLimit')}</TableCell>
                <TableCell align="right">{t('credit.table.currentBalance')}</TableCell>
                <TableCell align="right">{t('credit.table.availableCredit')}</TableCell>
                <TableCell align="center">{t('credit.table.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : filteredAccounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    {t('credit.table.noRecords')}
                  </TableCell>
                </TableRow>
              ) : (
                filteredAccounts.map((row) => {
                  const isNegative = MoneyUtil.lessThan(row.current_balance || '0', '0');
                  const isPositive = MoneyUtil.greaterThan(row.current_balance || '0', '0');

                  return (
                    <TableRow key={row.id} hover>
                      <TableCell>
                        <code>{row.custCode}</code>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                          {row.custName || '—'}
                        </Typography>
                        {row.custMobile && (
                          <Typography variant="caption" color="text.secondary">
                            {row.custMobile}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={modeLabel(row.mode)}
                          size="small"
                          variant="outlined"
                          color={row.mode === 'UNLIMITED' ? 'secondary' : row.mode === 'POLICY' ? 'info' : 'default'}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'medium' }}>
                        {row.mode === 'UNLIMITED' ? '∞' : MoneyUtil.formatCurrency(row.credit_limit || '0')}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          fontWeight: 'bold',
                          color: isNegative ? 'error.main' : isPositive ? 'success.main' : 'text.primary',
                        }}
                      >
                        {isNegative
                          ? `-${MoneyUtil.formatCurrency(MoneyUtil.abs(row.current_balance))}`
                          : `+${MoneyUtil.formatCurrency(row.current_balance)}`}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                        {row.mode === 'UNLIMITED' ? '∞' : MoneyUtil.formatCurrency(row.availableCredit || '0')}
                      </TableCell>
                      <TableCell align="center">
                        <Stack direction="row" spacing={0.8} sx={{ justifyContent: 'center' }}>
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            startIcon={<PaymentsIcon />}
                            onClick={() => handleOpenRepay(row)}
                            disabled={!isNegative}
                          >
                            {t('credit.repayment')}
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="info"
                            startIcon={<ReceiptLongIcon />}
                            onClick={() => handleViewTransactions(row.id)}
                          >
                            {t('credit.transactions')}
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<EditIcon />}
                            onClick={() => handleOpenLimit(row)}
                          >
                            {t('credit.editLimit')}
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Repayment */}
      <Dialog open={!!repayAccount} onClose={() => setRepayAccount(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('credit.repayDialog.title')} — {customerName(repayAccount?.customer)}
        </DialogTitle>
        <Box component="form" onSubmit={handleConfirmRepayment}>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2.5}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'background.neutral' }}>
                <Typography variant="caption" color="text.secondary">
                  {t('credit.repayDialog.owed')}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                  {MoneyUtil.formatCurrency(owedBy(repayAccount))} {currencyLabel}
                </Typography>
              </Paper>

              <TextField
                size="small"
                label={t('credit.repayDialog.amount', { currency: currencyLabel })}
                type="number"
                required
                fullWidth
                value={toToman(repayAmount)}
                onChange={(e) => setRepayAmount(fromToman(e.target.value))}
              />

              <TextField
                size="small"
                label={t('credit.repayDialog.reference')}
                fullWidth
                value={repayReference}
                onChange={(e) => setRepayReference(e.target.value)}
              />

              <TextField
                size="small"
                label={t('credit.repayDialog.note')}
                fullWidth
                multiline
                rows={2}
                value={repayNote}
                onChange={(e) => setRepayNote(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2.5 }}>
            <Button onClick={() => setRepayAccount(null)}>{t('credit.cancel')}</Button>
            <Button type="submit" variant="contained" color="success" sx={{ fontWeight: 'bold' }}>
              {t('credit.repayDialog.confirm')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Limit */}
      <Dialog open={!!limitAccount} onClose={() => setLimitAccount(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('credit.limitDialog.title')} — {customerName(limitAccount?.customer)}
        </DialogTitle>
        <Box component="form" onSubmit={handleConfirmLimit}>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2.5}>
              <FormControl size="small" fullWidth>
                <InputLabel>{t('credit.table.mode')}</InputLabel>
                <Select
                  value={limitMode}
                  label={t('credit.table.mode')}
                  onChange={(e) => setLimitMode(e.target.value as CreditMode)}
                >
                  {MODES.map((mode) => (
                    <MenuItem key={mode} value={mode}>
                      {modeLabel(mode)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {limitMode !== 'UNLIMITED' && (
                <TextField
                  size="small"
                  label={t('credit.limitDialog.limit', { currency: currencyLabel })}
                  type="number"
                  required
                  fullWidth
                  value={toToman(limitValue)}
                  onChange={(e) => setLimitValue(fromToman(e.target.value))}
                />
              )}

              <TextField
                size="small"
                label={t('credit.policyNote')}
                fullWidth
                multiline
                rows={2}
                value={limitNote}
                onChange={(e) => setLimitNote(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2.5 }}>
            <Button onClick={() => setLimitAccount(null)}>{t('credit.cancel')}</Button>
            <Button type="submit" variant="contained" sx={{ fontWeight: 'bold' }}>
              {t('credit.limitDialog.confirm')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Open an account */}
      <Dialog open={openAccountDialogOpen} onClose={() => setOpenAccountDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>{t('credit.openAccount')}</DialogTitle>
        <Box component="form" onSubmit={handleConfirmOpenAccount}>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2.5}>
              <FormControl size="small" fullWidth required>
                <InputLabel>{t('credit.openDialog.customer')}</InputLabel>
                <Select
                  value={newCustomerId}
                  label={t('credit.openDialog.customer')}
                  onChange={(e) => setNewCustomerId(e.target.value)}
                >
                  {eligibleCustomersForNewAccount.length === 0 && (
                    <MenuItem value="" disabled>
                      {t('credit.openDialog.noCustomers')}
                    </MenuItem>
                  )}
                  {eligibleCustomersForNewAccount.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {customerName(c)} ({c.code}) — {c.mobile}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" fullWidth>
                <InputLabel>{t('credit.table.mode')}</InputLabel>
                <Select
                  value={newAccountMode}
                  label={t('credit.table.mode')}
                  onChange={(e) => setNewAccountMode(e.target.value as CreditMode)}
                >
                  {MODES.map((mode) => (
                    <MenuItem key={mode} value={mode}>
                      {modeLabel(mode)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {newAccountMode !== 'UNLIMITED' && (
                <TextField
                  size="small"
                  label={t('credit.limitDialog.limit', { currency: currencyLabel })}
                  type="number"
                  required
                  fullWidth
                  value={toToman(newAccountLimit)}
                  onChange={(e) => setNewAccountLimit(fromToman(e.target.value))}
                />
              )}

              <TextField
                size="small"
                label={t('credit.policyNote')}
                fullWidth
                multiline
                rows={2}
                value={newAccountNote}
                onChange={(e) => setNewAccountNote(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2.5 }}>
            <Button onClick={() => setOpenAccountDialogOpen(false)}>{t('credit.cancel')}</Button>
            <Button type="submit" variant="contained" color="primary" sx={{ fontWeight: 'bold' }}>
              {t('credit.openDialog.confirm')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* One account's transactions (/app/credit/accounts/:id) */}
      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('credit.transactionsModal.title')} — {customerName(detail?.customer)}
        </DialogTitle>
        <DialogContent dividers>
          {detailLoading || !detail ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Stack spacing={2.5}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'background.neutral' }}>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('credit.transactionsModal.limit')}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      {detail.mode === 'UNLIMITED' ? '∞' : MoneyUtil.formatCurrency(detail.credit_limit || '0')}{' '}
                      {currencyLabel}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('credit.transactionsModal.balance')}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 'bold',
                        color: MoneyUtil.lessThan(detail.current_balance, '0') ? 'error.main' : 'text.primary',
                      }}
                    >
                      {MoneyUtil.formatCurrency(detail.current_balance)} {currencyLabel}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('credit.transactionsModal.available')}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      {detail.mode === 'UNLIMITED' ? '∞' : MoneyUtil.formatCurrency(detail.availableCredit || '0')}{' '}
                      {currencyLabel}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>

              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, maxHeight: 360 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('credit.transactionsModal.time')}</TableCell>
                      <TableCell>{t('credit.transactionsModal.type')}</TableCell>
                      <TableCell>{t('credit.transactionsModal.reference')}</TableCell>
                      <TableCell align="right">{t('credit.transactionsModal.amount')}</TableCell>
                      <TableCell align="right">{t('credit.transactionsModal.balanceAfter')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(detail.entries ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          {t('credit.transactionsModal.empty')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      (detail.entries ?? []).map((tx) => (
                        <TableRow key={tx.id} hover>
                          <TableCell>{fDateTime(tx.posted_at)}</TableCell>
                          <TableCell>
                            <Chip
                              label={t(`credit.types.${tx.entry_type}`, tx.entry_type)}
                              size="small"
                              color={MoneyUtil.greaterThan(tx.amount, '0') ? 'success' : 'warning'}
                            />
                          </TableCell>
                          <TableCell>{tx.reason_text || tx.reference || '—'}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                            {MoneyUtil.formatCurrency(tx.amount)}
                          </TableCell>
                          <TableCell align="right">{MoneyUtil.formatCurrency(tx.balance_after)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailOpen(false)}>{t('credit.transactionsModal.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
