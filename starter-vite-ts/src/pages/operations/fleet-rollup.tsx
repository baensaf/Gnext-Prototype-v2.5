import type { FleetRollup } from 'src/api/rollupApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  Box,
  Card,
  Chip,
  Grid,
  Stack,
  Table,
  Alert,
  Button,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  CardContent,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { fDate } from 'src/utils/format-time';
import { MoneyUtil } from 'src/utils/money.util';

import { rollupApi } from 'src/api/rollupApi';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

// ----------------------------------------------------------------------

/**
 * Head office's view of the fleet: one row per branch, and nothing to click.
 *
 * Assigning a courier, marking a drop-off and chasing a failed delivery all happen on the
 * branch's own Delivery Hub, standing in the shop the driver left from. What head office
 * needs is an answer to "which branch do I phone", so this page answers only that.
 */
export function FleetRollupPage() {
  const { t } = useTranslation();

  const [data, setData] = useState<FleetRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await rollupApi.getFleetRollup());
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('rollup.fleet.loadError', 'Failed to load the fleet roll-up'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = data?.totals;

  const tiles = [
    {
      label: t('rollup.fleet.inFlight', 'In flight'),
      value: totals ? String(totals.in_flight) : '-',
      color: 'text.primary',
    },
    {
      label: t('rollup.fleet.late', 'Running late'),
      value: totals ? String(totals.late) : '-',
      color: totals && totals.late > 0 ? 'error.main' : 'text.primary',
    },
    {
      label: t('rollup.fleet.unassigned', 'Waiting for a driver'),
      value: totals ? String(totals.unassigned) : '-',
      color: totals && totals.unassigned > 0 ? 'warning.main' : 'text.primary',
    },
    {
      label: t('rollup.fleet.couriersOnShift', 'Drivers on shift'),
      value: totals ? `${totals.couriers_on_shift} / ${totals.couriers_active}` : '-',
      color: 'text.primary',
    },
    {
      label: t('rollup.fleet.cashWithCouriers', 'Cash out with drivers'),
      value: totals ? MoneyUtil.formatCurrency(totals.cash_with_couriers) : '-',
      color: 'text.primary',
    },
  ];

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('rollup.fleet.title', 'Fleet Across Branches')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('rollup.fleet.title', 'Fleet Across Branches') },
        ]}
        action={
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>
            {t('common.refresh', 'Refresh')}
          </Button>
        }
      />

      <Alert icon={<VisibilityIcon fontSize="inherit" />} severity="info" sx={{ mb: 3 }}>
        {t(
          'rollup.fleet.readOnlyNotice',
          'Read-only. A delivery is dispatched, re-assigned and closed out at the branch it left from. This page is here so head office can see where to phone, not to act on another shop floor.'
        )}
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {tiles.map((tile) => (
          <Grid key={tile.label} size={{ xs: 6, md: 12 / 5 }}>
            <Card sx={{ borderRadius: 3, boxShadow: 2, height: '100%' }}>
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  {tile.label}
                </Typography>
                <Typography variant="h4" sx={{ mt: 0.5, color: tile.color }}>
                  {tile.value}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 0 }}>
          {loading ? (
            <Stack sx={{ py: 6, alignItems: 'center' }}>
              <CircularProgress />
            </Stack>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('rollup.branch', 'Branch')}</TableCell>
                    <TableCell align="right">{t('rollup.fleet.inFlight', 'In flight')}</TableCell>
                    <TableCell align="right">{t('rollup.fleet.unassigned', 'Waiting for a driver')}</TableCell>
                    <TableCell align="right">{t('rollup.fleet.late', 'Running late')}</TableCell>
                    <TableCell align="right">{t('rollup.fleet.deliveredToday', 'Delivered today')}</TableCell>
                    <TableCell align="right">{t('rollup.fleet.failedToday', 'Failed')}</TableCell>
                    <TableCell align="right">{t('rollup.fleet.couriersOnShift', 'Drivers on shift')}</TableCell>
                    <TableCell align="right">{t('rollup.fleet.cashWithCouriers', 'Cash out with drivers')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(data?.rows ?? []).map((row) => (
                    <TableRow key={row.branch_id} hover>
                      <TableCell>
                        <Typography variant="subtitle2">{row.branch}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {row.branch_code}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{row.in_flight}</TableCell>
                      <TableCell align="right">
                        {row.unassigned > 0 ? (
                          <Chip size="small" color="warning" label={row.unassigned} />
                        ) : (
                          row.unassigned
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {row.late > 0 ? <Chip size="small" color="error" label={row.late} /> : row.late}
                      </TableCell>
                      <TableCell align="right">{row.delivered_today}</TableCell>
                      <TableCell align="right">{row.failed_today}</TableCell>
                      <TableCell align="right">
                        {row.couriers_on_shift} / {row.couriers_active}
                      </TableCell>
                      <TableCell align="right">{MoneyUtil.formatCurrency(row.cash_with_couriers)}</TableCell>
                    </TableRow>
                  ))}

                  {!data?.rows.length && !loading && (
                    <TableRow>
                      <TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                        {t('rollup.fleet.empty', 'No selling branches to report on.')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {data && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          {t(
            'rollup.fleet.footnote',
            'Late means more than {{minutes}} minutes with a driver without arriving. Business date {{date}}.',
            { minutes: data.late_after_minutes, date: fDate(data.business_date) }
          )}
        </Typography>
      )}
    </Box>
  );
}
