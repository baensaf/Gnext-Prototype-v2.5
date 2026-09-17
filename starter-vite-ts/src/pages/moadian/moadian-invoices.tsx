import type { TaxInvoice, MoadianSettings, TaxInvoiceStatus } from 'src/api/moadianApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import SaveIcon from '@mui/icons-material/Save';
import ReplayIcon from '@mui/icons-material/Replay';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  Box,
  Card,
  Chip,
  Grid,
  Link,
  Stack,
  Table,
  Alert,
  Button,
  Dialog,
  Switch,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  IconButton,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';

import { RouterLink } from 'src/routes/components';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';

import { settingsApi } from 'src/api/settingsApi';
import { useIsHeadOffice } from 'src/store/useAuthStore';
import { useBranchContext } from 'src/contexts/branch-context';
import { moadianApi, MOADIAN_SETTINGS_DEFAULTS } from 'src/api/moadianApi';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import { TAX_STATUS_COLOR, useMoadianLabels } from 'src/components/moadian/moadian-order-panel';

const STATUSES: TaxInvoiceStatus[] = ['QUEUED', 'PENDING', 'SUCCESS', 'FAILED'];

/** Days the law allows between the sale and sending its invoice. */
const SEND_DEADLINE_DAYS = 12;

function DeadlineCell({ invoice, now }: { invoice: TaxInvoice; now: number }) {
  const { t } = useTranslation();
  if (invoice.status === 'SUCCESS') {
    return (
      <Typography variant="caption" color="text.secondary">
        {t('moadian.deadline.met', 'Met')}
      </Typography>
    );
  }
  const left = SEND_DEADLINE_DAYS - Math.floor((now - new Date(invoice.issued_at).getTime()) / 86400000);
  if (left < 0) return <Chip size="small" color="error" label={t('moadian.deadline.overdue', 'Overdue')} />;
  return <Typography variant="caption">{t('moadian.deadline.left', { defaultValue: '{{count}} days left', count: left })}</Typography>;
}

/**
 * Moadian e-invoicing, simulated: head office's connection settings, and every invoice the
 * chain has issued with where it stands at the (simulated) tax office.
 */
