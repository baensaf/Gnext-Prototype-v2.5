import type { GridColDef } from '@mui/x-data-grid';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import HistoryEduIcon from '@mui/icons-material/HistoryEdu';
import {
  Box,
  Chip,
  Paper,
  Stack,
  Alert,
  Dialog,
  Button,
  Typography,
  IconButton,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { httpClient as axios } from 'src/api/httpClient';

import { ServerDataGrid } from '../../components/server-data-grid';

export function AuditExplorerPage() {
  const { t } = useTranslation();

  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [inspectingLog, setInspectingLog] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [auditRes, alertRes] = await Promise.all([
        axios.get('/api/v1/reports/audit'),
        axios.get('/api/v1/reports/alerts'),
      ]);
      setAuditLogs(Array.isArray(auditRes.data) ? auditRes.data : (auditRes.data?.data || []));
      setAlerts(Array.isArray(alertRes.data) ? alertRes.data : (alertRes.data?.data || []));
    } catch (err) {
      console.error('Failed to load audit data:', err);
      setAuditLogs([]);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAcknowledgeAlert = async (id: string) => {
    try {
      await axios.post(`/api/v1/reports/alerts/${id}/acknowledge`);
      fetchData();
    } catch {
      alert('Failed to acknowledge alert');
    }
  };

  const columns: GridColDef[] = [
    {
      field: 'action',
      headerName: t('audit.action', 'Action'),
      width: 220,
      renderCell: (params) => (
        <Chip
          label={params.value}
          size="small"
          color="primary"
          variant="outlined"
          sx={{ fontWeight: 600 }}
        />
      ),
    },
    {
      field: 'actor_type',
      headerName: t('audit.actorType', 'Actor Type'),
      width: 140,
      renderCell: (params) => (
        <Chip
          size="small"
          label={params.value || 'SYSTEM'}
          color={params.value === 'ADMIN' ? 'warning' : 'default'}
        />
      ),
    },
    {
      field: 'correlation_id',
      headerName: t('audit.correlationId', 'Correlation ID'),
      width: 200,
      renderCell: (params) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }} dir="ltr">
          {params.value || '-'}
        </Typography>
      ),
    },
    {
      field: 'created_at',
      headerName: t('audit.timestamp', 'Timestamp'),
      width: 200,
      renderCell: (params) => (
        <Typography variant="body2" dir="ltr">
          {new Date(params.value).toLocaleString()}
        </Typography>
      ),
    },
    {
      field: 'actions',
      headerName: t('audit.details', 'Details'),
      width: 130,
      sortable: false,
      renderCell: (params) => (
        <Button
          size="small"
          startIcon={<VisibilityIcon />}
          onClick={() => setInspectingLog(params.row)}
        >
          {t('common.inspect', 'Inspect')}
        </Button>
      ),
    },
  ];

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Stack sx={{ flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 2, mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <HistoryEduIcon color="primary" fontSize="large" />
            {t('audit.title', 'Audit Explorer & System Ledger')}
          </Typography>
          <Typography color="text.secondary">
            {t('audit.subtitle', 'Immutable system audit logs with masked sensitive data and operational trace IDs.')}
          </Typography>
        </Box>
        <IconButton onClick={fetchData} title={t('common.refresh', 'Refresh Audit')}>
          <RefreshIcon />
        </IconButton>
      </Stack>

      {/* Operational Alerts Bar */}
      {alerts.length > 0 && (
        <Stack spacing={2} sx={{ mb: 3 }}>
          {alerts.map((alt) => (
            <Alert
              key={alt.id}
              severity={alt.severity === 'CRITICAL' ? 'error' : 'warning'}
              action={
                <Button
                  color="inherit"
                  size="small"
                  disabled={alt.acknowledged}
                  onClick={() => handleAcknowledgeAlert(alt.id)}
                >
                  {alt.acknowledged ? t('audit.acknowledged', 'Acknowledged') : t('audit.acknowledge', 'Acknowledge')}
                </Button>
              }
            >
              <strong>{alt.title}:</strong> {alt.message}
            </Alert>
          ))}
        </Stack>
      )}

      {/* Audit Logs Virtualized DataGrid */}
      <ServerDataGrid
        rows={auditLogs}
        columns={columns}
        loading={loading}
        height={620}
        emptyTitle={t('audit.noLogs', 'No audit logs recorded yet')}
        emptyDescription={t('audit.noLogsDesc', 'System events will populate here as operations are performed.')}
      />

      {/* Inspect Log Modal */}
      <Dialog open={Boolean(inspectingLog)} onClose={() => setInspectingLog(null)} maxWidth="md" fullWidth>
        {inspectingLog && (
          <>
            <DialogTitle>{t('audit.eventDetails', 'Audit Event Details')}: {inspectingLog.action}</DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                  Correlation ID: <span style={{ fontFamily: 'monospace' }}>{inspectingLog.correlation_id}</span>
                </Typography>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                  {t('audit.payloadData', 'Payload Data (Sensitive Data Masked)')}:
                </Typography>
                <Paper sx={{ p: 2, bgcolor: 'background.neutral', fontFamily: 'monospace' }} variant="outlined">
                  <pre style={{ margin: 0, overflowX: 'auto' }}>
                    {JSON.stringify(inspectingLog.after_data || inspectingLog.before_data, null, 2)}
                  </pre>
                </Paper>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setInspectingLog(null)}>{t('common.close', 'Close')}</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}

export default AuditExplorerPage;
