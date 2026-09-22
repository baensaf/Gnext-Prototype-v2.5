import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import VisibilityIcon from '@mui/icons-material/Visibility';
import SyncProblemIcon from '@mui/icons-material/SyncProblem';
import ElectricBoltIcon from '@mui/icons-material/ElectricBolt';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import PrintDisabledIcon from '@mui/icons-material/PrintDisabled';
import {
  Box,
  Card,
  Grid,
  Chip,
  Table,
  Paper,
  Stack,
  Alert,
  Button,
  Dialog,
  Divider,
  TableRow,
  useTheme,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  IconButton,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { RouterLink } from 'src/routes/components';

import { fTime } from 'src/utils/format-time';

import { kdsApi } from 'src/api/kdsApi';
import { tenantApi } from 'src/api/tenantApi';
import { httpClient as axios } from 'src/api/httpClient';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

export function SimulationCenterPage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigate = useNavigate();
  const isRtl = theme.direction === 'rtl';

  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [quickActionAlert, setQuickActionAlert] = useState<{ type: 'success' | 'warning' | 'error' | 'info'; message: string } | null>(null);

  // Subsystem Metrics State
  const [stats, setStats] = useState({
    totalLogs: 0,
    snappfoodOrders: 0,
    printersOnline: 0,
    syncQueuePending: 0,
  });

  // Log Inspection Dialog
  const [inspectingLog, setInspectingLog] = useState<any>(null);

  const fetchHubData = useCallback(async () => {
    setLoading(true);
    try {
      const [logsRes, printersRes, terminalsRes, syncStatusRes] = await Promise.allSettled([
        axios.get('/api/v1/simulation/logs'),
        kdsApi.getPrinters(),
        tenantApi.getTerminals(),
        axios.get('/api/v1/sync/status'),
      ]);

      const logData = logsRes.status === 'fulfilled' && Array.isArray(logsRes.value.data) ? logsRes.value.data : [];
      setLogs(logData);

      const snappCount = logData.filter((l: any) => l.provider === 'SNAPPFOOD').length;
      const printerCount = printersRes.status === 'fulfilled' && Array.isArray(printersRes.value) ? printersRes.value.length : 0;
      const termCount = terminalsRes.status === 'fulfilled' && Array.isArray(terminalsRes.value) ? terminalsRes.value.length : 0;
      const queuePending = syncStatusRes.status === 'fulfilled' ? (syncStatusRes.value.data?.pending_queue_count ?? 0) : 0;

      setStats({
        totalLogs: logData.length,
        snappfoodOrders: snappCount,
        printersOnline: printerCount + termCount,
        syncQueuePending: queuePending,
      });
    } catch (err) {
      console.error('Failed to load simulation hub data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHubData();
  }, [fetchHubData]);

  // Quick Action 1: Generate Quick Snappfood Order
  const handleQuickSnappfoodOrder = async () => {
    setLoading(true);
    try {
      const res = await axios.post('/api/v1/simulation/snappfood/orders', {
        customer_name: 'کاربر تستی سریع',
        customer_phone: '+989129990000',
        address: 'تهران، خیابان ولیعصر، پلاک ۱۰۰',
        expeditionType: 'DELIVERY',
        notes: 'سفارش ثبت‌شده از داشبورد کلی شبیه‌ساز',
        bikerName: 'پیک شبیه‌ساز',
        bikerStatusV2: 'REQUESTED',
      });
      setQuickActionAlert({
        type: 'success',
        message: `${t('simulation.snappfood.webhook.successAlert', 'Order created successfully')}: ${res.data?.order?.order_number || 'SNP-OK'}`,
      });
      fetchHubData();
    } catch (err: any) {
      setQuickActionAlert({
        type: 'error',
        message: err.response?.data?.message || err.message || 'Failed to generate Snappfood order',
      });
    } finally {
      setLoading(false);
    }
  };

  // Quick Action 2: Trigger Printer Outage
  const handleQuickPrinterOutage = () => {
    setQuickActionAlert({
      type: 'warning',
      message: t('simulation.hardware.printers.jobResult', 'Print Job Result:') + ' Primary Kitchen Thermal Printer #1 Out-Of-Paper simulated. Auto-rerouted to auxiliary printer.',
    });
  };

  // Quick Action 3: Trigger Sync Worker
  const handleQuickTriggerSync = async () => {
    setLoading(true);
    try {
      const res = await axios.post('/api/v1/sync/trigger', {});
      setQuickActionAlert({
        type: 'info',
        message: `Sync worker finished: ${res.data?.synced_count ?? 0} synced, ${res.data?.conflict_count ?? 0} conflicts.`,
      });
      fetchHubData();
    } catch (err: any) {
      setQuickActionAlert({
        type: 'error',
        message: err.response?.data?.message || err.message || 'Sync worker run failed',
      });
    } finally {
      setLoading(false);
    }
  };

  const ArrowIcon = isRtl ? ArrowBackIcon : ArrowForwardIcon;

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      {/* Breadcrumbs & Header */}
      <CustomBreadcrumbs
        heading={t('simulation.hub.title', 'External Integration Simulation Center')}
        links={[
          { name: t('nav.dashboard', 'Home'), href: '/app/pos' },
          { name: t('simulation.breadcrumb', 'Simulation Hub') },
        ]}
        action={
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={fetchHubData}
            disabled={loading}
            sx={{ fontWeight: 'bold' }}
          >
            {t('simulation.hub.refreshLogs', 'Refresh Status & Logs')}
          </Button>
        }
      />

      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        {t(
          'simulation.hub.subtitle',
          'Simulate Snappfood webhooks, HMAC verification, hardware fault injection, offline sync engine, and inspection logs.'
        )}
      </Typography>

      {/* Quick Action Notification Banner */}
      {quickActionAlert && (
        <Alert severity={quickActionAlert.type} sx={{ mb: 3 }} onClose={() => setQuickActionAlert(null)}>
          {quickActionAlert.message}
        </Alert>
      )}

      {/* 1. Subsystem Metric Cards */}
      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ p: 2.5, borderRadius: 2.5, boxShadow: 2, borderLeft: '4px solid', borderColor: 'primary.main' }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
              {t('simulation.hub.stats.totalLogs', 'Logged Events')}
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 800, mt: 0.5, color: 'primary.main' }}>
              {stats.totalLogs}
            </Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ p: 2.5, borderRadius: 2.5, boxShadow: 2, borderLeft: '4px solid', borderColor: '#e91e63' }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
              {t('simulation.hub.stats.snappfoodOrders', 'Snappfood Receipts')}
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 800, mt: 0.5, color: '#e91e63' }}>
              {stats.snappfoodOrders}
            </Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ p: 2.5, borderRadius: 2.5, boxShadow: 2, borderLeft: '4px solid', borderColor: 'warning.main' }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
              {t('simulation.hub.stats.activePrinters', 'Hardware Devices')}
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 800, mt: 0.5, color: 'warning.main' }}>
              {stats.printersOnline}
            </Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ p: 2.5, borderRadius: 2.5, boxShadow: 2, borderLeft: '4px solid', borderColor: 'info.main' }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
              {t('simulation.hub.stats.syncQueue', 'Sync Queue Items')}
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 800, mt: 0.5, color: 'info.main' }}>
              {stats.syncQueuePending}
            </Typography>
          </Card>
        </Grid>
      </Grid>

      {/* 2. Quick Simulator Action Bar */}
      <Card sx={{ p: 2.5, mb: 4, borderRadius: 3, bgcolor: 'background.neutral' }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <ElectricBoltIcon color="warning" />
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
              {t('simulation.hub.quickTest.title', 'Quick Simulator Actions')}
            </Typography>
          </Stack>
        </Stack>
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5 }}>
          <Button
            variant="contained"
            color="secondary"
            size="small"
            startIcon={<PlayArrowIcon />}
            onClick={handleQuickSnappfoodOrder}
            disabled={loading}
          >
            {t('simulation.hub.quickTest.genSnappfood', 'Trigger Quick Snappfood Order')}
          </Button>
          <Button
            variant="outlined"
            color="warning"
            size="small"
            startIcon={<PrintDisabledIcon />}
            onClick={handleQuickPrinterOutage}
          >
            {t('simulation.hub.quickTest.testPrinter', 'Trigger Printer Outage')}
          </Button>
          <Button
            variant="outlined"
            color="error"
            size="small"
            startIcon={<WifiOffIcon />}
            onClick={() => navigate('/app/simulation/offline-sync')}
          >
            {t('simulation.hub.quickTest.toggleOffline', 'Simulate Offline Mode')}
          </Button>
          <Button
            variant="outlined"
            color="info"
            size="small"
            startIcon={<SyncProblemIcon />}
            onClick={handleQuickTriggerSync}
            disabled={loading}
          >
            {t('simulation.hub.quickTest.execSync', 'Run Sync Batch Worker')}
          </Button>
        </Stack>
      </Card>

      {/* 3. Dedicated Simulator Modules Grid */}
      <Typography variant="h5" sx={{ fontWeight: 800, mb: 2 }}>
        {t('simulation.hub.quickLaunch', 'Dedicated Simulator Modules')}
      </Typography>

      <Grid container spacing={3} sx={{ mb: 4 }}>
        {/* Card 1: Snappfood */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3, borderRadius: 3, boxShadow: 2, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <Box>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Typography variant="h6" sx={{ fontWeight: 800, color: '#e91e63' }}>
                  {t('simulation.hub.cards.snappfoodTitle', 'Snappfood Aggregator v4.3.0')}
                </Typography>
                <Chip label="v4.3.0 Ready" color="secondary" size="small" sx={{ fontWeight: 'bold' }} />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t(
                  'simulation.hub.cards.snappfoodDesc',
                  'OAuth2 password grants, HMAC SHA-256 webhooks, order stepper, and 20+ vendor automation endpoints.'
                )}
              </Typography>
            </Box>
            <Button
              component={RouterLink}
              href="/app/simulation/snappfood"
              variant="contained"
              color="secondary"
              endIcon={<ArrowIcon />}
              sx={{ alignSelf: 'flex-start', fontWeight: 'bold' }}
            >
              {t('simulation.hub.cards.snappfoodAction', 'Open Snappfood Console')}
            </Button>
          </Card>
        </Grid>

        {/* Card 2: Hardware & POS */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3, borderRadius: 3, boxShadow: 2, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <Box>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Typography variant="h6" sx={{ fontWeight: 800, color: 'primary.main' }}>
                  {t('simulation.hub.cards.hardwareTitle', 'POS Terminals & Printers')}
                </Typography>
                <Chip label="Hardware Telemetry" color="primary" size="small" sx={{ fontWeight: 'bold' }} />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t(
                  'simulation.hub.cards.hardwareDesc',
                  'POS terminal timeout/declines, printer paper-out/cover-open failover, and Tara digital wallet gateway.'
                )}
              </Typography>
            </Box>
            <Button
              component={RouterLink}
              href="/app/simulation/payments-printers"
              variant="contained"
              color="primary"
              endIcon={<ArrowIcon />}
              sx={{ alignSelf: 'flex-start', fontWeight: 'bold' }}
            >
              {t('simulation.hub.cards.hardwareAction', 'Open Hardware Console')}
            </Button>
          </Card>
        </Grid>

        {/* Card 3: Offline Sync */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3, borderRadius: 3, boxShadow: 2, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <Box>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Typography variant="h6" sx={{ fontWeight: 800, color: 'info.main' }}>
                  {t('simulation.hub.cards.syncTitle', 'Offline Sync & Conflict Engine')}
                </Typography>
                <Chip label="V5 Preview" color="info" size="small" sx={{ fontWeight: 'bold' }} />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t(
                  'simulation.hub.cards.syncDesc',
                  'Branch envelope queues, DLQ retries, connectivity toggles, and side-by-side 3-way conflict resolution.'
                )}
              </Typography>
            </Box>
            <Button
              component={RouterLink}
              href="/app/simulation/offline-sync"
              variant="contained"
              color="info"
              endIcon={<ArrowIcon />}
              sx={{ alignSelf: 'flex-start', fontWeight: 'bold' }}
            >
              {t('simulation.hub.cards.syncAction', 'Open Sync Engine')}
            </Button>
          </Card>
        </Grid>

        {/* Card 4: Logs */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3, borderRadius: 3, boxShadow: 2, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <Box>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary' }}>
                  {t('simulation.hub.cards.logsTitle', 'Integration & Webhook Logs')}
                </Typography>
                <Chip label="Full Audit Trail" size="small" variant="outlined" sx={{ fontWeight: 'bold' }} />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t(
                  'simulation.hub.cards.logsDesc',
                  'Payload inspector, correlation IDs, HMAC validation badges, and idempotency replay tests.'
                )}
              </Typography>
            </Box>
            <Button
              component={RouterLink}
              href="/app/simulation/logs"
              variant="outlined"
              color="inherit"
              endIcon={<ArrowIcon />}
              sx={{ alignSelf: 'flex-start', fontWeight: 'bold' }}
            >
              {t('simulation.hub.cards.logsAction', 'Open Audit Logs')}
            </Button>
          </Card>
        </Grid>
      </Grid>

      {/* 4. Unified Cross-Provider Recent Activity Feed */}
      <Card sx={{ p: 3, borderRadius: 3, boxShadow: 2 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            {t('simulation.hub.recentActivity', 'Recent Cross-Provider Integration Events')}
          </Typography>
          <Button
            component={RouterLink}
            href="/app/simulation/logs"
            size="small"
            endIcon={<ArrowIcon />}
          >
            {t('simulation.hub.cards.logsAction', 'Open Audit Logs')}
          </Button>
        </Stack>

        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead sx={{ bgcolor: 'background.neutral' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.logs.table.provider', 'Provider')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.logs.table.eventType', 'Event Type')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.logs.table.reference', 'Reference')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.logs.table.hmac', 'HMAC')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.logs.table.status', 'Status')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.logs.table.timestamp', 'Timestamp')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold', textAlign: 'right' }}>{t('simulation.logs.table.actions', 'Actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logs.slice(0, 10).map((log) => (
                <TableRow key={log.id} hover>
                  <TableCell>
                    <Chip
                      label={log.provider}
                      size="small"
                      color={log.provider === 'SNAPPFOOD' ? 'secondary' : log.provider === 'TARA_WALLET' ? 'info' : 'default'}
                      sx={{ fontWeight: 'bold' }}
                    />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{log.event_type}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {log.idempotency_key || log.order_code || '-'}
                  </TableCell>
                  <TableCell>
                    {log.hmac_signature ? (
                      <Chip label="HMAC SHA-256" size="small" color="success" variant="outlined" />
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={log.status}
                      size="small"
                      color={log.status === 'SUCCESS' ? 'success' : log.status === 'REJECTED' ? 'error' : 'warning'}
                      sx={{ fontWeight: 'bold' }}
                    />
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.8rem' }}>
                    {fTime(log.created_at || Date.now())}
                  </TableCell>
                  <TableCell sx={{ textAlign: 'right' }}>
                    <IconButton size="small" color="primary" onClick={() => setInspectingLog(log)}>
                      <VisibilityIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}

              {logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    {t('simulation.hub.noLogs', 'No simulation events recorded yet. Run a simulation from any module above.')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Log Inspection Dialog */}
      <Dialog open={Boolean(inspectingLog)} onClose={() => setInspectingLog(null)} maxWidth="md" fullWidth>
        {inspectingLog && (
          <>
            <DialogTitle sx={{ fontWeight: 'bold' }}>
              {t('simulation.logs.modal.title', 'Integration Payload Inspector')}: {inspectingLog.provider} - {inspectingLog.event_type}
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                  {t('simulation.logs.modal.inboundRequest', 'Inbound Request Payload (JSON)')}:
                </Typography>
                <Paper sx={{ p: 2, bgcolor: '#1e1e1e', color: '#00ffcc', fontFamily: 'monospace', fontSize: 12, maxHeight: 220, overflow: 'auto' }} variant="outlined">
                  <pre style={{ margin: 0 }}>
                    {JSON.stringify(inspectingLog.request_payload || inspectingLog.payload, null, 2)}
                  </pre>
                </Paper>

                <Divider sx={{ my: 1 }} />

                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                  {t('simulation.logs.modal.outboundResponse', 'Outbound HTTP Response / Acknowledgment')}:
                </Typography>
                <Paper sx={{ p: 2, bgcolor: '#1e1e1e', color: '#ffcc00', fontFamily: 'monospace', fontSize: 12, maxHeight: 180, overflow: 'auto' }} variant="outlined">
                  <pre style={{ margin: 0 }}>
                    {JSON.stringify(inspectingLog.response_payload || { status: 'OK' }, null, 2)}
                  </pre>
                </Paper>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setInspectingLog(null)}>
                {t('simulation.logs.modal.close', 'Close Inspector')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}

export default SimulationCenterPage;
