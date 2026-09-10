import type { ShiftRollup } from 'src/api/rollupApi';

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
  TextField,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  CardContent,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';

import { rollupApi } from 'src/api/rollupApi';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

// ----------------------------------------------------------------------

/** Local calendar date, not the UTC one: the same rule the server stamps shifts with. */
function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA');
}

/**
 * Head office's view of the tills: one row per branch for one operating day, read-only.
 *
 * Opening a drawer, paying in and counting down at close are all done standing at the
 * register, and stay on the branch's own Shifts screen. The column that earns this page is
 * "left open": a drawer still open on a day that has already ended is invisible from
 * inside the branch that left it open, and nobody else was looking.
 */
export function ShiftRollupPage() {
  const { t } = useTranslation();

  const [businessDate, setBusinessDate] = useState<string>(todayLocal());
  const [data, setData] = useState<ShiftRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await rollupApi.getShiftRollup(businessDate));
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('rollup.shifts.loadError', 'Failed to load the shift roll-up'));
    } finally {
      setLoading(false);
    }
  }, [businessDate, t]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = data?.totals;

  const tiles = [
    {
      label: t('rollup.shifts.open', 'Drawers open'),
      value: totals ? String(totals.open) : '-',
      color: 'text.primary',
    },
    {
      label: t('rollup.shifts.staleOpen', 'Left open from an earlier day'),
      value: totals ? String(totals.stale_open) : '-',
      color: totals && totals.stale_open > 0 ? 'error.main' : 'text.primary',
    },
    {
      label: t('rollup.shifts.closed', 'Closed and counted'),
      value: totals ? String(totals.closed) : '-',
      color: 'text.primary',
    },
    {
      label: t('rollup.shifts.notTrading', 'Branches with no till open'),
      value: totals ? `${totals.branches_not_trading} / ${totals.branch_count}` : '-',
      color: totals && totals.branches_not_trading > 0 ? 'warning.main' : 'text.primary',
    },
    {
      label: t('rollup.shifts.variance', 'Net over / short'),
      value: totals ? MoneyUtil.formatCurrency(totals.variance) : '-',
      color: totals && !MoneyUtil.isZero(totals.variance) ? 'error.main' : 'text.primary',
    },
  ];

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('rollup.shifts.title', 'Shifts Across Branches')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('rollup.shifts.title', 'Shifts Across Branches') },
        ]}
        action={
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <TextField
              size="small"
              type="date"
              label={t('rollup.shifts.businessDate', 'Business date')}
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>
              {t('common.refresh', 'Refresh')}
            </Button>
          </Stack>
        }
      />

      <Alert icon={<VisibilityIcon fontSize="inherit" />} severity="info" sx={{ mb: 3 }}>
        {t(
          'rollup.shifts.readOnlyNotice',
          'Read-only. A drawer is opened, paid into and counted down at the register it belongs to. This page is here so head office can see which branch to ask about, not to close another shop till.'
        )}
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!!totals?.stale_open && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {t(
            'rollup.shifts.staleWarning',
            '{{count}} drawer(s) are still open on a business date that has already ended. Those tills keep accumulating against a closed day until somebody at the branch counts them down.',
            { count: totals.stale_open }
          )}
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
                    <TableCell align="right">{t('rollup.shifts.open', 'Drawers open')}</TableCell>
                    <TableCell align="right">{t('rollup.shifts.closingReview', 'In closing review')}</TableCell>
                    <TableCell align="right">{t('rollup.shifts.closed', 'Closed and counted')}</TableCell>
                    <TableCell align="right">{t('rollup.shifts.staleOpen', 'Left open from an earlier day')}</TableCell>
                    <TableCell align="right">{t('rollup.shifts.expectedCash', 'Expected cash')}</TableCell>
                    <TableCell align="right">{t('rollup.shifts.countedCash', 'Counted cash')}</TableCell>
                    <TableCell align="right">{t('rollup.shifts.variance', 'Net over / short')}</TableCell>
                    <TableCell align="right">{t('rollup.shifts.worstVariance', 'Worst drawer')}</TableCell>
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
                      <TableCell align="right">{row.open}</TableCell>
                      <TableCell align="right">{row.closing_review}</TableCell>
                      <TableCell align="right">{row.closed}</TableCell>
                      <TableCell align="right">
                        {row.stale_open > 0 ? (
                          <Chip size="small" color="error" label={row.stale_open} />
                        ) : (
                          row.stale_open
                        )}
                      </TableCell>
                      <TableCell align="right">{MoneyUtil.formatCurrency(row.expected_cash)}</TableCell>
                      <TableCell align="right">{MoneyUtil.formatCurrency(row.counted_cash)}</TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: MoneyUtil.isZero(row.variance) ? 'inherit' : 'error.main' }}
                      >
                        {MoneyUtil.formatCurrency(row.variance)}
                      </TableCell>
                      <TableCell align="right">{MoneyUtil.formatCurrency(row.worst_variance)}</TableCell>
                    </TableRow>
                  ))}

                  {!data?.rows.length && !loading && (
                    <TableRow>
                      <TableCell colSpan={9} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                        {t('rollup.shifts.empty', 'No selling branches to report on.')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        {t(
          'rollup.shifts.footnote',
          'Over / short counts only drawers that have actually been counted, so a branch still trading reads as zero rather than as clean. "Left open from an earlier day" is not filtered by the date above.'
        )}
      </Typography>
    </Box>
  );
}