export function MoadianInvoicesPage() {
  const { t } = useTranslation();
  const labels = useMoadianLabels();
  const { selectedBranchId, isHeadOffice: atHeadOffice } = useBranchContext();
  const isHeadOffice = useIsHeadOffice();
  // One taxpayer, one connection: head office sets it; a branch sees its own invoices.
  const canConfigure = isHeadOffice && atHeadOffice;

  const [settings, setSettings] = useState<MoadianSettings>(MOADIAN_SETTINGS_DEFAULTS);
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [counts, setCounts] = useState<Partial<Record<TaxInvoiceStatus, number>>>({});
  const [statusFilter, setStatusFilter] = useState<TaxInvoiceStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewing, setViewing] = useState<TaxInvoice | null>(null);
  // Deadlines count from when the list was fetched, not from each render.
  const [fetchedAt, setFetchedAt] = useState(0);

  const loadInvoices = useCallback(async () => {
    const res = await moadianApi.list({ status: statusFilter || undefined, branchId: selectedBranchId || undefined });
    setFetchedAt(Date.now());
    setInvoices(res.items);
    setCounts(res.counts);
  }, [statusFilter, selectedBranchId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const scoped = await settingsApi.getScopedSettings();
      setSettings({ ...MOADIAN_SETTINGS_DEFAULTS, ...(scoped.groups?.MOADIAN?.value || {}) });
      await loadInvoices();
    } catch (err: any) {
      setError(err.detail || err.message || t('moadian.loadError', 'Failed to load Moadian e-invoices'));
    } finally {
      setLoading(false);
    }
  }, [loadInvoices, t]);

  useEffect(() => {
    load();
  }, [load]);

  // The simulated tax office answers within seconds, so keep the list current.
  useEffect(() => {
    const timer = setInterval(() => {
      loadInvoices().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [loadInvoices]);

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
      await loadInvoices();
    } catch (err: any) {
      setError(err.detail || err.message || t('moadian.actionError', 'The action failed'));
    } finally {
      setBusy(false);
    }
  };

  const setField = <K extends keyof MoadianSettings>(key: K, value: MoadianSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  const handleSave = () =>
    run(async () => {
      const rate = Number(settings.rejectionRate) || 0;
      const value: MoadianSettings = {
        ...settings,
        memoryId: settings.memoryId.trim().toUpperCase(),
        economicCode: settings.economicCode.trim(),
        rejectionRate: Math.min(Math.max(rate, 0), 100),
        // Invoicing starts from the moment it is switched on, not back through history.
        enabledAt: settings.enabled ? settings.enabledAt || new Date().toISOString() : settings.enabledAt,
      };
      await settingsApi.updateSetting('MOADIAN', value);
      setSettings(value);
      return t('moadian.settings.saved', 'Moadian settings saved.');
    });

  const handleProcess = () =>
    run(async () => {
      const result = await moadianApi.process();
      return t('moadian.processed', { defaultValue: 'Queued {{queued}}, sent {{sent}}, answered {{answered}}.', ...result });
    });

  const handleRetry = (invoiceId: string) =>
    run(async () => {
      await moadianApi.retry(invoiceId);
      return t('moadian.retried', 'Invoice queued to be sent again with the same tax ID.');
    });

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const total = STATUSES.reduce((sum, status) => sum + (counts[status] ?? 0), 0);

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('moadian.title', 'Moadian e-invoices')}
        links={[{ name: t('nav.home', 'Home'), href: '/app/dashboard' }, { name: t('moadian.title', 'Moadian e-invoices') }]}
        action={
          <Stack sx={{ flexDirection: 'row', gap: 1 }}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => run(async () => undefined)} disabled={busy}>
              {t('common.refresh', 'Refresh')}
            </Button>
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={handleProcess}
              disabled={busy || !settings.enabled}
            >
              {t('moadian.processNow', 'Send & collect answers now')}
            </Button>
          </Stack>
        }
      />

      <Alert severity="info" sx={{ mb: 3 }}>
        {t(
          'moadian.simulationNotice',
          'Simulation: invoices are built the way the tax office expects (22-character tax ID, type-2 consumer invoice), but nothing leaves this system. The simulated tax office answers about 8 seconds after an invoice is sent.'
        )}
      </Alert>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ p: 3 }}>
            <Typography variant="h6">{t('moadian.settings.title', 'Connection settings')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {canConfigure
                ? t('moadian.settings.hint', 'Set once at head office for the whole chain.')
                : t('moadian.settings.readOnly', 'Head office manages these settings.')}
            </Typography>
            <Stack spacing={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.enabled}
                    disabled={!canConfigure}
                    onChange={(e) => {
                      const { checked } = e.target;
                      setSettings((current) => ({
                        ...current,
                        enabled: checked,
                        enabledAt: checked && !current.enabled ? null : current.enabledAt,
                      }));
                    }}
                  />
                }
                label={t('moadian.settings.enabled', 'Issue e-invoices')}
              />
              <TextField
                size="small"
                label={t('moadian.settings.memoryId', 'Tax memory ID')}
                value={settings.memoryId}
                disabled={!canConfigure}
                onChange={(e) => setField('memoryId', e.target.value.toUpperCase())}
                helperText={t('moadian.settings.memoryIdHelp', '6 letters or digits, e.g. A1B2C3')}
                slotProps={{ htmlInput: { maxLength: 6, dir: 'ltr' } }}
              />
              <TextField
                size="small"
                label={t('moadian.settings.economicCode', 'Seller economic code')}
                value={settings.economicCode}
                disabled={!canConfigure}
                onChange={(e) => setField('economicCode', e.target.value)}
                slotProps={{ htmlInput: { dir: 'ltr' } }}
              />
              <TextField
                size="small"
                label={t('moadian.settings.sstid', 'Goods/service ID')}
                value={settings.defaultSstid}
                disabled={!canConfigure}
                onChange={(e) => setField('defaultSstid', e.target.value)}
                helperText={t('moadian.settings.sstidHelp', '13-digit ID used on every invoice line')}
                slotProps={{ htmlInput: { dir: 'ltr' } }}
              />
              <TextField
                size="small"
                label={t('moadian.settings.unitCode', 'Unit of measure code')}
                value={settings.unitCode}
                disabled={!canConfigure}
                onChange={(e) => setField('unitCode', e.target.value)}
                slotProps={{ htmlInput: { dir: 'ltr' } }}
              />
              <TextField
                size="small"
                type="number"
                label={t('moadian.settings.rejectionRate', 'Simulated rejection rate (%)')}
                value={settings.rejectionRate}
                disabled={!canConfigure}
                onChange={(e) => setField('rejectionRate', Number(e.target.value))}
                helperText={t('moadian.settings.rejectionRateHelp', 'Set 100 to rehearse a rejected invoice.')}
                slotProps={{ htmlInput: { min: 0, max: 100 } }}
              />
              {settings.enabled && settings.enabledAt && (
                <Typography variant="caption" color="text.secondary">
                  {t('moadian.settings.since', {
                    defaultValue: 'Orders completed since {{date}} are invoiced automatically.',
                    date: fDateTime(settings.enabledAt),
                  })}
                </Typography>
              )}
              <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={!canConfigure || busy}>
                {t('common.save', 'Save')}
              </Button>
            </Stack>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }}>
          <Card sx={{ p: 3 }}>
            <Stack sx={{ flexDirection: 'row', flexWrap: 'wrap', gap: 1, mb: 2 }}>
              <Chip
                label={`${t('moadian.all', 'All')} (${total})`}
                color={statusFilter === '' ? 'primary' : 'default'}
                variant={statusFilter === '' ? 'filled' : 'outlined'}
                onClick={() => setStatusFilter('')}
              />
              {STATUSES.map((status) => (
                <Chip
                  key={status}
                  label={`${labels.status(status)} (${counts[status] ?? 0})`}
                  color={statusFilter === status ? TAX_STATUS_COLOR[status] : 'default'}
                  variant={statusFilter === status ? 'filled' : 'outlined'}
                  onClick={() => setStatusFilter(status)}
                />
              ))}
            </Stack>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('moadian.col.taxId', 'Tax ID')}</TableCell>
                    <TableCell>{t('moadian.col.order', 'Order')}</TableCell>
                    <TableCell>{t('moadian.col.subject', 'Type')}</TableCell>
                    <TableCell align="right">{t('moadian.col.total', 'Total')}</TableCell>
                    <TableCell>{t('moadian.col.status', 'Status')}</TableCell>
                    <TableCell>{t('moadian.col.deadline', 'Deadline')}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id} hover>
                      <TableCell dir="ltr" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {inv.tax_id}
                      </TableCell>
                      <TableCell>
                        <Link component={RouterLink} href={`/app/orders/${inv.order_id}`}>
                          {inv.order_number || '—'}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label={labels.subject(inv.subject)} />
                      </TableCell>
                      <TableCell align="right" dir="ltr" sx={{ whiteSpace: 'nowrap' }}>
                        {MoneyUtil.formatCurrency(inv.total_amount)} IRR
                      </TableCell>
                      <TableCell>
                        <Chip size="small" color={TAX_STATUS_COLOR[inv.status]} label={labels.status(inv.status)} />
                        {inv.errors?.[0] && (
                          <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                            {inv.errors[0].code}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <DeadlineCell invoice={inv} now={fetchedAt} />
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <IconButton size="small" onClick={() => setViewing(inv)} aria-label={t('moadian.view', 'View')}>
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                        {inv.status === 'FAILED' && (
                          <Button size="small" startIcon={<ReplayIcon />} onClick={() => handleRetry(inv.id)} disabled={busy}>
                            {t('moadian.retry', 'Send again')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {invoices.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                        {t('moadian.empty', 'No e-invoices yet. Turn Moadian on, then complete and pay an order.')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Grid>
      </Grid>

      <Dialog open={!!viewing} onClose={() => setViewing(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {t('moadian.detail.title', 'E-invoice')} <span dir="ltr">{viewing?.tax_id}</span>
        </DialogTitle>
        <DialogContent dividers>
          {viewing && (
            <Stack spacing={2}>
              <Stack sx={{ flexDirection: 'row', flexWrap: 'wrap', gap: 1 }}>
                <Chip size="small" color={TAX_STATUS_COLOR[viewing.status]} label={labels.status(viewing.status)} />
                <Chip size="small" variant="outlined" label={labels.subject(viewing.subject)} />
                <Chip
                  size="small"
                  variant="outlined"
                  label={t('moadian.detail.attempts', { defaultValue: 'Sent {{count}} times', count: viewing.attempts })}
                />
              </Stack>
              {viewing.reference_tax_id && (
                <Typography variant="body2">
                  {t('moadian.detail.reference', 'Refers to invoice')}: <span dir="ltr">{viewing.reference_tax_id}</span>
                </Typography>
              )}
              {viewing.reference_number && (
                <Typography variant="body2">
                  {t('moadian.detail.referenceNumber', 'Tax office reference number')}:{' '}
                  <span dir="ltr">{viewing.reference_number}</span>
                </Typography>
              )}
              {viewing.errors?.map((e) => (
                <Alert key={e.code} severity="error">
                  {e.code}: {e.message}
                </Alert>
              ))}
              <Typography variant="subtitle2">{t('moadian.detail.payload', 'Invoice JSON as it would be sent')}</Typography>
              <Box
                component="pre"
                dir="ltr"
                sx={{ m: 0, p: 2, bgcolor: 'background.neutral', borderRadius: 1, fontSize: 12, overflow: 'auto', maxHeight: 420 }}
              >
                {JSON.stringify(viewing.payload, null, 2)}
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewing(null)}>{t('common.close', 'Close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default MoadianInvoicesPage;
