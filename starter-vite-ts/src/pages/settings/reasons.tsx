import type { ReasonCode } from 'src/api/settingsApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import {
  Box,
  Card,
  Chip,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Drawer,
  Switch,
  TableRow,
  Checkbox,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  CardContent,
  TableContainer,
  FormControlLabel,
} from '@mui/material';

import { settingsApi } from 'src/api/settingsApi';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

const DOMAIN_OPTIONS = [
  'ORDER_CANCEL',
  'REFUND',
  'PAYMENT_REVERSAL',
  'SHIFT_CLOSE',
  'SETTLEMENT_CLOSE',
  'REPRINT',
  'PRICE_OVERRIDE',
  'ITEM_VOID',
  'OTHER',
];

export function ReasonCodesPage() {
  const { t } = useTranslation();

  const [reasons, setReasons] = useState<ReasonCode[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingReason, setEditingReason] = useState<ReasonCode | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [appliesTo, setAppliesTo] = useState<string[]>(['ORDER_CANCEL']);
  const [requiresNote, setRequiresNote] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await settingsApi.getReasonCodes();
      setReasons(data || []);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.detail || t('settings.reasonsPage.loadError', 'Failed to load reason codes'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenCreate = () => {
    setEditingReason(null);
    setCode('');
    setName('');
    setAppliesTo(['ORDER_CANCEL']);
    setRequiresNote(false);
    setDrawerOpen(true);
  };

  const handleOpenEdit = (r: ReasonCode) => {
    setEditingReason(r);
    setCode(r.code);
    setName(r.name);
    setAppliesTo(r.applies_to || []);
    setRequiresNote(r.requires_note);
    setDrawerOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingReason) {
        await settingsApi.updateReasonCode(editingReason.id, {
          name,
          applies_to: appliesTo,
          requires_note: requiresNote,
        });
      } else {
        await settingsApi.createReasonCode({ code, name, applies_to: appliesTo, requires_note: requiresNote });
      }
      setSuccess(t('settings.reasonsPage.saveSuccess', 'Reason code saved successfully'));
      setDrawerOpen(false);
      loadData();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.detail || t('settings.reasonsPage.saveError', 'Failed to save reason code'));
    }
  };

  const handleToggleDomain = (domain: string) => {
    setAppliesTo((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  };

  const handleToggleActive = async (reason: ReasonCode, active: boolean) => {
    try {
      await settingsApi.updateReasonCode(reason.id, { is_active: active });
      loadData();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.detail || t('settings.reasonsPage.statusError', 'Failed to update reason code status'));
    }
  };

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('settings.reasonsPage.title', 'Reason Codes Management')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.reasonsPage.title', 'Reason Codes') },
        ]}
        action={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleOpenCreate}
            sx={{ fontWeight: 'bold' }}
          >
            {t('settings.reasonsPage.createReason', 'Create Reason Code')}
          </Button>
        }
      />

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

      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 0 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('settings.reasonsPage.colCode', 'Code')}</TableCell>
                  <TableCell>{t('settings.reasonsPage.colName', 'Reason Name')}</TableCell>
                  <TableCell>{t('settings.reasonsPage.colAppliesTo', 'Applies To')}</TableCell>
                  <TableCell align="center">{t('settings.reasonsPage.colRequiresNote', 'Requires Note')}</TableCell>
                  <TableCell align="center">{t('settings.reasonsPage.colActive', 'Active')}</TableCell>
                  <TableCell align="right">
                    {t('common.actions', 'Actions')}
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reasons.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><code>{r.code}</code></TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{r.name}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                        {r.applies_to.map((domain) => (
                          <Chip
                            key={domain}
                            label={t(`settings.reasonsPage.domains.${domain}`, domain)}
                            size="small"
                            variant="outlined"
                          />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={r.requires_note ? t('settings.reasonsPage.yes', 'Yes') : t('settings.reasonsPage.no', 'No')}
                        color={r.requires_note ? 'warning' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Switch
                        checked={r.is_active}
                        onChange={(e) => handleToggleActive(r, e.target.checked)}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => handleOpenEdit(r)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create / Edit Reason Code Drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        <Box sx={{ width: { xs: 320, sm: 420 }, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            {editingReason
              ? t('settings.reasonsPage.drawerTitleEdit', 'Edit Reason Code')
              : t('settings.reasonsPage.drawerTitleCreate', 'Create Reason Code')}
          </Typography>

          <form onSubmit={handleSave}>
            <Stack spacing={2.5}>
              <TextField
                label={t('settings.reasonsPage.formCode', 'Reason Code')}
                placeholder={t('settings.reasonsPage.formCodePlaceholder', 'e.g. CUSTOMER_CANCEL')}
                required
                fullWidth
                disabled={Boolean(editingReason)}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />

              <TextField
                label={t('settings.reasonsPage.formName', 'Reason Display Name')}
                placeholder={t('settings.reasonsPage.formNamePlaceholder', 'e.g. Customer Requested Cancellation')}
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                  {t('settings.reasonsPage.formDomains', 'Applies To Operational Domains')}
                </Typography>
                <Stack spacing={0.5}>
                  {DOMAIN_OPTIONS.map((d) => (
                    <FormControlLabel
                      key={d}
                      control={
                        <Checkbox
                          checked={appliesTo.includes(d)}
                          onChange={() => handleToggleDomain(d)}
                        />
                      }
                      label={t(`settings.reasonsPage.domains.${d}`, d)}
                    />
                  ))}
                </Stack>
              </Box>

              <FormControlLabel
                control={
                  <Checkbox
                    checked={requiresNote}
                    onChange={(e) => setRequiresNote(e.target.checked)}
                  />
                }
                label={t('settings.reasonsPage.formRequiresNote', 'Requires Cashier Note When Selected')}
              />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                {t('settings.reasonsPage.saveButton', 'Save Reason Code')}
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>
    </Box>
  );
}
