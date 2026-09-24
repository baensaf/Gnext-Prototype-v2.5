import type { CurrentBusinessDay } from 'src/api/businessDayApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import NightsStayIcon from '@mui/icons-material/NightsStay';
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

import { useCalendarStore } from 'src/utils/calendar';
import { fDate, fDateTime } from 'src/utils/format-time';

import { settingsApi } from 'src/api/settingsApi';
import { businessDayApi } from 'src/api/businessDayApi';
import { useBranchContext } from 'src/contexts/branch-context';

import { SettingScopeNotice } from 'src/components/setting-scope';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

type BusinessDaySetting = { cutoff: string; opensAt: string; closesAt: string; autoClose: boolean };

/** The server's defaults, used until head office writes a BUSINESS_DAY row. */
const DEFAULTS: BusinessDaySetting = { cutoff: '04:00', opensAt: '08:00', closesAt: '04:00', autoClose: true };

const hhmm = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;

/**
 * When the business day turns over and the shop's hours. A restaurant open 08:00 to 04:00 keeps
 * the night's trade on the day it opened: a sale at 01:30 belongs to the day before, and the new
 * day starts at the cutoff. Every channel, payment, refund, call number and report follows it.
 * Head office sets it for the chain; a branch may keep its own. A change applies from now on and
 * never re-dates what is already recorded.
 */
export function BusinessDaySettingsPage() {
  const { t } = useTranslation();
  const { selectedBranchId, selectedBranch } = useBranchContext();
  const applyBusinessDay = useCalendarStore((state) => state.setBusinessDay);

  const [value, setValue] = useState<BusinessDaySetting>(DEFAULTS);
  const [source, setSource] = useState<'BRANCH' | 'ORG'>('ORG');
  const [current, setCurrent] = useState<CurrentBusinessDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [scoped, day] = await Promise.all([
        settingsApi.getScopedSettings(selectedBranchId || undefined),
        businessDayApi.getCurrent(selectedBranchId || undefined).catch(() => null),
      ]);
      const group = scoped.groups?.BUSINESS_DAY;
      const v = group?.value || {};
      setValue({
        cutoff: hhmm(v.cutoff, DEFAULTS.cutoff),
        opensAt: hhmm(v.opensAt, DEFAULTS.opensAt),
        closesAt: hhmm(v.closesAt, hhmm(v.cutoff, DEFAULTS.closesAt)),
        autoClose: typeof v.autoClose === 'boolean' ? v.autoClose : DEFAULTS.autoClose,
      });
      setSource(group?.source || 'ORG');
      setCurrent(day);
    } catch (err: any) {
      setError(err.detail || err.message || t('settings.businessDay.loadError', 'Failed to load the business day settings'));
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
      await settingsApi.updateSetting('BUSINESS_DAY', value, selectedBranchId || undefined);
      if (!selectedBranchId) applyBusinessDay(value);
      setSuccess(
        selectedBranchId
          ? t('settings.orderWorkflow.saveBranchSuccess', 'Saved as an override for this branch.')
          : t('settings.businessDay.saveSuccess', 'Business day saved for every branch that follows head office.')
      );
      await load();
    } catch (err: any) {
      setError(err.detail || err.message || t('settings.businessDay.saveError', 'Failed to save the business day settings'));
    } finally {
      setSaving(false);
    }
  };

  const handleFollowHeadOffice = async () => {
    if (!selectedBranchId) return;
    setSaving(true);
    setError(null);
    try {
      await settingsApi.clearBranchOverride('BUSINESS_DAY', selectedBranchId);
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

  const timeField = (key: 'cutoff' | 'opensAt' | 'closesAt', label: string, help: string) => (
    <TextField
      fullWidth
      type="time"
      label={label}
      helperText={help}
      value={value[key]}
      onChange={(e) => setValue((v) => ({ ...v, [key]: e.target.value }))}
      slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 60, dir: 'ltr' } }}
    />
  );

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('settings.businessDay.title', 'Business Day')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.businessDay.title', 'Business Day') },
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

      {current && (
        <Alert severity="info" sx={{ mb: 3, maxWidth: 720 }}>
          {t('settings.businessDay.now', 'Now: business day {{date}}, which ends at {{ends}} ({{zone}}).', {
            date: fDate(current.businessDate),
            ends: fDateTime(current.endsAt),
            zone: current.timeZone,
          })}
        </Alert>
      )}

      <form onSubmit={handleSave}>
        <Card sx={{ p: 3, borderRadius: 2, maxWidth: 720 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
            <NightsStayIcon color="primary" />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {t('settings.businessDay.cardTitle', 'When the day turns over')}
            </Typography>
          </Stack>

          <Stack spacing={3}>
            {timeField(
              'cutoff',
              t('settings.businessDay.cutoffLabel', 'Business day cutoff'),
              t(
                'settings.businessDay.cutoffHelp',
                'The new business day starts here, on the branch’s own clock. With 04:00, a sale at 01:30 belongs to the day before and one at 04:00 to the new day. Orders, payments, refunds, call numbers and reports all follow it.'
              )
            )}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {timeField('opensAt', t('settings.businessDay.opensLabel', 'Opens at'), t('settings.businessDay.opensHelp', 'When the shop opens for the day.'))}
              {timeField(
                'closesAt',
                t('settings.businessDay.closesLabel', 'Closes at'),
                t('settings.businessDay.closesHelp', 'May run past midnight, up to the cutoff.')
              )}
            </Stack>

            <Divider />

            <FormControlLabel
              control={<Switch checked={value.autoClose} onChange={(e) => setValue((v) => ({ ...v, autoClose: e.target.checked }))} />}
              label={
                <Box>
                  <Typography variant="subtitle2">{t('settings.businessDay.autoCloseLabel', 'Close the day automatically')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t(
                      'settings.businessDay.autoCloseHelp',
                      'After the cutoff, the previous business day closes by itself once every shift on it has been counted and closed. Nobody has to close it for the date to move on or for the next shift to open.'
                    )}
                  </Typography>
                </Box>
              }
            />

            <Alert severity="warning" variant="outlined">
              {t(
                'settings.businessDay.changeNote',
                'A change applies from the moment it is saved. Nothing already recorded is re-dated, and the day in progress never moves back to yesterday.'
              )}
            </Alert>
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
