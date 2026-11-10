import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import {
  Box,
  Card,
  Grid,
  Table,
  Stack,
  Alert,
  Button,
  Dialog,
  Switch,
  TableRow,
  TextField,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyLabel } from 'src/utils/currency';
import { formatCalendarDate } from 'src/utils/calendar';
import { amountText, amountFromText } from 'src/utils/amount-input';

import { httpClient as axios } from 'src/api/httpClient';
import { DashboardContent } from 'src/layouts/dashboard';

import { Iconify } from 'src/components/iconify';

interface CreditAccount {
  id: string;
  customer_id: string;
  currency_code: string;
  current_balance: string;
  credit_limit: string;
  availableCredit: string;
  /** What the wallet can pay with today; cashback starts the day after it is earned. */
  spendable?: string;
  notYetUsable?: string;
  nextExpiresOn?: string | null;
  nextExpiresAmount?: string;
  status: string;
  customer?: {
    first_name?: string;
    last_name?: string;
    phone_number?: string;
    mobile?: string;
  };
}

/** The club's rules as head office edits them. Defaults are HamiClub's (2026-11-10). */
interface ClubForm {
  enabled: boolean;
  cashbackPct: string;
  minBill: string;
  startsAfterDays: string;
  validDays: string;
}

const DEFAULT_CLUB: ClubForm = { enabled: true, cashbackPct: '10.00', minBill: '5000000', startsAfterDays: '1', validDays: '14' };

interface ImportResult {
  applied: boolean;
  rowsRead: number;
  credits: number;
  customers: number;
  total: string;
  newCustomers: number;
  alreadyCarried: number;
  skipped: { row: number; reason: string }[];
  sample: { phone: string; amount: string; expiresOn: string; expiresJalali: string; known: boolean }[];
}

interface WalletCashbackPageProps {
  isEmbedded?: boolean;
}

