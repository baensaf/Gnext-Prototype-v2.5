
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import SaveIcon from '@mui/icons-material/Save';
import {
  Box,
  Card,
  Grid,
  Stack,
  Alert,
  Button,
  MenuItem,
  TextField,
  Typography,
  CardContent,
} from '@mui/material';

import { tenantApi } from 'src/api/tenantApi';
import { useBranchContext } from 'src/contexts/branch-context';
import { useAuthStore, useIsHeadOffice } from 'src/store/useAuthStore';

import { SettingScopeNotice } from 'src/components/setting-scope';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

export function GeneralSettingsPage() {
  const { t } = useTranslation();
  const { tenant, fetchMe } = useAuthStore();
  // The tenant profile has no branch dimension: one set for the
  // chain, and only an account with chain reach may write them.
  const isHeadOffice = useIsHeadOffice();
  const { selectedBranch } = useBranchContext();

  const [tenantName, setTenantName] = useState(tenant?.name || 'Gnext Prototype');
  const [defaultLocale, setDefaultLocale] = useState(tenant?.defaultLocale || 'fa');
  const [timeZone, setTimeZone] = useState(tenant?.timeZone || 'Asia/Tehran');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const profile = await tenantApi.getTenantProfile();
      if (profile) {
        if (profile.name) setTenantName(profile.name);
        if (profile.default_locale || profile.defaultLocale) setDefaultLocale(profile.default_locale || profile.defaultLocale);
        if (profile.time_zone || profile.timeZone) setTimeZone(profile.time_zone || profile.timeZone);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err.detail || t('settings.generalPage.loadError', 'Failed to load settings'));
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await tenantApi.updateTenantProfile({
        name: tenantName,
        default_locale: defaultLocale,
        time_zone: timeZone,
      });
      if (fetchMe) {
        await fetchMe().catch(() => {});
      }
      setSuccess(t('settings.generalPage.saveSuccess', 'Tenant settings updated successfully'));
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.detail || t('settings.generalPage.updateError', 'Failed to update settings'));
    }
  };

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('settings.generalPage.title', 'General Settings')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.generalPage.title', 'General Settings') },
        ]}
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

      <Grid container spacing={3}>
        {/* Tenant Profile Form */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
                {t('settings.generalPage.tenantProfile', 'Tenant Organization Profile')}
              </Typography>

              <form onSubmit={handleSaveTenant}>
                <Stack spacing={2.5}>
                  <TextField
                    label={t('settings.generalPage.tenantCode', 'Tenant Code')}
                    value={tenant?.code || 'GNEXT'}
                    disabled
                    fullWidth
                  />
                  <TextField
                    label={t('settings.generalPage.tenantName', 'Tenant Name')}
                    value={tenantName}
                    onChange={(e) => setTenantName(e.target.value)}
                    required
                    fullWidth
                    disabled={!isHeadOffice}
                  />
                  <TextField
                    select
                    label={t('settings.generalPage.defaultLocale', 'Default Locale')}
                    value={defaultLocale}
                    onChange={(e) => setDefaultLocale(e.target.value)}
                    disabled={!isHeadOffice}
                    required
                    fullWidth
                  >
                    <MenuItem value="fa">فارسی (Persian - fa)</MenuItem>
                    <MenuItem value="en">English (en)</MenuItem>
                  </TextField>
                  <TextField
                    select
                    label={t('settings.generalPage.timeZone', 'Time Zone')}
                    value={timeZone}
                    onChange={(e) => setTimeZone(e.target.value)}
                    disabled={!isHeadOffice}
                    required
                    fullWidth
                  >
                    <MenuItem value="Asia/Tehran">Asia/Tehran (UTC+03:30)</MenuItem>
                    <MenuItem value="UTC">UTC (GMT+00:00)</MenuItem>
                    <MenuItem value="Asia/Dubai">Asia/Dubai (UTC+04:00)</MenuItem>
                    <MenuItem value="Europe/Istanbul">Europe/Istanbul (UTC+03:00)</MenuItem>
                    <MenuItem value="Europe/London">Europe/London (UTC+00:00)</MenuItem>
                    <MenuItem value="America/New_York">America/New_York (UTC-05:00)</MenuItem>
                  </TextField>
                  <Button
                    type="submit"
                    variant="contained"
                    startIcon={<SaveIcon />}
                    disabled={!isHeadOffice}
                    sx={{ fontWeight: 'bold' }}
                  >
                    {t('settings.generalPage.saveTenant', 'Save Tenant Settings')}
                  </Button>
                </Stack>
              </form>
            </CardContent>
          </Card>
        </Grid>

      </Grid>
    </Box>
  );
}
