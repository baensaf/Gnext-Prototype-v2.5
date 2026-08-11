import React, { useState, useEffect } from 'react';

import {
  Box,
  Tab,
  Card,
  Grid,
  Chip,
  Tabs,
  Table,
  Paper,
  Stack,
  Alert,
  Button,
  Dialog,
  Divider,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { httpClient as axios } from 'src/api/httpClient';

export function SimulationCenterPage() {
  const [activeTab, setActiveTab] = useState<number>(0);
  const [_scenarios, setScenarios] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Snappfood simulation form
  const [snappCustomerName, setSnappCustomerName] = useState('Snappfood User');
  const [snappNotes, setSnappNotes] = useState('Extra hot sauce please');
  const [rawWebhookPayload, setRawWebhookPayload] = useState('{\n  "event_id": "evt-custom-100",\n  "order_code": "SF-9988",\n  "items": [{"product_name": "Gourmet Pizza", "quantity": 1, "price": 22.0}]\n}');
  const [lastGeneratedResponse, setLastGeneratedResponse] = useState<any>(null);

  // Tara simulation form
  const [taraNationalId, setTaraNationalId] = useState('0012345678');
  const [taraAmount, setTaraAmount] = useState('150.00');
  const [taraResponse, setTaraResponse] = useState<any>(null);

  // Log Inspection Dialog
  const [inspectingLog, setInspectingLog] = useState<any>(null);

  const fetchScenariosAndLogs = async () => {
    setLoading(true);
    try {
      const [scenariosRes, logsRes] = await Promise.all([
        axios.get('/api/v1/simulation/scenarios'),
        axios.get('/api/v1/simulation/logs'),
      ]);
      setScenarios(scenariosRes.data);
      setLogs(logsRes.data);
    } catch (err) {
      console.error('Failed to load simulation center data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScenariosAndLogs();
  }, []);

  const handleGenerateSnappfoodOrder = async () => {
    setLoading(true);
    try {
      const res = await axios.post('/api/v1/simulation/snappfood/generate', {
        customer_name: snappCustomerName,
        notes: snappNotes,
      });
      setLastGeneratedResponse(res.data);
      fetchScenariosAndLogs();
    } catch (err) {
      alert('Failed to generate Snappfood order: ' + ((err as any).response?.data?.message || (err as any).message));
    } finally {
      setLoading(false);
    }
  };

  const handleSendRawWebhook = async () => {
    setLoading(true);
    try {
      const parsed = JSON.parse(rawWebhookPayload);
      const res = await axios.post('/api/v1/simulation/snappfood/webhook', parsed);
      setLastGeneratedResponse(res.data);
      fetchScenariosAndLogs();
    } catch (err) {
      alert('Webhook error: ' + ((err as any).response?.data?.message || (err as any).message));
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteTaraCommand = async (command: string) => {
    setLoading(true);
    try {
      const res = await axios.post('/api/v1/simulation/tara/command', {
        command,
        customer_national_id: taraNationalId,
        amount: parseFloat(taraAmount || '150.00'),
      });
      setTaraResponse(res.data);
      fetchScenariosAndLogs();
    } catch (err) {
      alert('Tara Command Failed: ' + ((err as any).response?.data?.message || (err as any).message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            External Integration Simulation Center
          </Typography>
          <Typography color="text.secondary">
            Simulate Snappfood webhooks, HMAC verification, Tara BNPL lifecycle, and inspection logs.
          </Typography>
        </Box>
        <Button variant="outlined" onClick={fetchScenariosAndLogs}>
          Refresh Logs
        </Button>
      </Stack>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onChange={(_, val) => setActiveTab(val)}
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}
      >
        <Tab label="Snappfood Aggregator Simulator" sx={{ fontWeight: 'bold' }} />
        <Tab label="Payments & Printers Simulator" sx={{ fontWeight: 'bold' }} />
        <Tab label="Integration Audit Logs" sx={{ fontWeight: 'bold' }} />
      </Tabs>

      {/* TAB 0: SNAPPFOOD SIMULATOR */}
      {activeTab === 0 && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ p: 3, borderRadius: 3, boxShadow: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
                Generator & Scenario Runner
              </Typography>
              <Stack spacing={2}>
                <TextField
                  label="Customer Name"
                  value={snappCustomerName}
                  onChange={(e) => setSnappCustomerName(e.target.value)}
                  fullWidth
                />
                <TextField
                  label="Vendor Notes"
                  value={snappNotes}
                  onChange={(e) => setSnappNotes(e.target.value)}
                  fullWidth
                />
                <Button
                  variant="contained"
                  color="primary"
                  size="large"
                  onClick={handleGenerateSnappfoodOrder}
                  disabled={loading}
                >
                  Generate Test Snappfood Order (HMAC Signed)
                </Button>
              </Stack>
            </Card>

            <Card sx={{ p: 3, borderRadius: 3, boxShadow: 3, mt: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
                Raw Webhook Payload & Duplicate Test
              </Typography>
              <TextField
                multiline
                rows={6}
                value={rawWebhookPayload}
                onChange={(e) => setRawWebhookPayload(e.target.value)}
                fullWidth
                sx={{ fontFamily: 'monospace', mb: 2 }}
              />
              <Stack direction="row" spacing={2}>
                <Button variant="contained" color="secondary" onClick={handleSendRawWebhook} disabled={loading}>
                  Post Webhook
                </Button>
                <Button variant="outlined" color="warning" onClick={handleSendRawWebhook} disabled={loading}>
                  Replay (Test Duplicate Suppression)
                </Button>
              </Stack>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ p: 3, borderRadius: 3, boxShadow: 3, minHeight: 400 }}>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
                Simulation Result Output
              </Typography>
              {lastGeneratedResponse ? (
                <Stack spacing={2}>
                  {lastGeneratedResponse.duplicate ? (
                    <Alert severity="warning">
                      <strong>Exactly-Once Enforced!</strong> Duplicate webhook detected and suppressed safely.
                    </Alert>
                  ) : (
                    <Alert severity="success">
                      <strong>Order Created!</strong> Snappfood order intake mapped into domain Order Engine.
                    </Alert>
                  )}

                  <Paper sx={{ p: 2, bgcolor: 'background.neutral', fontFamily: 'monospace' }} variant="outlined">
                    <pre style={{ margin: 0, overflowX: 'auto' }}>
                      {JSON.stringify(lastGeneratedResponse, null, 2)}
                    </pre>
                  </Paper>
                </Stack>
              ) : (
                <Typography color="text.secondary" align="center" sx={{ py: 8 }}>
                  No simulation run yet. Click &quot;Generate Test Snappfood Order&quot; to execute.
                </Typography>
              )}
            </Card>
          </Grid>
        </Grid>
      )}

      {/* TAB 1: PAYMENTS & PRINTERS SIMULATOR */}
      {activeTab === 1 && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ p: 3, borderRadius: 3, boxShadow: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
                Tara BNPL Payment Lifecycle
              </Typography>
              <Stack spacing={2}>
                <TextField
                  label="Customer National ID"
                  value={taraNationalId}
                  onChange={(e) => setTaraNationalId(e.target.value)}
                  fullWidth
                />
                <TextField
                  label="Amount ($)"
                  value={taraAmount}
                  onChange={(e) => setTaraAmount(e.target.value)}
                  fullWidth
                />
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                  <Button variant="outlined" onClick={() => handleExecuteTaraCommand('INSPECT_ELIGIBILITY')}>
                    Check Eligibility
                  </Button>
                  <Button variant="contained" color="info" onClick={() => handleExecuteTaraCommand('RESERVE_CREDIT')}>
                    Reserve Credit
                  </Button>
                  <Button variant="contained" color="success" onClick={() => handleExecuteTaraCommand('SETTLE_TRANSACTION')}>
                    Settle BNPL
                  </Button>
                  <Button variant="outlined" color="error" onClick={() => handleExecuteTaraCommand('CANCEL_RESERVATION')}>
                    Cancel Token
                  </Button>
                </Stack>
              </Stack>
            </Card>

            <Card sx={{ p: 3, borderRadius: 3, boxShadow: 3, mt: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 1 }}>
                Kitchen Printer Spooler Fault Injection
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Simulate physical kitchen ticket printer out-of-paper and spooler retry logic.
              </Typography>
              <Button
                variant="outlined"
                color="warning"
                onClick={() => alert('Simulated Printer Fault: Kitchen Printer #1 Out Of Paper. Rerouted to Auxiliary Station.')}
              >
                Inject Printer Paper Outage Fault
              </Button>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ p: 3, borderRadius: 3, boxShadow: 3, minHeight: 350 }}>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
                Tara BNPL Outcome
              </Typography>
              {taraResponse ? (
                <Paper sx={{ p: 2, bgcolor: 'background.neutral', fontFamily: 'monospace' }} variant="outlined">
                  <pre style={{ margin: 0, overflowX: 'auto' }}>{JSON.stringify(taraResponse, null, 2)}</pre>
                </Paper>
              ) : (
                <Typography color="text.secondary" align="center" sx={{ py: 6 }}>
                  Run a Tara command to inspect response.
                </Typography>
              )}
            </Card>
          </Grid>
        </Grid>
      )}

      {/* TAB 2: LOGS EXPLORER */}
      {activeTab === 2 && (
        <Card sx={{ p: 3, borderRadius: 3, boxShadow: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Integration Webhook & Command Audit Explorer ({logs.length} entries)
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead sx={{ bgcolor: 'background.neutral' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Provider</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Event Type</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Idempotency Key</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>HMAC Status</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Duplicate</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Timestamp</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} hover>
                    <TableCell>
                      <Chip label={log.provider} size="small" color={log.provider === 'SNAPPFOOD' ? 'warning' : 'info'} />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{log.event_type}</TableCell>
                    <TableCell>{log.idempotency_key || '-'}</TableCell>
                    <TableCell>
                      {log.hmac_signature ? (
                        <Chip label="HMAC SHA-256" size="small" color="success" variant="outlined" />
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {log.is_duplicate ? (
                        <Chip label="DUPLICATE" size="small" color="error" />
                      ) : (
                        <Chip label="UNIQUE" size="small" color="default" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={log.status}
                        size="small"
                        color={log.status === 'SUCCESS' ? 'success' : log.status === 'REJECTED' ? 'error' : 'warning'}
                      />
                    </TableCell>
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
      )}

      {/* Log Inspection Dialog */}
      <Dialog open={Boolean(inspectingLog)} onClose={() => setInspectingLog(null)} maxWidth="md" fullWidth>
        {inspectingLog && (
          <>
            <DialogTitle>
              Integration Log Detail: {inspectingLog.provider} - {inspectingLog.event_type}
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                  Request Payload:
                </Typography>
                <Paper sx={{ p: 2, bgcolor: 'background.neutral', fontFamily: 'monospace' }} variant="outlined">
                  <pre style={{ margin: 0, overflowX: 'auto' }}>
                    {JSON.stringify(inspectingLog.request_payload, null, 2)}
                  </pre>
                </Paper>

                <Divider sx={{ my: 1 }} />

                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                  Response Payload:
                </Typography>
                <Paper sx={{ p: 2, bgcolor: 'background.neutral', fontFamily: 'monospace' }} variant="outlined">
                  <pre style={{ margin: 0, overflowX: 'auto' }}>
                    {JSON.stringify(inspectingLog.response_payload, null, 2)}
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

export default SimulationCenterPage;
