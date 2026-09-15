import type { CourierPayMode } from 'src/api/deliveryApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import TwoWheelerIcon from '@mui/icons-material/TwoWheeler';
import {
  Box,
  Card,
  Stack,
  Alert,
  Switch,
  Button,
  Divider,
  MenuItem,
  TextField,
  Typography,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';

import { settingsApi } from 'src/api/settingsApi';
import { COURIER_PAY_MODES } from 'src/api/deliveryApi';
import { useBranchContext } from 'src/contexts/branch-context';

import { SettingScopeNotice } from 'src/components/setting-scope';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

interface CourierPayPolicy {
  defaultPayMode: CourierPayMode;
  payFailedDeliveries: boolean;
}

/** The server's defaults, used until head office writes a COURIER_PAY row. */
const COURIER_PAY_DEFAULTS: CourierPayPolicy = { defaultPayMode: 'FLAT', payFailedDeliveries: false };

/**
 * How couriers are paid by default. Head office sets it for the chain and a branch may keep its
 * own. Each courier still carries their own rule, set on the Couriers tab; this decides which
 * rule a new courier starts on, and whether a ride that could not be delivered is paid.
 */
export function CourierPaySettingsPage() {
  const { t } = useTranslation();
  const { selectedBranchId, selectedBranch } = useBranchContext();

  const [policy, setPolicy] = useState<CourierPayPolicy>(COURIER_PAY_DEFAULTS);
  const [source, setSource] = useState<'BRANCH' | 'ORG'>('ORG');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scoped = await settingsApi.getScopedSettings(selectedBranchId || undefined);
      const group = scoped.groups?.COURIER_PAY;
      const value = group?.value || {};
      setPolicy({
        defaultPayMode: (COURIER_PAY_MODES as readonly string[]).includes(value.defaultPayMode)
          ? value.defaultPayMode
          : COURIER_PAY_DEFAULTS.defaultPayMode,
        payFailedDeliveries:
          typeof value.payFailedDeliveries === 'boolean' ? value.payFailedDeliveries : COURIER_PAY_DEFAULTS.payFailedDeliveries,
      });
      setSource(group?.source || 'ORG');
    } catch (err: any) {
      setError(err.detail || err.message || t('settings.courierPay.loadError'));
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await settingsApi.updateSetting('COURIER_PAY', policy, selectedBranchId || undefined);
      setSuccess(
        selectedBranchId
          ? t('settings.orderWorkflow.saveBranchSuccess', 'Saved as an override for this branch.')
          : t('settings.courierPay.saveSuccess')
      );
      await load();
    } catch (err: any) {
      setError(err.detail || err.message || t('settings.courierPay.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleFollowHeadOffice = async () => {
    if (!selectedBranchId) return;
    setSaving(true);
    setError(null);
    try {
      await settingsApi.clearBranchOverride('COURIER_PAY', selectedBranchId);
      setSuccess(t('settings.orderWorkflow.resetSuccess', 'Override removed. This branch follows head office again.'));
      await load();
    } catch (err: any) {
      setError(err.detail || err.message || t('settings.courierPay.saveError'));
    } finally {
      setSaving(false);
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
        heading={t('settings.courierPay.title')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.courierPay.title') },
        ]}
        action={
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={saving}>
            {t('common.refresh', 'Refresh')}
          </Button>
        }
      />

      <SettingScopeNotice
        kind="BRANCH"
        branchId={selectedBranchId}
        branchName={selectedBranch?.name}
        source={source}
        busy={saving}
        onFollowHeadOffice={handleFollowHeadOffice}
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

      <form onSubmit={handleSave}>
        <Card sx={{ p: 3, borderRadius: 2, maxWidth: 720 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
            <TwoWheelerIcon color="primary" />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {t('settings.courierPay.cardTitle')}
            </Typography>
          </Stack>

          <Stack spacing={3}>
            <TextField
              select
              fullWidth
              label={t('settings.courierPay.defaultLabel')}
              value={policy.defaultPayMode}
              onChange={(e) => setPolicy((p) => ({ ...p, defaultPayMode: e.target.value as CourierPayMode }))}
              helperText={`${t(`delivery.payRules.help_${policy.defaultPayMode}`)} ${t('settings.courierPay.defaultHelp')}`}
            >
              {COURIER_PAY_MODES.map((mode) => (
                <MenuItem key={mode} value={mode}>
                  {t(`delivery.payRules.${mode}`)}
                </MenuItem>
              ))}
            </TextField>

            <Divider />

            <FormControlLabel
              control={
                <Switch
                  checked={policy.payFailedDeliveries}
                  onChange={(e) => setPolicy((p) => ({ ...p, payFailedDeliveries: e.target.checked }))}
                />
              }
              label={
                <Box>
                  <Typography variant="subtitle2">{t('settings.courierPay.failedLabel')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('settings.courierPay.failedHelp')}
                  </Typography>
                </Box>
              }
            />

            <Alert severity="info">{t('delivery.payRules.tipsNote')}</Alert>
          </Stack>
        </Card>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3, maxWidth: 720 }}>
          <Button type="submit" variant="contained" size="large" startIcon={<SaveIcon />} disabled={saving}>
            {saving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
          </Button>
        </Box>
      </form>
    </Box>
  );
}
