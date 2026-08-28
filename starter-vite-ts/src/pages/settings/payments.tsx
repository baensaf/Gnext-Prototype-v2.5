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

export function PaymentSettingsPage() {
  const { t } = useTranslation();

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
      setError(err?.response?.data?.message || err.detail || err.message || 'Failed to load payment methods');
    } finally {
      setLoading(false);
    }
  }, []);

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
      setError(err?.response?.data?.message || err.detail || err.message || 'Failed to update payment method status');
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
        setSuccess('Payment method updated successfully');
      } else {
        await settingsApi.createPaymentMethod(payload);
        setSuccess('Payment method created successfully');
      }
      setDrawerOpen(false);
      loadData();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.detail || err.message || 'Failed to save payment method');
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
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            {t('settings.payments.title', 'Payment & Refund Methods')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(
              'settings.payments.subtitle',
              'Configure tender instruments (Cash, EFT POS, Tara Pay, Credit), device requirements, and alternative refund permissions.'
            )}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            {t('common.refresh', 'Refresh')}
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
            {t('settings.payments.addMethod', 'Add Payment Method')}
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

      <Card sx={{ borderRadius: 2 }}>
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Code</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Kind</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Currency</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Device / Reference</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Refund Policy</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Actions</TableCell>
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
                      label={m.kind}
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
                      {m.requires_device && <Chip size="small" label="Hardware POS" variant="outlined" />}
                      {m.requires_reference && <Chip size="small" label="Ref Required" variant="outlined" />}
                      {!m.requires_device && !m.requires_reference && <Typography variant="caption" color="text.secondary">None</Typography>}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      {m.allows_refund ? (
                        <Chip size="small" label="Refundable" color="success" variant="outlined" />
                      ) : (
                        <Chip size="small" label="No Refund" color="error" variant="outlined" />
                      )}
                      {m.allows_alternative_refund && (
                        <Chip size="small" label="Alt Refund Allowed" color="warning" variant="outlined" />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={m.is_active}
                      onChange={(e) => handleToggleActive(m, e.target.checked)}
                      size="small"
                      color="primary"
                    />
                  </TableCell>
                  <TableCell sx={{ textAlign: 'right' }}>
                    <IconButton size="small" onClick={() => handleOpenEdit(m)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {methods.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} sx={{ textAlign: 'center', py: 4 }}>
                    <Typography color="text.secondary">No payment methods configured.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Create / Edit Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: { xs: 320, sm: 420 }, p: 3 }} component="form" onSubmit={handleSaveMethod}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            {editingMethod ? 'Edit Payment Method' : 'New Payment Method'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Configure instrument parameters, reconciliation flags, and alternative refund rules.
          </Typography>

          <Stack spacing={2.5}>
            <TextField
              required
              fullWidth
              label="Method Code"
              value={formCode}
              onChange={(e) => setFormCode(e.target.value)}
              disabled={Boolean(editingMethod)}
              placeholder="e.g. CARD_POS, CASH, TARA_PAY"
            />

            <TextField
              required
              fullWidth
              label="Display Name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. Bank POS Terminal, Cash Tender"
            />

            <FormControl fullWidth>
              <InputLabel>Instrument Kind</InputLabel>
              <Select value={formKind} label="Instrument Kind" onChange={(e) => setFormKind(e.target.value)}>
                <MenuItem value="CASH">Cash Tender</MenuItem>
                <MenuItem value="CARD">Card / EFT POS</MenuItem>
                <MenuItem value="POS">Mobile POS (Courier)</MenuItem>
                <MenuItem value="CREDIT">Customer Credit Account</MenuItem>
                <MenuItem value="ONLINE">Online Payment Gateway</MenuItem>
                <MenuItem value="BANK_TRANSFER">Bank Transfer / Sheba</MenuItem>
                <MenuItem value="OTHER">Other / Tara Pay</MenuItem>
              </Select>
            </FormControl>

            <TextField
              fullWidth
              label="Currency Code"
              value={formCurrency}
              onChange={(e) => setFormCurrency(e.target.value.toUpperCase())}
            />

            <Divider />

            <FormControlLabel
              control={<Switch checked={formRequiresDevice} onChange={(e) => setFormRequiresDevice(e.target.checked)} />}
              label="Requires Hardware EFT POS Terminal"
            />

            <FormControlLabel
              control={<Switch checked={formRequiresRef} onChange={(e) => setFormRequiresRef(e.target.checked)} />}
              label="Requires Transaction Reference / RRN"
            />

            <FormControlLabel
              control={<Switch checked={formAllowsRefund} onChange={(e) => setFormAllowsRefund(e.target.checked)} />}
              label="Allows Direct Refund"
            />

            <FormControlLabel
              control={<Switch checked={formAllowsAltRefund} onChange={(e) => setFormAllowsAltRefund(e.target.checked)} />}
              label="Allows Alternative Refund Method (e.g. Cash for Card)"
            />

            <FormControlLabel
              control={<Switch checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />}
              label="Active & Available at POS"
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
              {savingMethod ? 'Saving...' : editingMethod ? 'Update Method' : 'Create Method'}
            </Button>
          </Stack>
        </Box>
      </Drawer>
    </Box>
  );
}
