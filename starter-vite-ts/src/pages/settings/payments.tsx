import type { PaymentMethod } from 'src/api/settingsApi';
import type { SettlementAccount } from 'src/api/paymentApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Box,
  Card,
  Chip,
  Stack,
  Table,
  Paper,
  Alert,
  Drawer,
  Button,
  Switch,
  TableRow,
  TextField,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { paymentApi } from 'src/api/paymentApi';
import { settingsApi } from 'src/api/settingsApi';
import { useIsHeadOffice } from 'src/store/useAuthStore';
import { useBranchContext } from 'src/contexts/branch-context';

import { VersionTag } from 'src/components/version-tag';
import { SettingScopeNotice } from 'src/components/setting-scope';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

export function PaymentSettingsPage() {
  const { t } = useTranslation();
  // Tender types have no branch dimension: one set for the chain, written at head office.
  const isHeadOffice = useIsHeadOffice();
  const { selectedBranch } = useBranchContext();

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // The bank accounts the card terminals settle into: the chain's, like the tender types.
  const [accounts, setAccounts] = useState<SettlementAccount[]>([]);
  const [accDrawerOpen, setAccDrawerOpen] = useState(false);
  const [accName, setAccName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [iban, setIban] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, accountList] = await Promise.all([
        settingsApi.getPaymentMethods(),
        paymentApi.getAccounts().catch(() => [] as SettlementAccount[]),
      ]);
      setMethods(list || []);
      setAccounts(accountList);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.detail || err.message || t('settings.paymentsPage.loadError', 'Failed to load payment methods'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleActive = async (m: PaymentMethod, active: boolean) => {
    try {
      await settingsApi.updatePaymentMethod(m.id, { is_active: active });
      loadData();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.detail || err.message || t('settings.paymentsPage.statusError', 'Failed to update payment method status'));
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await paymentApi.createAccount({
        name: accName,
        bank_name: bankName || undefined,
        account_number: accountNumber || undefined,
        iban: iban || undefined,
      });
      setAccDrawerOpen(false);
      setAccName('');
      setBankName('');
      setAccountNumber('');
      setIban('');
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create settlement account');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('settings.paymentsPage.title', 'Payment Methods')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.paymentsPage.title', 'Payment Methods') },
        ]}
        action={
          <Stack direction="row" spacing={1.5}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
              {t('common.refresh', 'Refresh')}
            </Button>
          </Stack>
        }
      />

      <SettingScopeNotice kind="CHAIN" isHeadOffice={isHeadOffice} branchName={selectedBranch?.name} />

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

      <Card>
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.paymentsPage.colName', 'Name')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.paymentsPage.colKind', 'Kind')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.paymentsPage.colDevice', 'Device / Reference')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.paymentsPage.colStatus', 'Status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {methods.map((m) => (
                <TableRow key={m.id} hover>
                  <TableCell sx={{ fontWeight: 700 }}>{m.name}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={t(`settings.paymentsPage.kinds.${m.kind}`, m.kind)}
                      color={
                        m.kind === 'CASH'
                          ? 'success'
                          : m.kind === 'CARD' || m.kind === 'POS' || m.kind === 'CARD_POS'
                          ? 'primary'
                          : m.kind === 'CREDIT'
                          ? 'warning'
                          : 'info'
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      {m.requires_device && (
                        <Chip size="small" label={t('settings.paymentsPage.hardwarePos', 'Hardware POS')} variant="outlined" />
                      )}
                      {m.requires_reference && (
                        <Chip size="small" label={t('settings.paymentsPage.refRequired', 'Ref Required')} variant="outlined" />
                      )}
                      {!m.requires_device && !m.requires_reference && (
                        <Typography variant="caption" color="text.secondary">—</Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={m.is_active}
                      onChange={(e) => handleToggleActive(m, e.target.checked)}
                      disabled={!isHeadOffice}
                      size="small"
                      color="primary"
                    />
                  </TableCell>
                </TableRow>
              ))}
              {methods.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ textAlign: 'center', py: 4 }}>
                    <Typography color="text.secondary">
                      {t('settings.paymentsPage.noMethods', 'No payment methods configured.')}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Bank settlement accounts */}
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 4, mb: 1.5 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="h6">{t('payments.tabAccounts', 'Bank Settlement Accounts')}</Typography>
          <VersionTag feature="payments.settlementAccounts" />
        </Stack>
        <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAccDrawerOpen(true)} disabled={!isHeadOffice}>
          {t('payments.addAccount', 'Create Account')}
        </Button>
      </Stack>
      <Card>
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('payments.accounts.colName', 'Account name')}</TableCell>
                <TableCell>{t('payments.accounts.colBank', 'Bank')}</TableCell>
                <TableCell>{t('payments.accounts.colNumber', 'Account number')}</TableCell>
                <TableCell>{t('payments.accounts.colIban', 'IBAN (Sheba)')}</TableCell>
                <TableCell>{t('payments.cardTerminals.colStatus', 'Status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                      {t('payments.accounts.empty', 'No settlement accounts yet.')}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                accounts.map((acc) => (
                  <TableRow key={acc.id}>
                    <TableCell sx={{ fontWeight: 'bold' }}>{acc.name}</TableCell>
                    <TableCell>{acc.bank_name || '-'}</TableCell>
                    <TableCell><bdi dir="ltr">{acc.account_number || '-'}</bdi></TableCell>
                    <TableCell><bdi dir="ltr">{acc.iban || '-'}</bdi></TableCell>
                    <TableCell>
                      <Chip label={acc.is_active ? t('payments.cardTerminals.active', 'Active') : t('payments.cardTerminals.inactive', 'Inactive')} color={acc.is_active ? 'success' : 'default'} size="small" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Drawer anchor="right" open={accDrawerOpen} onClose={() => setAccDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            {t('payments.accounts.drawerTitle', 'New settlement account')}
          </Typography>
          <Box component="form" onSubmit={handleCreateAccount}>
            <Stack spacing={2.5}>
              <TextField label={t('payments.accounts.colName', 'Account name')} value={accName} onChange={(e) => setAccName(e.target.value)} required fullWidth placeholder={t('payments.accounts.namePlaceholder', 'e.g. Mellat company account')} />
              <TextField label={t('payments.accounts.colBank', 'Bank')} value={bankName} onChange={(e) => setBankName(e.target.value)} fullWidth placeholder={t('payments.accounts.bankPlaceholder', 'e.g. Bank Mellat')} />
              <TextField label={t('payments.accounts.colNumber', 'Account number')} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} fullWidth />
              <TextField label={t('payments.accounts.colIban', 'IBAN (Sheba)')} value={iban} onChange={(e) => setIban(e.target.value)} fullWidth placeholder="IR..." />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                {t('payments.cardTerminals.save', 'Save')}
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>
    </Box>
  );
}
