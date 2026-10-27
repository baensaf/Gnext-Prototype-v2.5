import type { ShiftPolicy } from 'src/api/shiftApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import {
  Box,
  Card,
  Stack,
  Alert,
  Button,
  TextField,
  Typography,
  CircularProgress,
} from '@mui/material';

import { toToman, fromToman, useCurrencyLabel } from 'src/utils/currency';

import { settingsApi } from 'src/api/settingsApi';
import { useIsHeadOffice } from 'src/store/useAuthStore';
import { useBranchContext } from 'src/contexts/branch-context';

import { SettingScopeNotice } from 'src/components/setting-scope';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

/** The server's defaults, used until head office writes a SHIFT_POLICY row. */
const SHIFT_POLICY_DEFAULTS: ShiftPolicy = {
  // HAMI branches start every drawer at zero and empty it at each close.
  defaultOpeningFloat: '0',
};

/**
 * How drawers are floated. Head office sets it once for the chain; in V1 no branch keeps its
 * own (P-24). The till reads the same value, so what is saved here is what a cashier is offered
 * when a shift opens on a register whose last close left nothing in the drawer.
 */
export function ShiftPolicySettingsPage() {
  const currencyLabel = useCurrencyLabel();
  const { t } = useTranslation();
  const isHeadOffice = useIsHeadOffice();
  const { selectedBranch } = useBranchContext();

  const [policy, setPolicy] = useState<ShiftPolicy>(SHIFT_POLICY_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scoped = await settingsApi.getScopedSettings(undefined);
      const value = scoped.groups?.SHIFT_POLICY?.value || {};
      setPolicy({
        defaultOpeningFloat: String(value.defaultOpeningFloat ?? SHIFT_POLICY_DEFAULTS.defaultOpeningFloat),
      });
    } catch (err: any) {
      setError(err.detail || err.message || t('settings.shiftPolicy.loadError', 'Failed to load the shift policy'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await settingsApi.updateSetting('SHIFT_POLICY', { defaultOpeningFloat: policy.defaultOpeningFloat || '0' });
      setSuccess(t('settings.shiftPolicy.saveSuccess', 'Shift policy saved for every branch.'));
      await load();
    } catch (err: any) {
      setError(err.detail || err.message || t('settings.shiftPolicy.saveError', 'Failed to save the shift policy'));
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
        heading={t('settings.shiftPolicy.title', 'Shift & Drawer Policy')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.shiftPolicy.title', 'Shift & Drawer Policy') },
        ]}
        action={
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={saving}>
            {t('common.refresh', 'Refresh')}
          </Button>
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

      <form onSubmit={handleSave}>
        <Card sx={{ p: 3, maxWidth: 720 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
            <PointOfSaleIcon color="success" />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {t('settings.shiftPolicy.cardTitle', 'Opening a drawer')}
            </Typography>
          </Stack>

          <Stack spacing={3}>
            <TextField
              fullWidth
              type="number"
              disabled={!isHeadOffice}
              label={t('settings.shiftPolicy.floatLabel', 'Default opening float ({{currency}})', { currency: currencyLabel })}
              helperText={t(
                'settings.shiftPolicy.floatHelp',
                'Offered when a shift is opened. The cashier still enters what they actually counted into the drawer.'
              )}
              value={toToman(policy.defaultOpeningFloat)}
              onChange={(e) => setPolicy((p) => ({ ...p, defaultOpeningFloat: fromToman(e.target.value) }))}
              slotProps={{ htmlInput: { min: 0, dir: 'ltr' } }}
            />
          </Stack>
        </Card>

        {isHeadOffice && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3, maxWidth: 720 }}>
            <Button type="submit" variant="contained" size="large" startIcon={<SaveIcon />} disabled={saving}>
              {saving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
            </Button>
          </Box>
        )}
      </form>
    </Box>
  );
}
