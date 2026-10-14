import type { PaymentMethod } from 'src/api/settingsApi';
import type { SettlementAccount } from 'src/api/paymentApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
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
  Select,
  Divider,
  TableRow,
  MenuItem,
  TextField,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  IconButton,
  InputLabel,
  FormControl,
  TableContainer,
  FormControlLabel,
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

  // Drawer modal state for create/edit
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);
  const [formName, setFormName] = useState('');
  const [formKind, setFormKind] = useState('CARD');
  const [formRequiresRef, setFormRequiresRef] = useState(false);
  const [formRequiresDevice, setFormRequiresDevice] = useState(true);
  const [formActive, setFormActive] = useState(true);
  const [savingMethod, setSavingMethod] = useState(false);

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

  const handleOpenCreate = () => {
    setEditingMethod(null);
    setFormName('');
    setFormKind('CARD');
    setFormRequiresRef(false);
    setFormRequiresDevice(true);
    setFormActive(true);
    setDrawerOpen(true);
  };

  const handleOpenEdit = (m: PaymentMethod) => {
    setEditingMethod(m);
    setFormName(m.name);
    setFormKind(m.kind);
    setFormRequiresRef(m.requires_reference);
    setFormRequiresDevice(m.requires_device);
    setFormActive(m.is_active);
    setDrawerOpen(true);
  };

  const handleToggleActive = async (m: PaymentMethod, active: boolean) => {
    try {
      await settingsApi.updatePaymentMethod(m.id, { is_active: active });
      loadData();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.detail || err.message || t('settings.paymentsPage.statusError', 'Failed to update payment method status'));
    }
  };

  const handleSaveMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMethod(true);
    setError(null);

    // A new method's code is made on the server, it is in Rials and in use, and what it needs at
    // the till follows from its kind: a card goes through the terminal, a transfer needs its
    // reference. Editing shows the switches for the odd method that differs.
    const payload = editingMethod
      ? {
          name: formName.trim(),
          kind: formKind,
          requires_reference: formRequiresRef,
          requires_device: formRequiresDevice,
          is_active: formActive,
        }
      : {
          name: formName.trim(),
          kind: formKind,
          requires_device: formKind === 'CARD',
          requires_reference: formKind === 'BANK_TRANSFER',
          is_active: true,
        };

    try {
      if (editingMethod) {
        await settingsApi.updatePaymentMethod(editingMethod.id, payload);
        setSuccess(t('settings.paymentsPage.updatedSuccess', 'Payment method updated successfully'));
      } else {
        await settingsApi.createPaymentMethod(payload);
        setSuccess(t('settings.paymentsPage.createdSuccess', 'Payment method created successfully'));
      }
      setDrawerOpen(false);
      loadData();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.detail || err.message || t('settings.paymentsPage.saveError', 'Failed to save payment method'));
    } finally {
      setSavingMethod(false);
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
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate} disabled={!isHeadOffice}>
              {t('settings.paymentsPage.addMethod', 'Add Payment Method')}
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

      <Card sx={{ borderRadius: 2 }}>
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.paymentsPage.colName', 'Name')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.paymentsPage.colKind', 'Kind')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.paymentsPage.colDevice', 'Device / Reference')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.paymentsPage.colStatus', 'Status')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  {t('settings.paymentsPage.colActions', 'Actions')}
                </TableCell>
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
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => handleOpenEdit(m)} disabled={!isHeadOffice}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {methods.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ textAlign: 'center', py: 4 }}>
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
      <Card sx={{ borderRadius: 2 }}>
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Account Name</TableCell>
                <TableCell>Bank</TableCell>
                <TableCell>Account Number</TableCell>
                <TableCell>IBAN</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                      No settlement accounts created yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                accounts.map((acc) => (
                  <TableRow key={acc.id}>
                    <TableCell sx={{ fontWeight: 'bold' }}>{acc.name}</TableCell>
                    <TableCell>{acc.bank_name || '-'}</TableCell>
                    <TableCell>{acc.account_number || '-'}</TableCell>
                    <TableCell>{acc.iban || '-'}</TableCell>
                    <TableCell>
                      <Chip label={acc.is_active ? 'Active' : 'Inactive'} color={acc.is_active ? 'success' : 'default'} size="small" />
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
            Create Settlement Account
          </Typography>
          <Box component="form" onSubmit={handleCreateAccount}>
            <Stack spacing={2.5}>
              <TextField label="Account Name" value={accName} onChange={(e) => setAccName(e.target.value)} required fullWidth placeholder="e.g. Mellat Corporate Account" />
              <TextField label="Bank Name" value={bankName} onChange={(e) => setBankName(e.target.value)} fullWidth placeholder="e.g. Bank Mellat" />
              <TextField label="Account Number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} fullWidth />
              <TextField label="IBAN (Sheba)" value={iban} onChange={(e) => setIban(e.target.value)} fullWidth placeholder="IR..." />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                Save Account
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>

      {/* Create / Edit Drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        <Box sx={{ width: { xs: 320, sm: 420 }, p: 3 }} component="form" onSubmit={handleSaveMethod}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            {editingMethod
              ? t('settings.paymentsPage.editMethod', 'Edit Payment Method')
              : t('settings.paymentsPage.newMethod', 'New Payment Method')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('settings.paymentsPage.drawerSubtitle', 'Configure instrument parameters and reconciliation flags.')}
          </Typography>

          <Stack spacing={2.5}>
            <TextField
              required
              fullWidth
              label={t('settings.paymentsPage.formName', 'Display Name')}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder={t('settings.paymentsPage.formNamePlaceholder', 'e.g. Bank POS Terminal, Cash Tender')}
            />

            <FormControl fullWidth>
              <InputLabel>{t('settings.paymentsPage.formKind', 'Instrument Kind')}</InputLabel>
              <Select
                value={formKind}
                label={t('settings.paymentsPage.formKind', 'Instrument Kind')}
                onChange={(e) => setFormKind(e.target.value)}
              >
                <MenuItem value="CASH">{t('settings.paymentsPage.kinds.CASH', 'Cash Tender')}</MenuItem>
                <MenuItem value="CARD">{t('settings.paymentsPage.kinds.CARD', 'Card / EFT POS')}</MenuItem>
                <MenuItem value="POS">{t('settings.paymentsPage.kinds.POS', 'Mobile POS (Courier)')}</MenuItem>
                <MenuItem value="CREDIT">{t('settings.paymentsPage.kinds.CREDIT', 'Customer Credit Account')}</MenuItem>
                {/* The method Snappfood's prepaid orders are recorded under; it is kept, not offered as a new kind. */}
                {formKind === 'ONLINE' && (
                  <MenuItem value="ONLINE">{t('settings.paymentsPage.kinds.ONLINE', 'Online Payment Gateway')}</MenuItem>
                )}
                <MenuItem value="BANK_TRANSFER">{t('settings.paymentsPage.kinds.BANK_TRANSFER', 'Bank Transfer / Sheba')}</MenuItem>
                <MenuItem value="OTHER">{t('settings.paymentsPage.kinds.OTHER', 'Other')}</MenuItem>
              </Select>
            </FormControl>

            {editingMethod && <Divider />}

            {editingMethod && (
            <FormControlLabel
              control={<Switch checked={formRequiresDevice} onChange={(e) => setFormRequiresDevice(e.target.checked)} />}
              label={t('settings.paymentsPage.reqDevice', 'Requires Hardware EFT POS Terminal')}
            />
            )}

            {editingMethod && (
            <FormControlLabel
              control={<Switch checked={formRequiresRef} onChange={(e) => setFormRequiresRef(e.target.checked)} />}
              label={t('settings.paymentsPage.reqRef', 'Requires Transaction Reference / RRN')}
            />
            )}

            {editingMethod && (
            <FormControlLabel
              control={<Switch checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />}
              label={t('settings.paymentsPage.formActive', 'Active & Available at POS')}
            />
            )}

            <Button
              type="submit"
              variant="contained"
              fullWidth
              size="large"
              startIcon={<SaveIcon />}
              disabled={savingMethod}
              sx={{ mt: 2, fontWeight: 700 }}
            >
              {savingMethod
                ? '...'
                : editingMethod
                ? t('settings.paymentsPage.updateButton', 'Update Method')
                : t('settings.paymentsPage.createButton', 'Create Method')}
            </Button>
          </Stack>
        </Box>
      </Drawer>
    </Box>
  );
}
