import type { Customer } from 'src/api/customerApi';
import type { CreditAging, CreditAccount, CreditStatement } from 'src/api/creditApi';

import { useTranslation } from 'react-i18next';
import React, { useMemo, useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import TuneIcon from '@mui/icons-material/Tune';
import BlockIcon from '@mui/icons-material/Block';
import SearchIcon from '@mui/icons-material/Search';
import PaymentsIcon from '@mui/icons-material/Payments';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
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
  CardContent,
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

import { creditApi } from 'src/api/creditApi';
import { customerApi } from 'src/api/customerApi';

export function CustomerCreditPage() {
  const { t } = useTranslation();
  const { id: routeAccountId } = useParams();

  const [accounts, setAccounts] = useState<CreditAccount[]>([]);
  const [agingData, setAgingData] = useState<CreditAging | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Filter toolbar state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterCurrency, setFilterCurrency] = useState<string>('ALL');
  const [filterMode, setFilterMode] = useState<string>('ALL');
  const [filterBalance, setFilterBalance] = useState<string>('ALL');

  // Repayment Modal
  const [repayDialogOpen, setRepayDialogOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<CreditAccount | null>(null);
  const [repayAmount, setRepayAmount] = useState('1000000');
  const [repayReference, setRepayReference] = useState('');
  const [repayNote, setRepayNote] = useState('');
  const [repayApprovalId, setRepayApprovalId] = useState('');

  // Manual Adjustment Modal
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustAccount, setAdjustAccount] = useState<CreditAccount | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('500000');
  const [adjustReason, setAdjustReason] = useState('Account balance reconciliation adjustment');
  const [adjustReference, setAdjustReference] = useState('');
  const [adjustApprovalId, setAdjustApprovalId] = useState('APPR-ADJ-001');

  // Suspend / Activate Modal
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusAccount, setStatusAccount] = useState<CreditAccount | null>(null);
  const [targetStatus, setTargetStatus] = useState<'ACTIVE' | 'SUSPENDED'>('SUSPENDED');
  const [statusReason, setStatusReason] = useState('');

  // Open Credit Account Modal
  const [openAccountDialogOpen, setOpenAccountDialogOpen] = useState(false);
  const [newCustomerId, setNewCustomerId] = useState('');
  const [newAccountMode, setNewAccountMode] = useState<'FINITE' | 'UNLIMITED' | 'POLICY'>('FINITE');
  const [newAccountLimit, setNewAccountLimit] = useState('10000000');
  const [newAccountCurrency, setNewAccountCurrency] = useState('IRR');
  const [newAccountPolicyNote, setNewAccountPolicyNote] = useState('Corporate credit account');

  // Statement Detail Modal
  const [statementDialogOpen, setStatementDialogOpen] = useState(false);
  const [statementData, setStatementData] = useState<CreditStatement | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementDateFrom, setStatementDateFrom] = useState('');
  const [statementDateTo, setStatementDateTo] = useState('');
  const [statementTypeFilter, setStatementTypeFilter] = useState('ALL');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [accRes, agingRes, custList] = await Promise.all([
        creditApi.getAccounts({
          status: filterStatus !== 'ALL' ? filterStatus : undefined,
          currency: filterCurrency !== 'ALL' ? filterCurrency : undefined,
          mode: filterMode !== 'ALL' ? filterMode : undefined,
        }),
        creditApi.getCreditAging(),
        customerApi.getCustomers(),
      ]);

      const loadedAccounts = Array.isArray(accRes) ? accRes : accRes.data || [];
      setAccounts(loadedAccounts);
      setAgingData(agingRes);
      setCustomers(custList || []);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('credit.error', 'Failed to load credit accounts'));
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterCurrency, filterMode, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load statement details for modal
  const handleViewStatement = useCallback(
    async (accountIdOrCustomerId: string) => {
      setStatementDialogOpen(true);
      setStatementLoading(true);
      try {
        const res = await creditApi.getStatement(accountIdOrCustomerId, {
          dateFrom: statementDateFrom || undefined,
          dateTo: statementDateTo || undefined,
        });
        setStatementData(res);
      } catch (err: any) {
        setError(err.detail || err.message || t('credit.statementModal.error', 'Failed to load statement'));
      } finally {
        setStatementLoading(false);
      }
    },
    [statementDateFrom, statementDateTo, t]
  );

  // Auto-open statement if opened via URL param /app/credit/accounts/:id
  useEffect(() => {
    if (routeAccountId) {
      handleViewStatement(routeAccountId);
    }
  }, [routeAccountId, handleViewStatement]);

  // Map aging information per account
  const agingMap = useMemo(() => {
    const map = new Map<string, any>();
    if (agingData?.customers) {
      for (const item of agingData.customers) {
        map.set(item.accountId || item.customerId, item);
      }
    }
    return map;
  }, [agingData]);

  // Summary Metrics calculations
  const totalApprovedLimit = useMemo(
    () => accounts.reduce((acc, c) => MoneyUtil.add(acc, c.credit_limit || '0', 0), '0'),
    [accounts]
  );

  const totalCurrentBalance = useMemo(
    () =>
      accounts
        .filter((a) => MoneyUtil.greaterThan(a.current_balance, '0'))
        .reduce((acc, c) => MoneyUtil.add(acc, c.current_balance, 0), '0'),
    [accounts]
  );

  const totalOutstandingDebt = useMemo(
    () =>
      accounts
        .filter((a) => MoneyUtil.lessThan(a.current_balance, '0'))
        .reduce((acc, c) => MoneyUtil.add(acc, MoneyUtil.abs(c.current_balance), 0), '0'),
    [accounts]
  );

  const totalAvailableCredit = useMemo(
    () => accounts.reduce((acc, c) => MoneyUtil.add(acc, c.availableCredit || c.available_credit || '0', 0), '0'),
    [accounts]
  );

  const customerMap = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers) {
      map.set(c.id, c);
    }
    return map;
  }, [customers]);

  // Client-side search & balance filter
  const filteredAccounts = useMemo(() => accounts
      .map((acc) => {
        const cust = acc.customer || customerMap.get(acc.customer_id);
        const custName = cust ? `${cust.first_name} ${cust.last_name}`.trim() : '';
        const custCode = cust?.code || acc.customer_id?.slice(0, 8) || '';
        const custMobile = cust?.mobile || '';
        return {
          ...acc,
          enrichedCustomer: cust,
          custName,
          custCode,
          custMobile,
        };
      })
      .filter((acc) => {
        const matchesSearch =
          !searchQuery ||
          acc.custName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          acc.custCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
          acc.custMobile.includes(searchQuery);

        if (!matchesSearch) return false;

        if (filterBalance === 'IN_DEBT') {
          return MoneyUtil.lessThan(acc.current_balance, '0');
        }
        if (filterBalance === 'HAS_DEPOSIT') {
          return MoneyUtil.greaterThan(acc.current_balance, '0');
        }
        if (filterBalance === 'ZERO') {
          return MoneyUtil.isZero(acc.current_balance);
        }

        return true;
      }), [accounts, customerMap, searchQuery, filterBalance]);

  // Customers who do not currently have a credit account
  const eligibleCustomersForNewAccount = useMemo(() => {
    const existingCustIds = new Set(accounts.map((a) => a.customer_id));
    return customers.filter((c) => !existingCustIds.has(c.id));
  }, [accounts, customers]);

  // Handlers for action dialogs
  const handleOpenRepay = (acc: CreditAccount) => {
    setSelectedAccount(acc);
    setRepayAmount('1000000');
    setRepayReference(`PAY-REF-${Date.now().toString().slice(-6)}`);
    setRepayNote('Credit balance top-up / repayment');
    setRepayApprovalId('');
    setRepayDialogOpen(true);
  };

  const handleConfirmRepayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    try {
      await creditApi.postRepayment(selectedAccount.id, {
        amount: repayAmount,
        reference: repayReference || undefined,
        reason: repayNote || undefined,
        approvalRequestId: repayApprovalId || undefined,
      });
      setSuccess(t('credit.repayDialog.success', 'Credit repayment posted successfully'));
      setRepayDialogOpen(false);
      setSelectedAccount(null);
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('credit.repayDialog.error', 'Repayment failed'));
    }
  };

  const handleOpenAdjust = (acc: CreditAccount) => {
    setAdjustAccount(acc);
    setAdjustAmount('500000');
    setAdjustReason('Balance audit adjustment');
    setAdjustReference(`ADJ-REF-${Date.now().toString().slice(-6)}`);
    setAdjustApprovalId('APPR-ADJ-001');
    setAdjustDialogOpen(true);
  };

  const handleConfirmAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustAccount) return;
    try {
      await creditApi.postAdjustment(adjustAccount.id, {
        amountSigned: adjustAmount,
        reason: adjustReason,
        reference: adjustReference || undefined,
        approvalRequestId: adjustApprovalId,
      });
      setSuccess(t('credit.adjustDialog.success', 'Credit adjustment posted successfully'));
      setAdjustDialogOpen(false);
      setAdjustAccount(null);
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('credit.adjustDialog.error', 'Adjustment failed'));
    }
  };

  const handleOpenStatus = (acc: CreditAccount, target: 'ACTIVE' | 'SUSPENDED') => {
    setStatusAccount(acc);
    setTargetStatus(target);
    setStatusReason(target === 'SUSPENDED' ? 'Credit policy suspension' : 'Restored customer credit');
    setStatusDialogOpen(true);
  };

  const handleConfirmStatusChange = async () => {
    if (!statusAccount) return;
    try {
      if (targetStatus === 'SUSPENDED') {
        await creditApi.suspendAccount(statusAccount.id, statusReason);
        setSuccess(t('credit.statusDialog.successSuspend', 'Credit account suspended'));
      } else {
        await creditApi.activateAccount(statusAccount.id, statusReason);
        setSuccess(t('credit.statusDialog.successActivate', 'Credit account activated'));
      }
      setStatusDialogOpen(false);
      setStatusAccount(null);
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('credit.statusDialog.error', 'Status update failed'));
    }
  };

  const handleConfirmOpenAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerId) return;
    try {
      await creditApi.createAccount(newCustomerId, {
        mode: newAccountMode,
        creditLimit: newAccountLimit,
        currencyCode: newAccountCurrency,
        policyNote: newAccountPolicyNote,
      });
      setSuccess(t('credit.openAccountSuccess', 'Credit account provisioned successfully'));
      setOpenAccountDialogOpen(false);
      setNewCustomerId('');
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to open credit account');
    }
  };

  // Filtered statement transactions
  const filteredTransactions = useMemo(() => {
    if (!statementData?.entries && !statementData?.transactions) return [];
    const entries = statementData.entries || statementData.transactions || [];
    if (statementTypeFilter === 'ALL') return entries;
    return entries.filter((tx) => tx.entry_type === statementTypeFilter);
  }, [statementData, statementTypeFilter]);

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      {/* Header Bar */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 2, mb: 3 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('credit.title', 'Customer Credit Subledger & Aging')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('credit.subtitle', 'Credit limits, repayments, statement ledgers, and credit aging reports (AD-12 / Section 8.6)')}
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
            {t('credit.openAccount', 'Open Credit Account')}
          </Button>
          <Button variant="outlined" onClick={loadData} sx={{ fontWeight: 'bold' }}>
            {t('credit.refresh', 'Refresh Subledger')}
          </Button>
        </Stack>
      </Stack>

      {/* Notifications */}
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

      {/* Summary KPI Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ borderRadius: 2.5, boxShadow: 1, p: 2.5, borderLeft: '4px solid', borderColor: 'primary.main' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'medium' }}>
              {t('credit.totalLimit', 'Total Approved Credit Limit')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5, color: 'primary.main' }}>
              {MoneyUtil.formatCurrency(totalApprovedLimit)} IRR
            </Typography>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ borderRadius: 2.5, boxShadow: 1, p: 2.5, borderLeft: '4px solid', borderColor: 'success.main' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'medium' }}>
              {t('credit.totalBalance', 'Total Current Balance (Deposits)')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5, color: 'success.main' }}>
              +{MoneyUtil.formatCurrency(totalCurrentBalance)} IRR
            </Typography>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ borderRadius: 2.5, boxShadow: 1, p: 2.5, borderLeft: '4px solid', borderColor: 'error.main' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'medium' }}>
              {t('credit.totalDebt', 'Total Outstanding Debt')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5, color: 'error.main' }}>
              -{MoneyUtil.formatCurrency(totalOutstandingDebt)} IRR
            </Typography>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ borderRadius: 2.5, boxShadow: 1, p: 2.5, borderLeft: '4px solid', borderColor: 'info.main' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'medium' }}>
              {t('credit.totalAvailable', 'Total Available Purchasing Credit')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5, color: 'info.main' }}>
              {MoneyUtil.formatCurrency(totalAvailableCredit)} IRR
            </Typography>
          </Card>
        </Grid>
      </Grid>

      {/* Filter Toolbar (Section 10.3 Specification) */}
      <Card sx={{ borderRadius: 2.5, boxShadow: 1, mb: 3, p: 2 }}>
        <Grid container spacing={2} sx={{ alignItems: 'center' }}>
          <Grid size={{ xs: 12, sm: 4, md: 3 }}>
            <TextField
              size="small"
              fullWidth
              placeholder={t('credit.searchPlaceholder', 'Search by customer name, code or phone...')}
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
            />
          </Grid>

          <Grid size={{ xs: 6, sm: 2.5, md: 2 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>{t('credit.table.status', 'Status')}</InputLabel>
              <Select
                value={filterStatus}
                label={t('credit.table.status', 'Status')}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <MenuItem value="ALL">{t('credit.status.all', 'All Statuses')}</MenuItem>
                <MenuItem value="ACTIVE">{t('credit.status.active', 'Active')}</MenuItem>
                <MenuItem value="SUSPENDED">{t('credit.status.suspended', 'Suspended')}</MenuItem>
                <MenuItem value="CLOSED">{t('credit.status.closed', 'Closed')}</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 6, sm: 2.5, md: 2 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>{t('credit.table.mode', 'Mode')}</InputLabel>
              <Select
                value={filterMode}
                label={t('credit.table.mode', 'Mode')}
                onChange={(e) => setFilterMode(e.target.value)}
              >
                <MenuItem value="ALL">{t('credit.mode.all', 'All Modes')}</MenuItem>
                <MenuItem value="FINITE">{t('credit.mode.finite', 'Finite Limit')}</MenuItem>
                <MenuItem value="UNLIMITED">{t('credit.mode.unlimited', 'Unlimited')}</MenuItem>
                <MenuItem value="POLICY">{t('credit.mode.policy', 'Custom Policy')}</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 6, sm: 3, md: 2.5 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>{t('credit.balanceFilter.all', 'Balance State')}</InputLabel>
              <Select
                value={filterBalance}
                label={t('credit.balanceFilter.all', 'Balance State')}
                onChange={(e) => setFilterBalance(e.target.value)}
              >
                <MenuItem value="ALL">{t('credit.balanceFilter.all', 'All Balances')}</MenuItem>
                <MenuItem value="IN_DEBT">{t('credit.balanceFilter.inDebt', 'In Debt (Overdraft)')}</MenuItem>
                <MenuItem value="HAS_DEPOSIT">{t('credit.balanceFilter.hasDeposit', 'Positive (Deposits)')}</MenuItem>
                <MenuItem value="ZERO">{t('credit.balanceFilter.zero', 'Zero Balance')}</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 6, sm: 2, md: 2.5 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>{t('credit.table.currency', 'Currency')}</InputLabel>
              <Select
                value={filterCurrency}
                label={t('credit.table.currency', 'Currency')}
                onChange={(e) => setFilterCurrency(e.target.value)}
              >
                <MenuItem value="ALL">{t('credit.currency.all', 'All Currencies')}</MenuItem>
                <MenuItem value="IRR">IRR</MenuItem>
                <MenuItem value="USD">USD</MenuItem>
                <MenuItem value="EUR">EUR</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Card>

      {/* Credit Accounts Directory Grid */}
      <Card sx={{ borderRadius: 2.5, boxShadow: 1 }}>
        <CardContent sx={{ p: 0 }}>
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
              {t('credit.directoryTitle', 'Customer Credit Accounts Directory')}
            </Typography>
          </Box>

          <TableContainer>
            <Table>
              <TableHead sx={{ bgcolor: 'background.neutral' }}>
                <TableRow>
                  <TableCell>{t('credit.table.customerCode', 'Customer Code')}</TableCell>
                  <TableCell>{t('credit.table.customerName', 'Customer Name')}</TableCell>
                  <TableCell>{t('credit.table.mode', 'Mode')}</TableCell>
                  <TableCell>{t('credit.table.currency', 'Currency')}</TableCell>
                  <TableCell align="right">{t('credit.table.creditLimit', 'Credit Limit')}</TableCell>
                  <TableCell align="right">{t('credit.table.currentBalance', 'Current Balance')}</TableCell>
                  <TableCell align="right">{t('credit.table.availableCredit', 'Available Credit')}</TableCell>
                  <TableCell>{t('credit.table.status', 'Status')}</TableCell>
                  <TableCell align="right">{t('credit.table.aging', 'Aging (0-30d)')}</TableCell>
                  <TableCell align="center">{t('credit.table.actions', 'Actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={10} align="center" sx={{ py: 4 }}>
                      <CircularProgress size={28} />
                    </TableCell>
                  </TableRow>
                ) : filteredAccounts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      {t('credit.table.noRecords', 'No credit accounts matching the criteria')}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAccounts.map((row) => {
                    const agingInfo = agingMap.get(row.id) || agingMap.get(row.customer_id);
                    const isNegative = MoneyUtil.lessThan(row.current_balance || '0', '0');
                    const isPositive = MoneyUtil.greaterThan(row.current_balance || '0', '0');

                    return (
                      <TableRow key={row.id} hover>
                        <TableCell>
                          <code>{row.custCode || row.customer?.code || row.customer_id.slice(0, 8)}</code>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                            {row.custName || row.customer?.name || (row.customer ? `${row.customer.first_name} ${row.customer.last_name}` : '—')}
                          </Typography>
                          {(row.custMobile || row.customer?.mobile) && (
                            <Typography variant="caption" color="text.secondary">
                              {row.custMobile || row.customer?.mobile}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={row.mode}
                            size="small"
                            variant="outlined"
                            color={row.mode === 'UNLIMITED' ? 'secondary' : row.mode === 'POLICY' ? 'info' : 'default'}
                          />
                        </TableCell>
                        <TableCell>
                          <Chip label={row.currency_code || 'IRR'} size="small" />
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
                          {isNegative ? `-${MoneyUtil.formatCurrency(MoneyUtil.abs(row.current_balance))}` : `+${MoneyUtil.formatCurrency(row.current_balance)}`}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                          {row.mode === 'UNLIMITED' ? '∞' : MoneyUtil.formatCurrency(row.availableCredit || row.available_credit || '0')}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={row.status}
                            size="small"
                            color={row.status === 'ACTIVE' ? 'success' : row.status === 'SUSPENDED' ? 'warning' : 'default'}
                          />
                        </TableCell>
                        <TableCell align="right">
                          {agingInfo ? MoneyUtil.formatCurrency(agingInfo.current || '0') : '0.00'}
                        </TableCell>
                        <TableCell align="center">
                          <Stack direction="row" spacing={0.8} sx={{ justifyContent: 'center' }}>
                            <Button
                              size="small"
                              variant="contained"
                              color="success"
                              startIcon={<PaymentsIcon />}
                              onClick={() => handleOpenRepay(row)}
                              disabled={row.status === 'CLOSED'}
                            >
                              {t('credit.repayment', 'Repayment / Top-Up')}
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              color="info"
                              startIcon={<ReceiptLongIcon />}
                              onClick={() => handleViewStatement(row.customer_id || row.id)}
                            >
                              {t('credit.statement', 'Statement')}
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              color="warning"
                              startIcon={<TuneIcon />}
                              onClick={() => handleOpenAdjust(row)}
                            >
                              {t('credit.adjustment', 'Adjust')}
                            </Button>
                            {row.status === 'ACTIVE' ? (
                              <Button
                                size="small"
                                variant="text"
                                color="error"
                                startIcon={<BlockIcon />}
                                onClick={() => handleOpenStatus(row, 'SUSPENDED')}
                              >
                                {t('credit.suspend', 'Suspend')}
                              </Button>
                            ) : (
                              <Button
                                size="small"
                                variant="text"
                                color="success"
                                startIcon={<CheckCircleIcon />}
                                onClick={() => handleOpenStatus(row, 'ACTIVE')}
                              >
                                {t('credit.activate', 'Activate')}
                              </Button>
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Repayment Modal */}
      <Dialog open={repayDialogOpen} onClose={() => setRepayDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('credit.repayDialog.title', 'Post Credit Repayment / Top-Up')} —{' '}
          {selectedAccount?.customer?.name || selectedAccount?.customer?.first_name || ''}
        </DialogTitle>
        <Box component="form" onSubmit={handleConfirmRepayment}>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2.5}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'background.neutral' }}>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary">Current Balance:</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      {MoneyUtil.formatCurrency(selectedAccount?.current_balance || '0')} {selectedAccount?.currency_code || 'IRR'}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary">Credit Limit:</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      {MoneyUtil.formatCurrency(selectedAccount?.credit_limit || '0')} {selectedAccount?.currency_code || 'IRR'}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>

              <TextField
                size="small"
                label={t('credit.repayDialog.amount', 'Repayment Amount (IRR)')}
                type="number"
                required
                fullWidth
                value={repayAmount}
                onChange={(e) => setRepayAmount(e.target.value)}
                helperText={`Preview: ${MoneyUtil.formatCurrency(repayAmount || '0')} IRR`}
              />

              <TextField
                size="small"
                label={t('credit.repayDialog.reference', 'Reference / Receipt Number')}
                fullWidth
                value={repayReference}
                onChange={(e) => setRepayReference(e.target.value)}
              />

              <TextField
                size="small"
                label={t('credit.repayDialog.note', 'Note / Description')}
                fullWidth
                multiline
                rows={2}
                value={repayNote}
                onChange={(e) => setRepayNote(e.target.value)}
              />

              <TextField
                size="small"
                label={t('credit.repayDialog.approvalId', 'Approval Request ID (if over-repaying)')}
                fullWidth
                value={repayApprovalId}
                onChange={(e) => setRepayApprovalId(e.target.value)}
                placeholder="e.g. APPR-REQ-1002"
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2.5 }}>
            <Button onClick={() => setRepayDialogOpen(false)}>{t('credit.repayDialog.cancel', 'Cancel')}</Button>
            <Button type="submit" variant="contained" color="success" sx={{ fontWeight: 'bold' }}>
              {t('credit.repayDialog.confirm', 'Confirm Repayment')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Manual Credit Adjustment Modal */}
      <Dialog open={adjustDialogOpen} onClose={() => setAdjustDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('credit.adjustDialog.title', 'Post Manual Credit Adjustment')} —{' '}
          {adjustAccount?.customer?.name || adjustAccount?.customer?.first_name || ''}
        </DialogTitle>
        <Box component="form" onSubmit={handleConfirmAdjustment}>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2.5}>
              <Alert severity="info">
                {t('credit.adjustDialog.approvalHelper', 'Manual adjustments strictly require an approved manager request ID.')}
              </Alert>

              <TextField
                size="small"
                label={t('credit.adjustDialog.amount', 'Signed Amount (+ for credit, - for debit)')}
                type="text"
                required
                fullWidth
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                helperText="Use negative sign for debit charge (e.g. -500000) or positive for credit addition"
              />

              <TextField
                size="small"
                label={t('credit.adjustDialog.reason', 'Adjustment Reason')}
                required
                fullWidth
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
              />

              <TextField
                size="small"
                label={t('credit.adjustDialog.reference', 'Reference Number')}
                fullWidth
                value={adjustReference}
                onChange={(e) => setAdjustReference(e.target.value)}
              />

              <TextField
                size="small"
                label={t('credit.adjustDialog.approvalId', 'Approval Request ID')}
                required
                fullWidth
                value={adjustApprovalId}
                onChange={(e) => setAdjustApprovalId(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2.5 }}>
            <Button onClick={() => setAdjustDialogOpen(false)}>{t('credit.adjustDialog.cancel', 'Cancel')}</Button>
            <Button type="submit" variant="contained" color="warning" sx={{ fontWeight: 'bold' }}>
              {t('credit.adjustDialog.confirm', 'Confirm Adjustment')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Suspend / Activate Account Modal */}
      <Dialog open={statusDialogOpen} onClose={() => setStatusDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {targetStatus === 'SUSPENDED'
            ? t('credit.statusDialog.suspendTitle', 'Suspend Credit Account')
            : t('credit.statusDialog.activateTitle', 'Activate Credit Account')}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={2}>
            <Typography variant="body2">
              Are you sure you want to {targetStatus.toLowerCase()} credit privileges for{' '}
              <strong>{statusAccount?.customer?.name || statusAccount?.customer?.first_name}</strong>?
            </Typography>
            <TextField
              size="small"
              label={t('credit.statusDialog.reason', 'Reason for status change')}
              required
              fullWidth
              multiline
              rows={2}
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setStatusDialogOpen(false)}>{t('credit.statusDialog.cancel', 'Cancel')}</Button>
          <Button
            variant="contained"
            color={targetStatus === 'SUSPENDED' ? 'error' : 'success'}
            onClick={handleConfirmStatusChange}
            sx={{ fontWeight: 'bold' }}
          >
            {targetStatus === 'SUSPENDED'
              ? t('credit.statusDialog.confirmSuspend', 'Suspend Account')
              : t('credit.statusDialog.confirmActivate', 'Activate Account')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Open New Credit Account Modal */}
      <Dialog open={openAccountDialogOpen} onClose={() => setOpenAccountDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('credit.openAccount', 'Open Credit Account')}
        </DialogTitle>
        <Box component="form" onSubmit={handleConfirmOpenAccount}>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2.5}>
              <FormControl size="small" fullWidth required>
                <InputLabel>Select Customer</InputLabel>
                <Select
                  value={newCustomerId}
                  label="Select Customer"
                  onChange={(e) => setNewCustomerId(e.target.value)}
                >
                  {eligibleCustomersForNewAccount.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.first_name} {c.last_name} ({c.code}) — {c.mobile}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Grid container spacing={2}>
                <Grid size={{ xs: 6 }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Credit Mode</InputLabel>
                    <Select
                      value={newAccountMode}
                      label="Credit Mode"
                      onChange={(e) => setNewAccountMode(e.target.value as any)}
                    >
                      <MenuItem value="FINITE">FINITE (Fixed Limit)</MenuItem>
                      <MenuItem value="UNLIMITED">UNLIMITED</MenuItem>
                      <MenuItem value="POLICY">POLICY (Custom Policy)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                <Grid size={{ xs: 6 }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Currency</InputLabel>
                    <Select
                      value={newAccountCurrency}
                      label="Currency"
                      onChange={(e) => setNewAccountCurrency(e.target.value)}
                    >
                      <MenuItem value="IRR">IRR</MenuItem>
                      <MenuItem value="USD">USD</MenuItem>
                      <MenuItem value="EUR">EUR</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>

              {newAccountMode !== 'UNLIMITED' && (
                <TextField
                  size="small"
                  label="Initial Credit Limit"
                  type="number"
                  required
                  fullWidth
                  value={newAccountLimit}
                  onChange={(e) => setNewAccountLimit(e.target.value)}
                  helperText={`Preview: ${MoneyUtil.formatCurrency(newAccountLimit || '0')} ${newAccountCurrency}`}
                />
              )}

              <TextField
                size="small"
                label="Policy Note / Agreement Reference"
                fullWidth
                multiline
                rows={2}
                value={newAccountPolicyNote}
                onChange={(e) => setNewAccountPolicyNote(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2.5 }}>
            <Button onClick={() => setOpenAccountDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" color="primary" sx={{ fontWeight: 'bold' }}>
              Provision Credit Account
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Statement Detail Modal (/app/credit/accounts/:id) */}
      <Dialog
        open={statementDialogOpen}
        onClose={() => setStatementDialogOpen(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            {t('credit.statementModal.title', 'Customer Credit Statement')} —{' '}
            {statementData?.customer?.name ||
              (statementData?.customer ? `${statementData.customer.first_name} ${statementData.customer.last_name}` : '')}{' '}
            ({statementData?.customer?.code || ''})
          </Box>
          <Chip label={statementData?.currencyCode || statementData?.currency_code || 'IRR'} size="small" color="primary" />
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {statementLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={32} />
            </Box>
          ) : statementData ? (
            <Stack spacing={3}>
              {/* Profile & Balances Card */}
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: 'background.neutral' }}>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('credit.statementModal.mobile', 'Mobile:')}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      {statementData.customer?.mobile || '—'}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('credit.statementModal.limit', 'Credit Limit:')}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      {MoneyUtil.formatCurrency(statementData.credit_account?.credit_limit || statementData.account?.credit_limit || '0')}{' '}
                      {statementData.currencyCode || 'IRR'}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('credit.statementModal.balance', 'Current Balance:')}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 'bold',
                        color: MoneyUtil.lessThan(statementData.credit_account?.current_balance || statementData.account?.current_balance || '0', '0')
                          ? 'error.main'
                          : 'success.main',
                      }}
                    >
                      {MoneyUtil.formatCurrency(statementData.credit_account?.current_balance || statementData.account?.current_balance || '0')}{' '}
                      {statementData.currencyCode || 'IRR'}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('credit.statementModal.available', 'Available Credit:')}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                      {MoneyUtil.formatCurrency(
                        statementData.credit_account?.availableCredit || statementData.credit_account?.available_credit || '0'
                      )}{' '}
                      {statementData.currencyCode || 'IRR'}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>

              {/* Aging Breakdown Cards */}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1.5 }}>
                  {t('credit.aging', 'Aging Summary')}
                </Typography>
                <Grid container spacing={2}>
                  {(() => {
                    const agingInfo = agingMap.get(statementData.accountId || statementData.customerId);
                    return (
                      <>
                        <Grid size={{ xs: 6, sm: 3 }}>
                          <Card sx={{ p: 1.5, borderRadius: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                            <Typography variant="caption" color="text.secondary">
                              {t('credit.statementModal.agingCard0_30', 'Current (0–30 Days)')}
                            </Typography>
                            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 0.5, color: 'info.main' }}>
                              {MoneyUtil.formatCurrency(agingInfo?.current || '0')} IRR
                            </Typography>
                          </Card>
                        </Grid>
                        <Grid size={{ xs: 6, sm: 3 }}>
                          <Card sx={{ p: 1.5, borderRadius: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                            <Typography variant="caption" color="text.secondary">
                              {t('credit.statementModal.agingCard31_60', '31–60 Days')}
                            </Typography>
                            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 0.5, color: 'warning.main' }}>
                              {MoneyUtil.formatCurrency(agingInfo?.days31_60 || '0')} IRR
                            </Typography>
                          </Card>
                        </Grid>
                        <Grid size={{ xs: 6, sm: 3 }}>
                          <Card sx={{ p: 1.5, borderRadius: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                            <Typography variant="caption" color="text.secondary">
                              {t('credit.statementModal.agingCard61_90', '61–90 Days')}
                            </Typography>
                            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 0.5, color: 'error.light' }}>
                              {MoneyUtil.formatCurrency(agingInfo?.days61_90 || '0')} IRR
                            </Typography>
                          </Card>
                        </Grid>
                        <Grid size={{ xs: 6, sm: 3 }}>
                          <Card sx={{ p: 1.5, borderRadius: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                            <Typography variant="caption" color="text.secondary">
                              {t('credit.statementModal.agingCard90Plus', '90+ Days')}
                            </Typography>
                            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 0.5, color: 'error.main' }}>
                              {MoneyUtil.formatCurrency(agingInfo?.days90Plus || '0')} IRR
                            </Typography>
                          </Card>
                        </Grid>
                      </>
                    );
                  })()}
                </Grid>
              </Box>

              {/* Statement Filter Toolbar */}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
                <TextField
                  size="small"
                  label={t('credit.statementModal.dateFrom', 'From Date')}
                  type="date"
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={statementDateFrom}
                  onChange={(e) => setStatementDateFrom(e.target.value)}
                  sx={{ width: { xs: '100%', sm: 180 } }}
                />
                <TextField
                  size="small"
                  label={t('credit.statementModal.dateTo', 'To Date')}
                  type="date"
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={statementDateTo}
                  onChange={(e) => setStatementDateTo(e.target.value)}
                  sx={{ width: { xs: '100%', sm: 180 } }}
                />
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>{t('credit.statementModal.type', 'Transaction Type')}</InputLabel>
                  <Select
                    value={statementTypeFilter}
                    label={t('credit.statementModal.type', 'Transaction Type')}
                    onChange={(e) => setStatementTypeFilter(e.target.value)}
                  >
                    <MenuItem value="ALL">{t('credit.statementModal.allTypes', 'All Entry Types')}</MenuItem>
                    <MenuItem value="PURCHASE">PURCHASE (خرید)</MenuItem>
                    <MenuItem value="REPAYMENT">REPAYMENT (بازپرداخت)</MenuItem>
                    <MenuItem value="ADJUSTMENT">ADJUSTMENT (تعدیل)</MenuItem>
                    <MenuItem value="REFUND">REFUND (استرداد)</MenuItem>
                    <MenuItem value="REVERSAL">REVERSAL (برگشت)</MenuItem>
                  </Select>
                </FormControl>
              </Stack>

              {/* Subledger Transactions Table */}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                  {t('credit.statementModal.history', 'Subledger Transaction History')}
                </Typography>

                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                  <Table size="small">
                    <TableHead sx={{ bgcolor: 'background.neutral' }}>
                      <TableRow>
                        <TableCell>{t('credit.statementModal.time', 'Time / Date')}</TableCell>
                        <TableCell>{t('credit.statementModal.type', 'Type')}</TableCell>
                        <TableCell>{t('credit.statementModal.reference', 'Order / Payment / Ref')}</TableCell>
                        <TableCell align="right">{t('credit.statementModal.amount', 'Amount')}</TableCell>
                        <TableCell align="right">{t('credit.statementModal.balanceAfter', 'Running Balance')}</TableCell>
                        <TableCell>{t('credit.statementModal.note', 'Note')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredTransactions.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                            No entries found in this date range
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredTransactions.map((tx: any) => {
                          const isNegative = MoneyUtil.lessThan(tx.amount || '0', '0');
                          return (
                            <TableRow key={tx.id} hover>
                              <TableCell sx={{ fontSize: '0.8rem' }}>
                                {new Date(tx.posted_at || tx.recorded_at).toLocaleString()}
                              </TableCell>
                              <TableCell>
                                <Chip
                                  label={tx.entry_type || tx.transaction_type}
                                  color={
                                    tx.entry_type === 'REPAYMENT' || tx.transaction_type === 'CHARGE'
                                      ? 'success'
                                      : tx.entry_type === 'PURCHASE' || tx.transaction_type === 'DEBIT'
                                      ? 'error'
                                      : 'info'
                                  }
                                  size="small"
                                />
                              </TableCell>
                              <TableCell sx={{ fontSize: '0.8rem' }}>
                                <code>{tx.order_id ? `ORD-${tx.order_id.slice(0, 8)}` : tx.reference || '—'}</code>
                              </TableCell>
                              <TableCell
                                align="right"
                                sx={{
                                  fontWeight: 'bold',
                                  color: isNegative ? 'error.main' : 'success.main',
                                }}
                              >
                                {isNegative ? `-${MoneyUtil.formatCurrency(MoneyUtil.abs(tx.amount))}` : `+${MoneyUtil.formatCurrency(tx.amount)}`}{' '}
                                {tx.currency_code || 'IRR'}
                              </TableCell>
                              <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                                {MoneyUtil.formatCurrency(tx.balance_after || '0')}
                              </TableCell>
                              <TableCell sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                                {tx.reason_text || tx.note || '—'}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setStatementDialogOpen(false)}>
            {t('credit.statementModal.close', 'Close')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
