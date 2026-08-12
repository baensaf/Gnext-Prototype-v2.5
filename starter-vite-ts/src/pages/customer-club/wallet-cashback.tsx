import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import {
  Box,
  Card,
  Grid,
  Chip,
  Table,
  Stack,
  Alert,
  Button,
  TableRow,
  TextField,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  CircularProgress,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';

import { DashboardContent } from 'src/layouts/dashboard';

import { Iconify } from 'src/components/iconify';

interface CreditAccount {
  id: string;
  customer_id: string;
  currency_code: string;
  current_balance: string;
  credit_limit: string;
  availableCredit: string;
  status: string;
  customer?: {
    first_name?: string;
    last_name?: string;
    phone_number?: string;
  };
}

export default function WalletCashbackPage() {
  const { t } = useTranslation();

  const [accounts, setAccounts] = useState<CreditAccount[]>([]);
  const [cashbackPct, setCashbackPct] = useState<string>('5.00');
  const [loading, setLoading] = useState<boolean>(true);
  const [savingPolicy, setSavingPolicy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accRes, settingsRes] = await Promise.all([
        fetch('/api/v1/credit-accounts').then((res) => res.json()),
        fetch('/api/v1/settings').then((res) => res.json()),
      ]);

      const accList = Array.isArray(accRes) ? accRes : accRes.data || [];
      setAccounts(accList);

      if (settingsRes?.CUSTOMER_CLUB?.cashback_percentage) {
        setCashbackPct(String(settingsRes.CUSTOMER_CLUB.cashback_percentage));
      }
    } catch (err: any) {
      setError(err.message || t('wallet.failedToLoad', 'Failed to load wallet accounts'));
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
      const res = await fetch('/api/v1/settings/CUSTOMER_CLUB', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cashback_percentage: cashbackPct }),
      });

      if (!res.ok) throw new Error('Failed to update cashback policy setting');

      setSuccess(t('wallet.policySaved', 'Cashback policy saved successfully. Eligible orders will earn cashback on completion.'));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingPolicy(false);
    }
  };

  const totalBalance = accounts.reduce((sum, a) => MoneyUtil.add(sum, a.current_balance || '0'), '0');

  return (
    <DashboardContent>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h4">{t('wallet.title', 'Customer Club Wallet & Cashback')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('wallet.subtitle', 'Configure purchase-based cashback earning rules and manage customer credit wallet balances.')}
          </Typography>
        </Box>
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

      {/* Cashback Policy Card */}
      <Card sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Iconify icon={'solar:wallet-money-bold' as any} width={24} color="primary" />
          {t('wallet.cashbackPolicy', 'Cashback Earning Policy')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('wallet.cashbackPolicyDesc', 'Percentage of net paid order subtotal (after discounts) credited to customer credit wallet upon completion.')}
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          <TextField
            type="number"
            label={t('wallet.cashbackPct', 'Cashback Percentage (%)')}
            value={cashbackPct}
            onChange={(e) => setCashbackPct(e.target.value)}
            sx={{ maxWidth: 260 }}
          />
          <Button
            variant="contained"
            onClick={handleSavePolicy}
            disabled={savingPolicy}
            startIcon={<Iconify icon={'solar:copy-bold' as any} />}
          >
            {savingPolicy ? <CircularProgress size={24} /> : t('common.savePolicy', 'Save Policy')}
          </Button>
        </Stack>
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
            <Typography variant="h3">{MoneyUtil.formatCurrency(totalBalance)} IRR</Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ p: 3, bgcolor: 'background.neutral' }}>
            <Typography variant="overline">{t('wallet.loyaltySource', 'Ledger Source Type')}</Typography>
            <Typography variant="h6" sx={{ mt: 1 }}>LOYALTY_CASHBACK</Typography>
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
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            {t('wallet.noAccounts', 'No customer wallet accounts created yet. Wallets are auto-created on first cashback award or POS credit deposit.')}
          </Typography>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('wallet.customer', 'Customer')}</TableCell>
                <TableCell>{t('wallet.currency', 'Currency')}</TableCell>
                <TableCell>{t('wallet.currentBalance', 'Available Balance')}</TableCell>
                <TableCell>{t('wallet.status', 'Status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.map((acc) => {
                const name = acc.customer
                  ? `${acc.customer.first_name || ''} ${acc.customer.last_name || ''}`.trim() || acc.customer.phone_number || acc.customer_id
                  : acc.customer_id;

                return (
                  <TableRow key={acc.id} hover>
                    <TableCell>
                      <Typography variant="subtitle2">{name}</Typography>
                    </TableCell>
                    <TableCell>{acc.currency_code}</TableCell>
                    <TableCell>
                      <Typography variant="subtitle2" color="success.main">
                        {MoneyUtil.formatCurrency(acc.current_balance)} {acc.currency_code}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={acc.status}
                        color={acc.status === 'ACTIVE' ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </DashboardContent>
  );
}
