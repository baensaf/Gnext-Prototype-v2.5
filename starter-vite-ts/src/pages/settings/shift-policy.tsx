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
  Switch,
  Button,
  Divider,
  TextField,
  Typography,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';

import { useCurrencyLabel } from 'src/utils/currency';

import { settingsApi } from 'src/api/settingsApi';
import { useBranchContext } from 'src/contexts/branch-context';

import { SettingScopeNotice } from 'src/components/setting-scope';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

/** The server's defaults, used until head office writes a SHIFT_POLICY row. */
const SHIFT_POLICY_DEFAULTS: ShiftPolicy = {
  defaultOpeningFloat: '5000000',
  varianceTolerance: '100000',
  blindClose: true,
};

/**
 * How drawers are floated and counted. Head office sets it for the chain; a branch may keep
 * its own, like the order-editing windows. The count and the till read the same value, so
 * what is saved here is what a cashier meets at close.
 */
export function ShiftPolicySettingsPage() {
  const currencyLabel = useCurrencyLabel();
  const { t } = useTranslation();
  const { selectedBranchId, selectedBranch } = useBranchContext();

  const [policy, setPolicy] = useState<ShiftPolicy>(SHIFT_POLICY_DEFAULTS);
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
      const group = scoped.groups?.SHIFT_POLICY;
      const value = group?.value || {};
      setPolicy({
        defaultOpeningFloat: String(value.defaultOpeningFloat ?? SHIFT_POLICY_DEFAULTS.defaultOpeningFloat),
        varianceTolerance: String(value.varianceTolerance ?? SHIFT_POLICY_DEFAULTS.varianceTolerance),
        blindClose: typeof value.blindClose === 'boolean' ? value.blindClose : SHIFT_POLICY_DEFAULTS.blindClose,
      });
      setSource(group?.source || 'ORG');
    } catch (err: any) {
      setError(err.detail || err.message || t('settings.shiftPolicy.loadError', 'Failed to load the shift policy'));
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
      await settingsApi.updateSetting(
        'SHIFT_POLICY',
        {
          defaultOpeningFloat: policy.defaultOpeningFloat || '0',
          varianceTolerance: policy.varianceTolerance || '0',
          blindClose: policy.blindClose,
        },
        selectedBranchId || undefined
      );
      setSuccess(
        selectedBranchId
          ? t('settings.orderWorkflow.saveBranchSuccess', 'Saved as an override for this branch.')
          : t('settings.shiftPolicy.saveSuccess', 'Shift policy saved for every branch that follows head office.')
      );
      await load();
    } catch (err: any) {
      setError(err.detail || err.message || t('settings.shiftPolicy.saveError', 'Failed to save the shift policy'));
    } finally {
      setSaving(false);
    }
  };

  const handleFollowHeadOffice = async () => {
    if (!selectedBranchId) return;
    setSaving(true);
    setError(null);
    try {
      await settingsApi.clearBranchOverride('SHIFT_POLICY', selectedBranchId);
      setSuccess(t('settings.orderWorkflow.resetSuccess', 'Override removed. This branch follows head office again.'));
      await load();
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to remove the branch override');
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
            <PointOfSaleIcon color="success" />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {t('settings.shiftPolicy.cardTitle', 'Opening and counting a drawer')}
            </Typography>
          </Stack>

          <Stack spacing={3}>
            <TextField
              fullWidth
              type="number"
              label={t('settings.shiftPolicy.floatLabel', 'Default opening float ({{currency}})', { currency: currencyLabel })}
              helperText={t(
                'settings.shiftPolicy.floatHelp',
                'Offered when a shift is opened. The cashier still enters what they actually counted into the drawer.'
              )}
              value={policy.defaultOpeningFloat}
              onChange={(e) => setPolicy((p) => ({ ...p, defaultOpeningFloat: e.target.value }))}
              slotProps={{ htmlInput: { min: 0, dir: 'ltr' } }}
            />

            <TextField
              fullWidth
              type="number"
              label={t('settings.shiftPolicy.toleranceLabel', 'Variance tolerance ({{currency}})', { currency: currencyLabel })}
              helperText={t(
                'settings.shiftPolicy.toleranceHelp',
                'The largest over or short a drawer may close on without a manager PIN. Any difference at all still needs a reason. Zero sends every difference to a manager.'
              )}
              value={policy.varianceTolerance}
              onChange={(e) => setPolicy((p) => ({ ...p, varianceTolerance: e.target.value }))}
              slotProps={{ htmlInput: { min: 0, dir: 'ltr' } }}
            />

            <Divider />

            <FormControlLabel
              control={
                <Switch
                  checked={policy.blindClose}
                  onChange={(e) => setPolicy((p) => ({ ...p, blindClose: e.target.checked }))}
                />
              }
              label={
                <Box>
                  <Typography variant="subtitle2">{t('settings.shiftPolicy.blindLabel', 'Blind count at close')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t(
                      'settings.shiftPolicy.blindHelp',
                      'A cashier counting down a drawer is not shown what it should hold, or the day’s cash sales, until they have entered their count. Managers always see it.'
                    )}
                  </Typography>
                </Box>
              }
            />
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
