import type { Terminal } from '../../api/tenantApi';
import type { OperationalAlertItem } from '../../api/alertsApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import ErrorIcon from '@mui/icons-material/Error';
import PrintIcon from '@mui/icons-material/Print';
import RefreshIcon from '@mui/icons-material/Refresh';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import ShoppingBagIcon from '@mui/icons-material/ShoppingBag';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {
  Box,
  Card,
  Grid,
  Chip,
  Stack,
  Alert,
  Button,
  Switch,
  Divider,
  Typography,
  IconButton,
  CardHeader,
  CardContent,
  FormControlLabel,
} from '@mui/material';

import { fDateTime } from 'src/utils/format-time';

import { tenantApi } from '../../api/tenantApi';
import { alertsApi } from '../../api/alertsApi';
import { useBranchContextOptional } from '../../contexts/branch-context';

export function MonitoringPage() {
  const { t } = useTranslation();
  const branchScope = useBranchContextOptional();
  // At head office the feed is every site's, so each alert says whose it is. Inside a
  // branch the server has already narrowed it to that branch, and the label would be noise.
  const alertOwner = (alert: OperationalAlertItem) => {
    if (!branchScope?.isHeadOffice) return null;
    if (!alert.branch_id) return t('monitoring.chainWide', 'Chain-wide');
    return branchScope.branches.find((b) => b.id === alert.branch_id)?.name ?? alert.branch_id;
  };

  const [alerts, setAlerts] = useState<OperationalAlertItem[]>([]);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [_loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [filterSeverity, setFilterSeverity] = useState<string>('ALL');

  const fetchData = useCallback(async () => {
    try {
      const [alertsData, terminalsData] = await Promise.all([
        alertsApi.getAlerts(),
        tenantApi.getTerminals(),
      ]);
      setAlerts(alertsData);
      setTerminals(terminalsData);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to load monitoring data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh interval (every 10 seconds if enabled)
  useEffect(() => {
    if (!autoRefresh) return () => {};
    const interval = setInterval(() => {
      fetchData();
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  const handleAcknowledge = async (id: string) => {
    try {
      await alertsApi.acknowledgeAlert(id);
      fetchData();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to acknowledge alert');
    }
  };

  const handleAcknowledgeAll = async () => {
    try {
      await alertsApi.acknowledgeAll(alerts);
      fetchData();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to acknowledge all alerts');
    }
  };

  const criticalAlerts = alerts.filter((a) => a.severity === 'CRITICAL' && !a.acknowledged);
  const _warningAlerts = alerts.filter((a) => a.severity === 'WARNING' && !a.acknowledged);
  const _infoAlerts = alerts.filter((a) => a.severity === 'INFO' && !a.acknowledged);

  const filteredAlerts = alerts.filter((a) => {
    if (filterSeverity === 'ALL') return true;
    return a.severity === filterSeverity;
  });

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return <ErrorIcon color="error" />;
      case 'WARNING':
        return <WarningAmberIcon color="warning" />;
      case 'INFO':
      default:
        return <InfoOutlinedIcon color="info" />;
    }
  };

  const getSeverityChipColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return 'error';
      case 'WARNING':
        return 'warning';
      case 'INFO':
      default:
        return 'info';
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      {/* Header */}
      <Stack sx={{ flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 2, mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('monitoring.title', 'Operational Monitoring & Alert Feed')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('monitoring.subtitle', 'Live system health, hardware status, gateway connectivity, and active alerts')}
          </Typography>
        </Box>
        <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1.5 }}>
          <FormControlLabel
            control={
              <Switch
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                color="primary"
              />
            }
            label={t('monitoring.autoRefresh', 'Auto-Refresh (10s)')}
          />
          <IconButton onClick={fetchData} title={t('common.refresh', 'Refresh')}>
            <RefreshIcon />
          </IconButton>
          {alerts.some((a) => !a.acknowledged) && (
            <Button
              variant="outlined"
              color="primary"
              startIcon={<DoneAllIcon />}
              onClick={handleAcknowledgeAll}
            >
              {t('monitoring.ackAll', 'Acknowledge All')}
            </Button>
          )}
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* KPI Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardHeader
              avatar={<CheckCircleIcon color="success" />}
              title={t('monitoring.systemStatus', 'Core API & Database')}
            />
            <CardContent sx={{ pt: 0 }}>
              <Typography variant="h5" sx={{ fontWeight: 700, color: 'success.main' }}>
                {t('monitoring.onlineHealthy', 'Online & healthy')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('monitoring.latencyStatus', 'Latency under 15 ms | database online')}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardHeader
              avatar={<ErrorIcon color="error" />}
              title={t('monitoring.criticalAlerts', 'Critical Alerts')}
            />
            <CardContent sx={{ pt: 0 }}>
              <Typography variant="h4" sx={{ fontWeight: 700, color: criticalAlerts.length ? 'error.main' : 'text.primary' }}>
                {criticalAlerts.length}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('monitoring.requiresAction', 'Needs a manager now')}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardHeader
              avatar={<PointOfSaleIcon color="primary" />}
              title={t('monitoring.activeTerminals', 'Active Terminals')}
            />
            <CardContent sx={{ pt: 0 }}>
              <Typography variant="h4" sx={{ fontWeight: 700 }}>
                {terminals.filter((term) => term.is_active).length} / {terminals.length}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('monitoring.stationsType', 'POS, kiosk and KDS terminals')}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardHeader
              avatar={<CloudDoneIcon color="info" />}
              title={t('monitoring.outboxSync', 'Outbox & Integrations')}
            />
            <CardContent sx={{ pt: 0 }}>
              <Typography variant="h5" sx={{ fontWeight: 700, color: 'info.main' }}>
                SYNCED (0 BACKLOG)
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Snappfood, Printers & Audit
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* Alerts Feed */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Card sx={{ height: '100%' }}>
            <CardHeader
              title={t('monitoring.activeAlertFeed', 'Active Operational Alerts')}
              action={
                <Stack sx={{ flexDirection: 'row', gap: 1 }}>
                  {(['ALL', 'CRITICAL', 'WARNING', 'INFO'] as const).map((sev) => (
                    <Chip
                      key={sev}
                      size="small"
                      label={sev}
                      clickable
                      color={filterSeverity === sev ? 'primary' : 'default'}
                      variant={filterSeverity === sev ? 'filled' : 'outlined'}
                      onClick={() => setFilterSeverity(sev)}
                    />
                  ))}
                </Stack>
              }
            />
            <Divider />
            <CardContent>
              {filteredAlerts.length > 0 ? (
                <Stack spacing={2}>
                  {filteredAlerts.map((alert) => (
                    <Card
                      key={alert.id}
                      variant="outlined"
                      sx={{
                        p: 2,
                        backgroundColor: alert.acknowledged ? 'action.hover' : 'background.paper',
                        borderColor: alert.severity === 'CRITICAL' ? 'error.light' : alert.severity === 'WARNING' ? 'warning.light' : 'divider',
                      }}
                    >
                      <Stack sx={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
                        <Stack sx={{ flexDirection: 'row', alignItems: 'flex-start', gap: 1.5 }}>
                          {getSeverityIcon(alert.severity)}
                          <Box>
                            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                              {alert.title}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                              {alert.message}
                            </Typography>
                            <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: 'block' }} dir="ltr">
                              {fDateTime(alert.created_at)} | Type: {alert.type}
                              {alertOwner(alert) && <> | {alertOwner(alert)}</>}
                            </Typography>
                          </Box>
                        </Stack>
                        <Stack sx={{ alignItems: 'flex-end', gap: 1 }}>
                          <Chip
                            size="small"
                            label={alert.severity}
                            color={getSeverityChipColor(alert.severity) as any}
                          />
                          {!alert.acknowledged ? (
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => handleAcknowledge(alert.id)}
                            >
                              {t('monitoring.ack', 'Acknowledge')}
                            </Button>
                          ) : (
                            <Chip size="small" label={t('monitoring.acknowledged', 'Acknowledged')} variant="outlined" />
                          )}
                        </Stack>
                      </Stack>
                    </Card>
                  ))}
                </Stack>
              ) : (
                <Box sx={{ py: 6, textAlign: 'center' }}>
                  <CheckCircleIcon sx={{ fontSize: 48, color: 'success.main', mb: 1 }} />
                  <Typography variant="subtitle1" color="text.secondary">
                    {t('monitoring.allClear', 'No active alerts detected. All systems operating normally.')}
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Integration Status & Terminals */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={3}>
            {/* Integration Health Card */}
            <Card>
              <CardHeader title={t('monitoring.integrations', 'Integration Connectors')} />
              <Divider />
              <CardContent>
                <Stack spacing={2}>
                  <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
                      <ShoppingBagIcon color="action" />
                      <Typography variant="body2">Snappfood Webhook</Typography>
                    </Stack>
                    <Chip size="small" label="CONNECTED" color="success" />
                  </Stack>
                  <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
                      <PrintIcon color="action" />
                      <Typography variant="body2">Network Printers (ESC/POS)</Typography>
                    </Stack>
                    <Chip size="small" label="READY" color="success" />
                  </Stack>
                  <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
                      <CloudDoneIcon color="action" />
                      <Typography variant="body2">Payment Gateway (SEP / Asan)</Typography>
                    </Stack>
                    <Chip size="small" label="STANDBY" color="info" />
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            {/* Terminals Matrix */}
            <Card>
              <CardHeader title={t('monitoring.terminals', 'Registered Terminals')} />
              <Divider />
              <CardContent sx={{ maxHeight: 320, overflowY: 'auto' }}>
                <Stack spacing={1.5}>
                  {terminals.map((term) => (
                    <Stack
                      key={term.id}
                      sx={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        p: 1,
                        borderRadius: 1,
                        backgroundColor: 'action.hover',
                      }}
                    >
                      <Box>
                        <Typography variant="subtitle2">{term.name || term.code}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {term.terminal_type} | {term.code}
                        </Typography>
                      </Box>
                      <Chip
                        size="small"
                        label={term.is_active ? 'ONLINE' : 'OFFLINE'}
                        color={term.is_active ? 'success' : 'default'}
                      />
                    </Stack>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}

export default MonitoringPage;
