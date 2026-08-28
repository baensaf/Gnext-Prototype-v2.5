import type { Currency } from 'src/api/settingsApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import SaveIcon from '@mui/icons-material/Save';
import {
  Box,
  Card,
  Grid,
  Chip,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Switch,
  MenuItem,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  CardContent,
  TableContainer,
} from '@mui/material';

import { tenantApi } from 'src/api/tenantApi';
import { settingsApi } from 'src/api/settingsApi';
import { useAuthStore } from 'src/store/useAuthStore';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

export function GeneralSettingsPage() {
  const { t } = useTranslation();
  const { tenant, fetchMe } = useAuthStore();

  const [tenantName, setTenantName] = useState(tenant?.name || 'Gnext Prototype');
  const [defaultLocale, setDefaultLocale] = useState(tenant?.defaultLocale || 'fa');
  const [timeZone, setTimeZone] = useState(tenant?.timeZone || 'Asia/Tehran');

  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [cList, profile] = await Promise.all([
        settingsApi.getCurrencies(),
        tenantApi.getTenantProfile(),
      ]);
      setCurrencies(cList);
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

  const handleToggleCurrency = async (currency: Currency, enabled: boolean) => {
    try {
      await settingsApi.updateCurrency(currency.id, { is_enabled: enabled });
      loadData();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.detail || t('settings.generalPage.currencyStatusError', 'Failed to update currency status'));
    }
  };

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('settings.generalPage.title', 'General Settings & Currencies')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.generalPage.title', 'General Settings') },
        ]}
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

      <Grid container spacing={3}>
        {/* Tenant Profile Form */}
        <Grid size={{ xs: 12, md: 5 }}>
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
                  />
                  <TextField
                    select
                    label={t('settings.generalPage.defaultLocale', 'Default Locale')}
                    value={defaultLocale}
                    onChange={(e) => setDefaultLocale(e.target.value)}
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
                    sx={{ fontWeight: 'bold' }}
                  >
                    {t('settings.generalPage.saveTenant', 'Save Tenant Settings')}
                  </Button>
                </Stack>
              </form>
            </CardContent>
          </Card>
        </Grid>

        {/* Currencies Management */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
            <CardContent>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('settings.generalPage.supportedCurrencies', 'Supported Currencies')}
                </Typography>
                <Chip label={t('settings.generalPage.oneCurrencyNotice', 'One Currency per Order (AD-10)')} color="info" size="small" />
              </Stack>

              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('settings.generalPage.colCode', 'Code')}</TableCell>
                      <TableCell>{t('settings.generalPage.colSymbol', 'Symbol')}</TableCell>
                      <TableCell align="center">{t('settings.generalPage.colPrecision', 'Precision')}</TableCell>
                      <TableCell align="center">{t('settings.generalPage.colIncrement', 'Increment')}</TableCell>
                      <TableCell align="center">{t('settings.generalPage.colBase', 'Base')}</TableCell>
                      <TableCell align="center">{t('settings.generalPage.colEnabled', 'Enabled')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {currencies.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell><code>{c.code}</code></TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>{c.symbol}</TableCell>
                        <TableCell align="center">{c.decimal_precision}</TableCell>
                        <TableCell align="center">{c.rounding_increment}</TableCell>
                        <TableCell align="center">
                          {c.is_base ? (
                            <Chip label={t('settings.generalPage.baseBadge', 'BASE')} color="primary" size="small" sx={{ fontWeight: 'bold' }} />
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell align="center">
                          <Switch
                            checked={c.is_enabled}
                            disabled={c.is_base}
                            onChange={(e) => handleToggleCurrency(c, e.target.checked)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
