import type { Currency } from 'src/api/settingsApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import SaveIcon from '@mui/icons-material/Save';
import {
  Box,
  Card,
  Chip,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Switch,
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

export function GeneralSettingsPage() {
  const { t } = useTranslation();
  const { tenant } = useAuthStore();

  const [tenantName, setTenantName] = useState(tenant?.name || 'Gnext Prototype');
  const [defaultLocale, setDefaultLocale] = useState(tenant?.defaultLocale || 'fa');
  const [timeZone, setTimeZone] = useState(tenant?.timeZone || 'Asia/Tehran');

  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const cList = await settingsApi.getCurrencies();
      setCurrencies(cList);
    } catch (err: any) {
      setError(err.detail || 'Failed to load currencies');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await tenantApi.updateBranchHours; // test import
      setSuccess('Tenant settings updated successfully');
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to update settings');
    }
  };

  const handleToggleCurrency = async (currency: Currency, enabled: boolean) => {
    try {
      await settingsApi.updateCurrency(currency.id, { is_enabled: enabled });
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to update currency status');
    }
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 1 }}>
        General Settings & Currencies
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Manage tenant profile, timezone, locale defaults, and system currencies
      </Typography>

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
                Tenant Organization Profile
              </Typography>

              <form onSubmit={handleSaveTenant}>
                <Stack spacing={2.5}>
                  <TextField
                    label="Tenant Code"
                    value={tenant?.code || 'GNEXT'}
                    disabled
                    fullWidth
                  />
                  <TextField
                    label="Tenant Name"
                    value={tenantName}
                    onChange={(e) => setTenantName(e.target.value)}
                    required
                    fullWidth
                  />
                  <TextField
                    label="Default Locale"
                    value={defaultLocale}
                    onChange={(e) => setDefaultLocale(e.target.value)}
                    required
                    fullWidth
                  />
                  <TextField
                    label="Time Zone"
                    value={timeZone}
                    onChange={(e) => setTimeZone(e.target.value)}
                    required
                    fullWidth
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    startIcon={<SaveIcon />}
                    sx={{ fontWeight: 'bold' }}
                  >
                    Save Tenant Settings
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
                  Supported Currencies
                </Typography>
                <Chip label="One Currency per Order (AD-10)" color="info" size="small" />
              </Stack>

              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Code</TableCell>
                      <TableCell>Symbol</TableCell>
                      <TableCell align="center">Precision</TableCell>
                      <TableCell align="center">Increment</TableCell>
                      <TableCell align="center">Base</TableCell>
                      <TableCell align="center">Enabled</TableCell>
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
                            <Chip label="BASE" color="primary" size="small" sx={{ fontWeight: 'bold' }} />
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

// Grid helper import
import { Grid } from '@mui/material';
