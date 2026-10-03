import type { AddressDraftState } from 'src/components/customer-register';
import type {
  Customer,
  CustomerAddress,
  CustomerCreditAccount,
  CustomerCreditTransaction,
} from 'src/api/customerApi';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import HomeIcon from '@mui/icons-material/Home';
import BlockIcon from '@mui/icons-material/Block';
import PlaceIcon from '@mui/icons-material/Place';
import SearchIcon from '@mui/icons-material/Search';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import {
  Box,
  Card,
  Chip,
  Grid,
  Link,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Select,
  Dialog,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  InputLabel,
  CardContent,
  FormControl,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { paths } from 'src/routes/paths';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';
import { toToman, fromToman, useCurrencyLabel } from 'src/utils/currency';

import { customerApi } from 'src/api/customerApi';
import { useIsHeadOffice } from 'src/store/useAuthStore';

import { VersionTag } from 'src/components/version-tag';
import { ServerDataGrid } from 'src/components/server-data-grid';
import { CustomerAddressFields, CustomerRegisterDialog } from 'src/components/customer-register';

const fullName = (c?: Customer | null) => (c ? `${c.first_name || ''} ${c.last_name || ''}`.trim() : '');

export function CustomersPage() {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();
  const navigate = useNavigate();
  const isHeadOffice = useIsHeadOffice();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockTarget, setBlockTarget] = useState<Customer | null>(null);
  const [blockReason, setBlockReason] = useState('');

  // Credit ledger dialog (V3)
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [creditAccount, setCreditAccount] = useState<CustomerCreditAccount | null>(null);
  const [transactions, setTransactions] = useState<CustomerCreditTransaction[]>([]);
  const [txType, setTxType] = useState<string>('CHARGE');
  const [txAmount, setTxAmount] = useState<string>('0');
  const [txNote, setTxNote] = useState<string>('');

  // Address dialog
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const emptyDraft = (): AddressDraftState => ({
    title: t('customers.register.addressTitleDefault'),
    address_text: '',
    postal_code: '',
    latitude: null,
    longitude: null,
  });
  const [draft, setDraft] = useState<AddressDraftState>(emptyDraft);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      setCustomers(await customerApi.getCustomers(search || undefined));
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('customers.directory.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [search, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenCredit = useCallback(
    async (c: Customer) => {
      setSelectedCustomer(c);
      setCreditDialogOpen(true);
      try {
        const res = await customerApi.getCreditAccount(c.id);
        setCreditAccount(res.account);
        setTransactions(res.transactions);
      } catch (err: any) {
        setError(err.detail || t('customers.directory.errors.creditFailed'));
      }
    },
    [t]
  );

  const handlePostTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    try {
      const res = await customerApi.postCreditTransaction(selectedCustomer.id, {
        transaction_type: txType,
        amount: txAmount,
        note: txNote,
      });
      setCreditAccount(res.account);
      const updated = await customerApi.getCreditAccount(selectedCustomer.id);
      setTransactions(updated.transactions);
      setTxNote('');
    } catch (err: any) {
      setError(err.detail || t('customers.directory.errors.creditFailed'));
    }
  };

  const handleOpenAddresses = async (c: Customer) => {
    setSelectedCustomer(c);
    setDraft(emptyDraft());
    setAddressDialogOpen(true);
    try {
      setAddresses(await customerApi.getAddresses(c.id));
    } catch (err: any) {
      setError(err.detail || t('customers.directory.errors.addressesFailed'));
    }
  };

  const handleAddAddress = async () => {
    if (!selectedCustomer || !draft.address_text.trim()) return;
    try {
      await customerApi.createAddress(selectedCustomer.id, {
        title: draft.title.trim() || t('customers.register.addressTitleDefault'),
        address_text: draft.address_text.trim(),
        postal_code: draft.postal_code?.trim() || undefined,
        latitude: draft.latitude ?? null,
        longitude: draft.longitude ?? null,
        is_default: addresses.length === 0,
      });
      setAddresses(await customerApi.getAddresses(selectedCustomer.id));
      setDraft(emptyDraft());
    } catch (err: any) {
      setError(err.detail || t('customers.directory.errors.addressesFailed'));
    }
  };

  const handleOpenBlock = (c: Customer) => {
    setBlockTarget(c);
    setBlockReason('');
    setBlockOpen(true);
  };

  const handleConfirmBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockTarget || !blockReason.trim()) return;
    try {
      await customerApi.blockCustomer(blockTarget.id, blockReason.trim());
      setBlockOpen(false);
      setBlockTarget(null);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('customers.directory.errors.blockFailed'));
    }
  };

  const handleUnblock = async (c: Customer) => {
    try {
      await customerApi.unblockCustomer(c.id);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('customers.directory.errors.blockFailed'));
    }
  };

  const txLabel = (type: string) => t(`customers.directory.credit.types.${type}`, type);

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('customers.directory.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('customers.directory.subtitle')}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setRegisterOpen(true)} sx={{ fontWeight: 'bold' }}>
          {t('customers.registerCustomer')}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ mb: 3, maxWidth: 400 }}>
        <TextField
          size="small"
          fullWidth
          placeholder={t('customers.directory.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
            },
          }}
        />
      </Box>

      <ServerDataGrid
        rows={customers}
        columns={[
          {
            field: 'name',
            headerName: t('customers.name'),
            flex: 1,
            minWidth: 180,
            valueGetter: (_value, row) => fullName(row as Customer),
            renderCell: (params) => (
              <Link
                component="button"
                onClick={() => navigate(paths.app.customers.detail(params.row.id))}
                sx={{ fontWeight: 600 }}
              >
                {params.value || '—'}
              </Link>
            ),
          },
          {
            field: 'mobile',
            headerName: t('customers.directory.mobileCode'),
            width: 170,
            renderCell: (params) => <span dir="ltr">{params.value}</span>,
          },
          {
            field: 'gender',
            headerName: t('customers.register.gender'),
            width: 100,
            valueGetter: (value) => (value === 'MALE' ? t('customers.register.male') : value === 'FEMALE' ? t('customers.register.female') : '—'),
          },
          ...(isHeadOffice
            ? [
                {
                  field: 'wallet_balance',
                  headerName: t('customers.directory.creditColumn'),
                  width: 240,
                  renderHeader: () => (
                    <>
                      {t('customers.directory.creditColumn')} <VersionTag feature="customers.credit" sx={{ ml: 1 }} />
                    </>
                  ),
                  renderCell: (params: any) => {
                    const c = params.row as Customer;
                    const walletBal = c.wallet_balance || c.credit_account?.current_balance || '0.0000';
                    const credLim = c.credit_limit || c.credit_account?.credit_limit || '0.0000';
                    const isPositive = MoneyUtil.greaterThan(walletBal, '0');
                    return (
                      <Stack spacing={0.5} sx={{ alignItems: 'flex-start', py: 1 }}>
                        <Chip
                          icon={<AccountBalanceWalletIcon sx={{ '&&': { fontSize: 16 } }} />}
                          label={`${MoneyUtil.formatCurrency(walletBal)} ${currency}`}
                          color={isPositive ? 'success' : 'default'}
                          size="small"
                          onClick={() => handleOpenCredit(c)}
                          sx={{ fontWeight: 600, cursor: 'pointer' }}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                          {t('customers.directory.limit', { amount: `${MoneyUtil.formatCurrency(credLim)} ${currency}` })}
                        </Typography>
                      </Stack>
                    );
                  },
                },
              ]
            : []),
          {
            field: 'is_active',
            headerName: t('common.status'),
            width: 140,
            // The "Blocked" badge; blocking a customer is F.
            renderHeader: () => (
              <>
                {t('common.status')} <VersionTag feature="customers.block" sx={{ ml: 1 }} />
              </>
            ),
            renderCell: (params) => {
              const c = params.row as Customer;
              // Blocked outranks disabled on the badge: it is the one that stops an order
              // at the till, so it is what a cashier needs to see first.
              if (c.is_blocked) {
                return (
                  <Chip
                    icon={<BlockIcon sx={{ '&&': { fontSize: 16 } }} />}
                    label={t('customers.directory.blocked')}
                    color="error"
                    size="small"
                    title={c.blocked_reason || t('customers.directory.blockedHint')}
                    sx={{ fontWeight: 600 }}
                  />
                );
              }
              return (
                <Chip
                  label={params.value ? t('customers.directory.active') : t('customers.directory.disabled')}
                  color={params.value ? 'success' : 'default'}
                  size="small"
                />
              );
            },
          },
          {
            field: 'actions',
            headerName: t('customers.directory.actions'),
            width: 170,
            sortable: false,
            renderCell: (params) => {
              const c = params.row as Customer;
              return (
                <Stack direction="row" spacing={0.5}>
                  <IconButton size="small" title={t('customers.directory.viewProfile')} onClick={() => navigate(paths.app.customers.detail(c.id))}>
                    <VisibilityIcon fontSize="small" />
                  </IconButton>
                  {isHeadOffice && (
                    <IconButton size="small" title={t('customers.directory.credit.title')} color="primary" onClick={() => handleOpenCredit(c)}>
                      <AccountBalanceWalletIcon fontSize="small" />
                    </IconButton>
                  )}
                  <IconButton size="small" title={t('customers.directory.addresses')} color="info" onClick={() => handleOpenAddresses(c)}>
                    <HomeIcon fontSize="small" />
                  </IconButton>
                  {isHeadOffice && (
                    <IconButton
                      size="small"
                      title={c.is_blocked ? t('customers.directory.unblock') : t('customers.directory.block')}
                      color={c.is_blocked ? 'success' : 'error'}
                      onClick={() => (c.is_blocked ? handleUnblock(c) : handleOpenBlock(c))}
                    >
                      {c.is_blocked ? <CheckCircleIcon fontSize="small" /> : <BlockIcon fontSize="small" />}
                    </IconButton>
                  )}
                </Stack>
              );
            },
          },
        ]}
        loading={loading}
        height={600}
        emptyTitle={t('customers.directory.emptyTitle')}
        emptyDescription={t('customers.directory.emptyDescription')}
      />

      <CustomerRegisterDialog
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onCreated={() => {
          setRegisterOpen(false);
          loadData();
        }}
        createCustomer={customerApi.createCustomer}
        showCredit={isHeadOffice}
      />

      {/* Credit ledger (V3) */}
      <Dialog open={creditDialogOpen} onClose={() => setCreditDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('customers.directory.credit.title')} — {fullName(selectedCustomer)} <VersionTag feature="customers.credit" sx={{ ml: 1 }} />
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {creditAccount && (
            <Grid container spacing={2} sx={{ mb: 3, mt: 1 }}>
              <Grid size={{ xs: 12, md: 4 }}>
                <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: 'success.50', borderColor: 'success.200' }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="caption" color="success.dark" sx={{ fontWeight: 600 }}>
                      {t('customers.directory.credit.balance')}
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'success.main', mt: 0.5 }}>
                      {MoneyUtil.formatCurrency(creditAccount.current_balance)} {currency}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: 'background.neutral' }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                      {t('customers.creditLimit')}
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5 }}>
                      {MoneyUtil.formatCurrency(creditAccount.credit_limit)} {currency}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: 'primary.50', borderColor: 'primary.200' }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="caption" color="primary.dark" sx={{ fontWeight: 600 }}>
                      {t('customers.directory.credit.spendable')}
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main', mt: 0.5 }}>
                      {MoneyUtil.formatCurrency(MoneyUtil.add(creditAccount.current_balance || '0', creditAccount.credit_limit || '0'))} {currency}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          )}

          <Box component="form" onSubmit={handlePostTransaction} sx={{ mb: 3, p: 2, bgcolor: 'background.neutral', borderRadius: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1.5 }}>
              {t('customers.directory.credit.postTitle')}
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { xs: 'stretch', md: 'center' }, flexWrap: { md: 'wrap' } }}>
              <FormControl size="small" sx={{ width: { xs: '100%', md: 200 } }}>
                <InputLabel>{t('customers.directory.credit.type')}</InputLabel>
                <Select value={txType} label={t('customers.directory.credit.type')} onChange={(e) => setTxType(e.target.value)}>
                  {['CHARGE', 'DEBIT', 'SETTLEMENT', 'ADJUSTMENT'].map((type) => (
                    <MenuItem key={type} value={type}>
                      {txLabel(type)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                size="small"
                label={`${t('customers.directory.credit.amount')} (${currency})`}
                type="number"
                value={toToman(txAmount)}
                onChange={(e) => setTxAmount(fromToman(e.target.value))}
                sx={{ width: { xs: '100%', md: 180 } }}
              />
              <TextField
                size="small"
                label={t('customers.directory.credit.note')}
                value={txNote}
                onChange={(e) => setTxNote(e.target.value)}
                sx={{ flex: '1 1 220px' }}
              />
              <Button type="submit" variant="contained" size="small" sx={{ fontWeight: 'bold', whiteSpace: 'nowrap', minHeight: 40 }}>
                {t('customers.directory.credit.post')}
              </Button>
            </Stack>
          </Box>

          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
            {t('customers.directory.credit.history')}
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, maxHeight: 260 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('customers.directory.credit.date')}</TableCell>
                  <TableCell>{t('customers.directory.credit.type')}</TableCell>
                  <TableCell align="right">
                    {t('customers.directory.credit.amount')} ({currency})
                  </TableCell>
                  <TableCell>{t('customers.directory.credit.note')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {transactions.map((tx) => {
                  const type: string = tx.transaction_type || (tx as any).entry_type || 'ADJUSTMENT';
                  return (
                    <TableRow key={tx.id}>
                      <TableCell>{fDateTime(tx.recorded_at || (tx as any).posted_at || Date.now())}</TableCell>
                      <TableCell>
                        <Chip
                          label={txLabel(type)}
                          size="small"
                          color={type === 'CHARGE' || type === 'SETTLEMENT' || type === 'REPAYMENT' ? 'success' : 'warning'}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                        {MoneyUtil.formatCurrency(tx.amount)} {currency}
                      </TableCell>
                      <TableCell>{tx.note || (tx as any).reason_text || (tx as any).reference || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreditDialogOpen(false)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Addresses */}
      <Dialog open={addressDialogOpen} onClose={() => setAddressDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('customers.directory.addresses')} — {fullName(selectedCustomer)}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
            {t('customers.directory.savedAddresses')}
          </Typography>
          <Stack spacing={1} sx={{ mb: 3 }}>
            {addresses.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                {t('customers.register.noAddresses')}
              </Typography>
            )}
            {addresses.map((a) => (
              <Card key={a.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                  {a.title} {a.is_default && <Chip label={t('customers.directory.default')} size="small" color="primary" sx={{ ml: 1 }} />}
                  {a.latitude != null && (
                    <Chip icon={<PlaceIcon />} label={t('customers.register.pinPlaced')} size="small" variant="outlined" sx={{ ml: 1 }} />
                  )}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {a.address_text}
                  {a.postal_code ? ` — ${a.postal_code}` : ''}
                </Typography>
              </Card>
            ))}
          </Stack>

          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
            {t('customers.register.addAddress')}
          </Typography>
          <CustomerAddressFields value={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
          <Button
            variant="contained"
            size="small"
            sx={{ mt: 1.5, fontWeight: 'bold' }}
            disabled={!draft.address_text.trim()}
            onClick={handleAddAddress}
          >
            {t('customers.register.addAddress')}
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddressDialogOpen(false)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Block (F) */}
      <Dialog open={blockOpen} onClose={() => setBlockOpen(false)} maxWidth="xs" fullWidth>
        <form onSubmit={handleConfirmBlock}>
          <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
            <BlockIcon color="error" />
            {t('customers.directory.blockTitle')} <VersionTag feature="customers.block" />
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('customers.directory.blockBody', { name: fullName(blockTarget) })}
            </Typography>
            <TextField
              label={t('customers.directory.blockReason')}
              required
              autoFocus
              fullWidth
              multiline
              rows={2}
              helperText={t('customers.directory.blockReasonHelper')}
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={() => setBlockOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="contained" color="error" disabled={!blockReason.trim()}>
              {t('customers.directory.block')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
