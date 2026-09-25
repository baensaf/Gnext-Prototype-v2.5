import type { StopReport } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import {
  Box,
  Card,
  Chip,
  Grid,
  Stack,
  Table,
  Alert,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  CardContent,
  TableContainer,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';
import { useCurrencyCode } from 'src/utils/currency';

import { catalogApi } from 'src/api/catalogApi';
import { useBranchContext } from 'src/contexts/branch-context';

import { CalendarDateField } from 'src/components/calendar-date-field';

/**
 * The 86 report: which items were off, how often and for how long, who took them off and who
 * put them back, and the sales the register and kiosk refused meanwhile (valued at base price).
 */
export function StopReportPage() {
  const currency = useCurrencyCode();
  const { t } = useTranslation();
  const { selectedBranchId } = useBranchContext();

  // Empty until the first report answers with its default range: the last 7 business days.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<StopReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await catalogApi.getStopReport({ from: from || undefined, to: to || undefined, branchId: selectedBranchId || undefined });
      setReport(next);
      if (!from) setFrom(next.from);
      if (!to) setTo(next.to);
      setError(null);
    } catch (err: any) {
      setError(err?.detail || t('catalog.stopReport.loadFailed'));
    }
  }, [from, to, selectedBranchId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const endedLabel = (s: StopReport['stops'][number]) => {
    if (s.ended === 'RESUMED') return t('catalog.stopReport.endedResumed', { name: s.resumed_by || '—' });
    if (s.ended === 'EXPIRED') return t('catalog.stopReport.endedExpired');
    if (s.ended === 'CHANGED') return t('catalog.stopReport.endedChanged');
    return t('catalog.stopReport.endedOngoing');
  };

  const stat = (label: string, value: React.ReactNode) => (
    <Grid size={{ xs: 6, md: 3 }}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h5" dir="ltr" sx={{ textAlign: 'start' }}>
            {value}
          </Typography>
        </CardContent>
      </Card>
    </Grid>
  );

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
        {t('catalog.stopReport.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('catalog.stopReport.subtitle')}
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <CalendarDateField size="small" label={t('catalog.stopReport.from')} value={from} onChange={(e) => setFrom(e.target.value)} />
        <CalendarDateField size="small" label={t('catalog.stopReport.to')} value={to} onChange={(e) => setTo(e.target.value)} />
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {report && (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {stat(t('catalog.stopReport.stops'), report.totals.stops)}
            {stat(t('catalog.stopReport.hoursOff'), report.totals.hours)}
            {stat(t('catalog.stopReport.refused'), report.totals.refused)}
            {stat(t('catalog.stopReport.lost'), `${MoneyUtil.formatCurrency(report.totals.estimated_lost)} ${currency}`)}
          </Grid>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>
                {t('catalog.stopReport.byItem')}
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('catalog.stopReport.item')}</TableCell>
                      <TableCell align="center">{t('catalog.stopReport.stops')}</TableCell>
                      <TableCell align="center">{t('catalog.stopReport.hoursOff')}</TableCell>
                      <TableCell align="center">{t('catalog.stopReport.refused')}</TableCell>
                      <TableCell align="right">{t('catalog.stopReport.lost')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.items.map((i) => (
                      <TableRow key={`${i.kind}:${i.name}`}>
                        <TableCell>
                          {i.name}
                          {i.kind === 'ADDON' && <Chip size="small" variant="outlined" label={t('catalog.stopReport.addon')} sx={{ ms: 1 }} />}
                        </TableCell>
                        <TableCell align="center">{i.stops}</TableCell>
                        <TableCell align="center">{i.hours}</TableCell>
                        <TableCell align="center">{i.refused ? `${i.refused} (${i.refused_quantity})` : '—'}</TableCell>
                        <TableCell align="right">
                          <span dir="ltr">{MoneyUtil.isZero(i.estimated_lost) ? '—' : `${MoneyUtil.formatCurrency(i.estimated_lost)} ${currency}`}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                    {report.items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          {t('catalog.stopReport.empty')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              <Typography variant="caption" color="text.secondary">
                {t('catalog.stopReport.lostNote')}
              </Typography>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>
                {t('catalog.stopReport.log')}
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('catalog.stopReport.offAt')}</TableCell>
                      <TableCell>{t('catalog.stopReport.item')}</TableCell>
                      <TableCell>{t('catalog.stopReport.where')}</TableCell>
                      <TableCell>{t('catalog.stopReport.reason')}</TableCell>
                      <TableCell>{t('catalog.stopReport.by')}</TableCell>
                      <TableCell>{t('catalog.stopReport.ended')}</TableCell>
                      <TableCell align="center">{t('catalog.stopReport.hoursOff')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.stops.map((s, index) => (
                      <TableRow key={`${s.from}:${s.item}:${index}`}>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{fDateTime(s.from)}</TableCell>
                        <TableCell>{s.item}</TableCell>
                        <TableCell>
                          {s.chain_wide ? t('catalog.stopReport.allBranches') : s.branch}
                          {s.channel && <Chip size="small" variant="outlined" color="warning" label={s.channel} sx={{ ms: 1 }} />}
                        </TableCell>
                        <TableCell>{s.reason || '—'}</TableCell>
                        <TableCell>
                          {s.by || '—'}
                          {s.approver && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {t('catalog.stopReport.approvedBy', { name: s.approver })}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          {endedLabel(s)}
                          {s.to && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {fDateTime(s.to)}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="center">{s.hours}</TableCell>
                      </TableRow>
                    ))}
                    {report.stops.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          {t('catalog.stopReport.empty')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </>
      )}
    </Box>
  );
}
