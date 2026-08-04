import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Alert,
} from '@mui/material';
import axios from 'axios';

export function AuditExplorerPage() {
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [inspectingLog, setInspectingLog] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [auditRes, alertRes] = await Promise.all([
        axios.get('/api/v1/reports/audit'),
        axios.get('/api/v1/reports/alerts'),
      ]);
      setAuditLogs(auditRes.data);
      setAlerts(alertRes.data);
    } catch (err) {
      console.error('Failed to load audit data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAcknowledgeAlert = async (id: string) => {
    try {
      await axios.post(`/api/v1/reports/alerts/${id}/acknowledge`);
      fetchData();
    } catch (err) {
      alert('Failed to acknowledge alert');
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Audit Explorer & System Alerts
          </Typography>
          <Typography color="text.secondary">
            Immutable system audit logs with masked sensitive data and operational alerts.
          </Typography>
        </Box>
        <Button variant="outlined" onClick={fetchData}>
          Refresh Audit
        </Button>
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
                  {alt.acknowledged ? 'Acknowledged' : 'Acknowledge'}
                </Button>
              }
            >
              <strong>{alt.title}:</strong> {alt.message}
            </Alert>
          ))}
        </Stack>
      )}

      {/* Audit Logs Table */}
      <Card sx={{ p: 3, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
          System Audit Events ({auditLogs.length} entries)
        </Typography>

        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead sx={{ bgcolor: 'background.neutral' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold' }}>Action</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Actor Type</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Correlation ID</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Timestamp</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Detail</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {auditLogs.map((log) => (
                <TableRow key={log.id} hover>
                  <TableCell sx={{ fontWeight: 'bold' }}>
                    <Chip label={log.action} size="small" color="primary" variant="outlined" />
                  </TableCell>
                  <TableCell>{log.actor_type || 'SYSTEM'}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{log.correlation_id || '-'}</TableCell>
                  <TableCell>{new Date(log.created_at).toLocaleString()}</TableCell>
                  <TableCell>
                    <Button size="small" onClick={() => setInspectingLog(log)}>
                      Inspect JSON
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Inspect Log Drawer / Modal */}
      <Dialog open={Boolean(inspectingLog)} onClose={() => setInspectingLog(null)} maxWidth="md" fullWidth>
        {inspectingLog && (
          <>
            <DialogTitle>Audit Event Details: {inspectingLog.action}</DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                  Correlation ID: {inspectingLog.correlation_id}
                </Typography>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                  Payload Data (Masked for Passwords/PINs):
                </Typography>
                <Paper sx={{ p: 2, bgcolor: 'background.neutral', fontFamily: 'monospace' }} variant="outlined">
                  <pre style={{ margin: 0, overflowX: 'auto' }}>
                    {JSON.stringify(inspectingLog.after_data || inspectingLog.before_data, null, 2)}
                  </pre>
                </Paper>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setInspectingLog(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}

export default AuditExplorerPage;