export default function WalletCashbackPage({ isEmbedded = false }: WalletCashbackPageProps) {
  const currency = useCurrencyLabel();
  const { t } = useTranslation();

  const [accounts, setAccounts] = useState<CreditAccount[]>([]);
  const [club, setClub] = useState<ClubForm>(DEFAULT_CLUB);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingPolicy, setSavingPolicy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accRes, settingsRes] = await Promise.all([
        // Wallets only: cashback the customers hold, apart from what they owe on credit.
        axios.get('/api/v1/credit-accounts', { params: { kind: 'WALLET' } }).then((res) => res.data),
        axios.get('/api/v1/settings').then((res) => res.data),
      ]);

      const accList = Array.isArray(accRes) ? accRes : accRes.data || [];
      setAccounts(accList);

      const saved = settingsRes?.CUSTOMER_CLUB || {};
      setClub({
        enabled: saved.enabled !== false,
        cashbackPct: saved.cashback_percentage != null ? String(saved.cashback_percentage) : DEFAULT_CLUB.cashbackPct,
        minBill: saved.min_bill_to_earn != null ? String(saved.min_bill_to_earn) : DEFAULT_CLUB.minBill,
        startsAfterDays: saved.credit_starts_after_days != null ? String(saved.credit_starts_after_days) : DEFAULT_CLUB.startsAfterDays,
        validDays: saved.credit_valid_days != null ? String(saved.credit_valid_days) : DEFAULT_CLUB.validDays,
      });
    } catch (err: any) {
      setError(err.detail || err.message || t('wallet.failedToLoad', 'Failed to load wallet accounts'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSavePolicy = async () => {
    setSavingPolicy(true);
    setError(null);
    setSuccess(null);
    try {
      await axios.patch('/api/v1/settings/CUSTOMER_CLUB', {
        enabled: club.enabled,
        cashback_percentage: club.cashbackPct,
        min_bill_to_earn: club.minBill || '0',
        credit_starts_after_days: Number(club.startsAfterDays) || 0,
        credit_valid_days: Number(club.validDays) || 0,
      });

      setSuccess(t('wallet.policySaved', 'Cashback policy saved successfully. Eligible orders will earn cashback on completion.'));
    } catch (err: any) {
      setError(err.detail || err.message || t('wallet.failedToSave', 'Failed to update cashback policy setting'));
    } finally {
      setSavingPolicy(false);
    }
  };

  const sumOf = (pick: (a: CreditAccount) => string | undefined) =>
    accounts.reduce((sum, a) => MoneyUtil.add(sum, pick(a) || '0'), '0');
  const totalBalance = sumOf((a) => a.current_balance);
  const totalUsable = sumOf((a) => a.spendable ?? a.availableCredit);
  const money = (rials: string | undefined) => `${MoneyUtil.formatCurrency(rials || '0')} ${currency}`;
  const wholeDays = (text: string) => text.replace(/[^\d]/g, '').slice(0, 4);

  const content = (
    <Box sx={{ width: '100%' }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant={isEmbedded ? 'h5' : 'h4'} sx={{ fontWeight: 'bold' }}>
            {t('wallet.title', 'Customer Club Wallet & Cashback')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('wallet.subtitle', 'Configure purchase-based cashback earning rules and manage customer credit wallet balances.')}
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<Iconify icon={'solar:import-bold' as any} />} onClick={() => setImportOpen(true)}>
          {t('wallet.hamiClub.open')}
        </Button>
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

      {/* The club's rules */}
      <Card sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Iconify icon={'solar:wallet-money-bold' as any} width={24} color="primary" />
          {t('wallet.cashbackPolicy', 'Cashback Earning Policy')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('wallet.club.desc')}
        </Typography>

        <FormControlLabel
          sx={{ mb: 2 }}
          control={<Switch checked={club.enabled} onChange={(e) => setClub((c) => ({ ...c, enabled: e.target.checked }))} />}
          label={club.enabled ? t('wallet.club.on') : t('wallet.club.off')}
        />

        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              fullWidth
              type="number"
              label={t('wallet.cashbackPct', 'Cashback Percentage (%)')}
              value={club.cashbackPct}
              onChange={(e) => setClub((c) => ({ ...c, cashbackPct: e.target.value }))}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              fullWidth
              label={`${t('wallet.club.minBill')} (${currency})`}
              helperText={t('wallet.club.minBillHelp')}
              value={amountText(club.minBill)}
              onChange={(e) => setClub((c) => ({ ...c, minBill: amountFromText(e.target.value) }))}
              slotProps={{ htmlInput: { inputMode: 'numeric', dir: 'ltr' } }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              fullWidth
              label={t('wallet.club.startsAfter')}
              helperText={t('wallet.club.startsAfterHelp')}
              value={club.startsAfterDays}
              onChange={(e) => setClub((c) => ({ ...c, startsAfterDays: wholeDays(e.target.value) }))}
              slotProps={{ htmlInput: { inputMode: 'numeric', dir: 'ltr' } }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              fullWidth
              label={t('wallet.club.validDays')}
              helperText={t('wallet.club.validDaysHelp')}
              value={club.validDays}
              onChange={(e) => setClub((c) => ({ ...c, validDays: wholeDays(e.target.value) }))}
              slotProps={{ htmlInput: { inputMode: 'numeric', dir: 'ltr' } }}
            />
          </Grid>
        </Grid>

        <Button
          variant="contained"
          onClick={handleSavePolicy}
          disabled={savingPolicy}
          startIcon={<Iconify icon={'solar:diskette-bold' as any} />}
        >
          {savingPolicy ? <CircularProgress size={24} /> : t('common.savePolicy', 'Save Policy')}
        </Button>
      </Card>

      {/* Balance Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ p: 3, bgcolor: 'background.neutral' }}>
            <Typography variant="overline">{t('wallet.totalActiveWallets', 'Active Customer Wallets')}</Typography>
            <Typography variant="h3">{accounts.length}</Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ p: 3, bgcolor: 'background.neutral' }}>
            <Typography variant="overline">{t('wallet.totalWalletBalance', 'Total Net Wallet Credit Balance')}</Typography>
            <Typography variant="h3">{money(totalBalance)}</Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ p: 3, bgcolor: 'background.neutral' }}>
            <Typography variant="overline">{t('wallet.usableToday')}</Typography>
            <Typography variant="h3">{money(totalUsable)}</Typography>
          </Card>
        </Grid>
      </Grid>

      {/* Customer Wallet Balances Table */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        {t('wallet.customerBalances', 'Customer Wallet Accounts')}
      </Typography>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
          <CircularProgress />
        </Box>
      ) : accounts.length === 0 ? (
        <Card sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            {t('wallet.noAccounts', 'No customer wallet accounts created yet. Wallets are auto-created on first cashback award or POS credit deposit.')}
          </Typography>
        </Card>
      ) : (
        <Card sx={{ overflowX: 'auto' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('wallet.customer', 'Customer')}</TableCell>
                <TableCell>{t('customers.directory.mobileCode')}</TableCell>
                <TableCell>{t('wallet.balance')}</TableCell>
                <TableCell>{t('wallet.usableToday')}</TableCell>
                <TableCell>{t('wallet.startsLater')}</TableCell>
                <TableCell>{t('wallet.nextExpiry')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.map((acc) => {
                const name = acc.customer
                  ? `${acc.customer.first_name || ''} ${acc.customer.last_name || ''}`.trim() || acc.customer.mobile || acc.customer_id
                  : acc.customer_id;

                return (
                  <TableRow key={acc.id} hover>
                    <TableCell>
                      <Typography variant="subtitle2">{name}</Typography>
                    </TableCell>
                    <TableCell>
                      <span dir="ltr">{acc.customer?.mobile || '—'}</span>
                    </TableCell>
                    <TableCell>{money(acc.current_balance)}</TableCell>
                    <TableCell>
                      <Typography variant="subtitle2" color="success.main">
                        {money(acc.spendable ?? acc.availableCredit)}
                      </Typography>
                    </TableCell>
                    <TableCell>{acc.notYetUsable && MoneyUtil.greaterThan(acc.notYetUsable, '0') ? money(acc.notYetUsable) : '—'}</TableCell>
                    <TableCell>
                      {acc.nextExpiresOn ? (
                        <>
                          <bdi>{formatCalendarDate(acc.nextExpiresOn)}</bdi> · {money(acc.nextExpiresAmount)}
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <HamiClubImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onCarried={() => {
          fetchData();
        }}
      />
    </Box>
  );

  return isEmbedded ? content : <DashboardContent>{content}</DashboardContent>;
}

/**
 * A branch's live HamiClub credit, carried into wallets on its switch day. Head office exports
 * the credit list from HamiClub's هدایا report and uploads it here: preview first, then carry over.
 */
function HamiClubImportDialog({ open, onClose, onCarried }: { open: boolean; onClose: () => void; onCarried: () => void }) {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
  };

  const send = async (apply: boolean, chosen: File | null = file) => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', chosen);
      form.append('apply', apply ? 'true' : 'false');
      const res = await axios.post('/api/v1/credit-accounts/wallet/import-hamiclub', form);
      setResult(res.data);
      if (apply) onCarried();
    } catch (err: any) {
      setError(err.detail || err.message || t('wallet.hamiClub.failed'));
    } finally {
      setBusy(false);
    }
  };

  const money = (rials: string) => `${MoneyUtil.formatCurrency(rials)} ${currency}`;
  const skippedBy = (reason: string) => result?.skipped.filter((s) => s.reason === reason).length || 0;

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>{t('wallet.hamiClub.title')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('wallet.hamiClub.howTo')}
        </Typography>

        <Button component="label" variant="outlined" startIcon={<Iconify icon={'solar:file-bold' as any} />} disabled={busy}>
          {file ? file.name : t('wallet.hamiClub.chooseFile')}
          <input
            hidden
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => {
              const chosen = e.target.files?.[0] ?? null;
              setFile(chosen);
              setResult(null);
              if (chosen) send(false, chosen);
            }}
          />
        </Button>

        {busy && <CircularProgress size={24} sx={{ ml: 2, verticalAlign: 'middle' }} />}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {result && (
          <Box sx={{ mt: 2 }}>
            <Alert severity={result.applied ? 'success' : 'info'} sx={{ mb: 2 }}>
              {result.applied
                ? t('wallet.hamiClub.carried', {
                    count: result.credits - result.alreadyCarried,
                    total: money(result.total),
                    already: result.alreadyCarried,
                  })
                : t('wallet.hamiClub.preview', {
                    credits: result.credits,
                    customers: result.customers,
                    total: money(result.total),
                    newCustomers: result.newCustomers,
                  })}
            </Alert>
            {result.skipped.length > 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('wallet.hamiClub.skipped', {
                  ended: skippedBy('ENDED'),
                  noAmount: skippedBy('NO_AMOUNT'),
                  bad: skippedBy('NO_PHONE') + skippedBy('NO_DATE'),
                })}
              </Typography>
            )}
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('customers.directory.mobileCode')}</TableCell>
                  <TableCell>{t('wallet.hamiClub.amount')}</TableCell>
                  <TableCell>{t('wallet.hamiClub.lastDay')}</TableCell>
                  <TableCell>{t('wallet.customer', 'Customer')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.sample.map((row) => (
                  <TableRow key={`${row.phone}-${row.expiresOn}`}>
                    <TableCell>
                      <span dir="ltr">{row.phone}</span>
                    </TableCell>
                    <TableCell>{money(row.amount)}</TableCell>
                    <TableCell>
                      <bdi>{formatCalendarDate(row.expiresOn)}</bdi>
                    </TableCell>
                    <TableCell>{row.known ? t('wallet.hamiClub.known') : t('wallet.hamiClub.new')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            reset();
            onClose();
          }}
        >
          {t('common.close', 'Close')}
        </Button>
        <Button variant="contained" disabled={!result || result.applied || !result.credits || busy} onClick={() => send(true)}>
          {t('wallet.hamiClub.apply')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
