import type { PaymentMethod } from 'src/api/settingsApi';

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

import { settingsApi } from 'src/api/settingsApi';
import { useIsHeadOffice } from 'src/store/useAuthStore';
import { useBranchContext } from 'src/contexts/branch-context';

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
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formKind, setFormKind] = useState('CARD');
  const [formCurrency, setFormCurrency] = useState('IRR');
  const [formRequiresRef, setFormRequiresRef] = useState(false);
  const [formRequiresDevice, setFormRequiresDevice] = useState(true);
  const [formAllowsRefund, setFormAllowsRefund] = useState(true);
  const [formAllowsAltRefund, setFormAllowsAltRefund] = useState(false);
  const [formActive, setFormActive] = useState(true);
  const [savingMethod, setSavingMethod] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await settingsApi.getPaymentMethods();
      setMethods(list || []);
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
    setFormCode('');
    setFormName('');
    setFormKind('CARD');
    setFormCurrency('IRR');
    setFormRequiresRef(false);
    setFormRequiresDevice(true);
    setFormAllowsRefund(true);
    setFormAllowsAltRefund(false);
    setFormActive(true);
    setDrawerOpen(true);
  };

  const handleOpenEdit = (m: PaymentMethod) => {
    setEditingMethod(m);
    setFormCode(m.code);
    setFormName(m.name);
    setFormKind(m.kind);
    setFormCurrency(m.currency_code || 'IRR');
    setFormRequiresRef(m.requires_reference);
    setFormRequiresDevice(m.requires_device);
    setFormAllowsRefund(m.allows_refund);
    setFormAllowsAltRefund(m.allows_alternative_refund);
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

    const payload = {
      code: formCode.toUpperCase().trim(),
      name: formName.trim(),
      kind: formKind,
      currency_code: formCurrency,
      requires_reference: formRequiresRef,
      requires_device: formRequiresDevice,
      allows_refund: formAllowsRefund,
      allows_alternative_refund: formAllowsAltRefund,
      is_active: formActive,
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
        heading={t('settings.paymentsPage.title', 'Payment & Refund Methods')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.paymentsPage.title', 'Payments & Refunds') },
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
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.paymentsPage.colCode', 'Code')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.paymentsPage.colName', 'Name')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.paymentsPage.colKind', 'Kind')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.paymentsPage.colCurrency', 'Currency')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.paymentsPage.colDevice', 'Device / Reference')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.paymentsPage.colRefund', 'Refund Policy')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.paymentsPage.colStatus', 'Status')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  {t('settings.paymentsPage.colActions', 'Actions')}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {methods.map((m) => (
                <TableRow key={m.id} hover>
                  <TableCell>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {m.code}
                    </Typography>
                  </TableCell>
                  <TableCell>{m.name}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={t(`settings.paymentsPage.kinds.${m.kind}`, m.kind)}
                      color={
                        m.kind === 'CASH'
                          ? 'success'
                          : m.kind === 'CARD' || m.kind === 'POS'
                          ? 'primary'
                          : m.kind === 'CREDIT'
                          ? 'warning'
                          : 'info'
                      }
                    />
                  </TableCell>
                  <TableCell>{m.currency_code || 'IRR'}</TableCell>
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
                    <Stack direction="row" spacing={0.5}>
                      {m.allows_refund ? (
                        <Chip size="small" label={t('settings.paymentsPage.refundable', 'Refundable')} color="success" variant="outlined" />
                      ) : (
                        <Chip size="small" label={t('settings.paymentsPage.noRefund', 'No Refund')} color="error" variant="outlined" />
                      )}
                      {m.allows_alternative_refund && (
                        <Chip size="small" label={t('settings.paymentsPage.altRefund', 'Alt Refund Allowed')} color="warning" variant="outlined" />
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
                  <TableCell colSpan={8} sx={{ textAlign: 'center', py: 4 }}>
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
            {t('settings.paymentsPage.drawerSubtitle', 'Configure instrument parameters, reconciliation flags, and alternative refund rules.')}
          </Typography>

          <Stack spacing={2.5}>
            <TextField
              required
              fullWidth
              label={t('settings.paymentsPage.formCode', 'Method Code')}
              value={formCode}
              onChange={(e) => setFormCode(e.target.value)}
              disabled={Boolean(editingMethod)}
              placeholder={t('settings.paymentsPage.formCodePlaceholder', 'e.g. CARD_POS, CASH, TARA_PAY')}
            />

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
                <MenuItem value="ONLINE">{t('settings.paymentsPage.kinds.ONLINE', 'Online Payment Gateway')}</MenuItem>
                <MenuItem value="BANK_TRANSFER">{t('settings.paymentsPage.kinds.BANK_TRANSFER', 'Bank Transfer / Sheba')}</MenuItem>
                <MenuItem value="OTHER">{t('settings.paymentsPage.kinds.OTHER', 'Other / Tara Pay')}</MenuItem>
              </Select>
            </FormControl>

            <TextField
              fullWidth
              label={t('settings.paymentsPage.formCurrency', 'Currency Code')}
              value={formCurrency}
              onChange={(e) => setFormCurrency(e.target.value.toUpperCase())}
            />

            <Divider />

            <FormControlLabel
              control={<Switch checked={formRequiresDevice} onChange={(e) => setFormRequiresDevice(e.target.checked)} />}
              label={t('settings.paymentsPage.reqDevice', 'Requires Hardware EFT POS Terminal')}
            />

            <FormControlLabel
              control={<Switch checked={formRequiresRef} onChange={(e) => setFormRequiresRef(e.target.checked)} />}
              label={t('settings.paymentsPage.reqRef', 'Requires Transaction Reference / RRN')}
            />

            <FormControlLabel
              control={<Switch checked={formAllowsRefund} onChange={(e) => setFormAllowsRefund(e.target.checked)} />}
              label={t('settings.paymentsPage.allowRefund', 'Allows Direct Refund')}
            />

            <FormControlLabel
              control={<Switch checked={formAllowsAltRefund} onChange={(e) => setFormAllowsAltRefund(e.target.checked)} />}
              label={t('settings.paymentsPage.allowAltRefund', 'Allows Alternative Refund Method (e.g. Cash for Card)')}
            />

            <FormControlLabel
              control={<Switch checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />}
              label={t('settings.paymentsPage.formActive', 'Active & Available at POS')}
            />

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
