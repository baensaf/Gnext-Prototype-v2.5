import type { Terminal } from 'src/api/tenantApi';
import type { PrinterDevice } from 'src/api/kdsApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Tabs from '@mui/material/Tabs';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';
import CircularProgress from '@mui/material/CircularProgress';

import { kdsApi } from 'src/api/kdsApi';
import { tenantApi } from 'src/api/tenantApi';
import { httpClient as axios } from 'src/api/httpClient';

export function SimulationPaymentsPrintersPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'POS' | 'PRINTERS' | 'GATEWAY' | 'HISTORY'>('POS');

  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // POS Simulator State
  const [selectedTerminal, setSelectedTerminal] = useState('');
  const [posScenario, setPosScenario] = useState('SUCCESS');
  const [posAmount, setPosAmount] = useState('500000');
  const [posLatency, setPosLatency] = useState('1200');
  const [posTesting, setPosTesting] = useState(false);
  const [posResult, setPosResult] = useState<any>(null);

  // Printer Simulator State
  const [printerStatuses, setPrinterStatuses] = useState<Record<string, { status: string; paper: boolean; cover: boolean }>>({});
  const [printTesting, setPrintTesting] = useState<string | null>(null);
  const [printResult, setPrintResult] = useState<any>(null);

  // Gateway Simulator State
  const [gatewayAction, setGatewayAction] = useState('AUTHORIZE');
  const [gatewayAmount, setGatewayAmount] = useState('1000000');
  const [gatewayMobile, setGatewayMobile] = useState('09123456789');
  const [gatewayResult, setGatewayResult] = useState<any>(null);
  const [gatewayTesting, setGatewayTesting] = useState(false);

  // History log
  const [simLogs, setSimLogs] = useState<any[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [termList, printList] = await Promise.all([
        tenantApi.getTerminals().catch(() => []),
        kdsApi.getPrinters().catch(() => []),
      ]);
      setTerminals(termList || []);
      setPrinters(printList || []);
      if (termList && termList.length > 0) setSelectedTerminal(termList[0].id);

      const initialStatus: Record<string, { status: string; paper: boolean; cover: boolean }> = {};
      (printList || []).forEach((p) => {
        initialStatus[p.id] = { status: 'ONLINE', paper: true, cover: true };
      });
      setPrinterStatuses(initialStatus);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load hardware configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleTestPos = async () => {
    setPosTesting(true);
    setPosResult(null);
    setError(null);
    try {
      const startTime = Date.now();
      await new Promise((r) => setTimeout(r, Math.min(Number(posLatency) || 500, 3000)));

      let outcomeStatus = 'APPROVED';
      let outcomeCode = '00';
      let msg = 'Transaction approved successfully by POS simulator';

      if (posScenario === 'TIMEOUT') {
        outcomeStatus = 'TIMEOUT';
        outcomeCode = '91';
        msg = 'Terminal response timeout after 15000ms. Fallback initiated.';
      } else if (posScenario === 'DECLINED') {
        outcomeStatus = 'DECLINED';
        outcomeCode = '51';
        msg = 'Transaction declined: Insufficient funds or invalid card PIN';
      } else if (posScenario === 'NETWORK_DROP') {
        outcomeStatus = 'ERROR';
        outcomeCode = '96';
        msg = 'Network connection dropped during authorization packet transmission';
      }

      const elapsed = Date.now() - startTime;
      const res = {
        terminalId: selectedTerminal,
        scenario: posScenario,
        amount: posAmount,
        status: outcomeStatus,
        responseCode: outcomeCode,
        message: msg,
        authCode: outcomeStatus === 'APPROVED' ? `AUTH-${Math.floor(100000 + Math.random() * 900000)}` : null,
        rRN: `RRN-${Date.now().toString().slice(-8)}`,
        latencyMs: elapsed,
        timestamp: new Date().toISOString(),
      };

      setPosResult(res);
      setSimLogs((prev) => [res, ...prev.slice(0, 19)]);
    } catch (err: any) {
      setError(err.message || 'POS Simulation failed');
    } finally {
      setPosTesting(false);
    }
  };

  const handleTogglePrinterPaper = (printerId: string) => {
    setPrinterStatuses((prev) => {
      const current = prev[printerId] || { status: 'ONLINE', paper: true, cover: true };
      const nextPaper = !current.paper;
      return {
        ...prev,
        [printerId]: {
          ...current,
          paper: nextPaper,
          status: !nextPaper ? 'PAPER_OUT' : (current.cover ? 'ONLINE' : 'COVER_OPEN'),
        },
      };
    });
  };

  const handleTogglePrinterCover = (printerId: string) => {
    setPrinterStatuses((prev) => {
      const current = prev[printerId] || { status: 'ONLINE', paper: true, cover: true };
      const nextCover = !current.cover;
      return {
        ...prev,
        [printerId]: {
          ...current,
          cover: nextCover,
          status: !nextCover ? 'COVER_OPEN' : (current.paper ? 'ONLINE' : 'PAPER_OUT'),
        },
      };
    });
  };

  const handleTestPrint = async (printer: PrinterDevice) => {
    setPrintTesting(printer.id);
    setPrintResult(null);
    try {
      const pState = printerStatuses[printer.id] || { status: 'ONLINE', paper: true, cover: true };
      await new Promise((r) => setTimeout(r, 600));

      if (!pState.paper) {
        const fallback = printers.find((p) => p.id !== printer.id);
        const res = {
          printerId: printer.id,
          printerName: printer.name,
          status: 'FAILOVER',
          error: 'PAPER_OUT',
          message: `Primary printer ${printer.name} paper sensor triggered out of paper. Print job routed to fallback printer: ${fallback?.name || 'Secondary Thermal'}`,
          jobId: `PJ-${Date.now().toString().slice(-6)}`,
          timestamp: new Date().toISOString(),
        };
        setPrintResult(res);
        setSimLogs((prev) => [res, ...prev.slice(0, 19)]);
      } else if (!pState.cover) {
        const res = {
          printerId: printer.id,
          printerName: printer.name,
          status: 'ERROR',
          error: 'COVER_OPEN',
          message: `Printer ${printer.name} cover open sensor active. Please close head cover.`,
          jobId: `PJ-${Date.now().toString().slice(-6)}`,
          timestamp: new Date().toISOString(),
        };
        setPrintResult(res);
        setSimLogs((prev) => [res, ...prev.slice(0, 19)]);
      } else {
        const res = {
          printerId: printer.id,
          printerName: printer.name,
          status: 'PRINTED',
          message: `Test slip printed cleanly on ${printer.name} (${printer.simulated_address || '192.168.1.100'})`,
          jobId: `PJ-${Date.now().toString().slice(-6)}`,
          timestamp: new Date().toISOString(),
        };
        setPrintResult(res);
        setSimLogs((prev) => [res, ...prev.slice(0, 19)]);
      }
    } catch (err: any) {
      setError(err.message || 'Printer test failed');
    } finally {
      setPrintTesting(null);
    }
  };

  const handleTestGateway = async () => {
    setGatewayTesting(true);
    setGatewayResult(null);
    try {
      const res = await axios.post('/api/v1/simulation/tara/transactions', {
        action: gatewayAction,
        amount: gatewayAmount,
        phone_number: gatewayMobile,
      });
      setGatewayResult(res.data);
      setSuccessMsg('Gateway command executed successfully');
      setSimLogs((prev) => [{ ...res.data, type: 'GATEWAY', timestamp: new Date().toISOString() }, ...prev.slice(0, 19)]);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Gateway command failed');
    } finally {
      setGatewayTesting(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
              {t('simulation.hardwareTitle', 'Hardware Failure & Response Simulator')}
            </Typography>
            <Typography color="text.secondary">
              {t('simulation.hardwareDesc', 'Simulate mobile POS timeouts, paper-out printer errors, network drops, and device failover rerouting.')}
            </Typography>
          </Box>
          <Chip label="SIMULATION ACTIVE" color="warning" sx={{ fontWeight: 'bold' }} />
        </Stack>

        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {successMsg && <Alert severity="success" onClose={() => setSuccessMsg(null)}>{successMsg}</Alert>}

        <Paper sx={{ borderRadius: 2 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2, pt: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Tab label="POS Terminal Simulator" value="POS" />
            <Tab label="Printers & Paper Sensors" value="PRINTERS" />
            <Tab label="Digital Wallets & Gateway" value="GATEWAY" />
            <Tab label="Simulation Event Log" value="HISTORY" />
          </Tabs>

          <Box sx={{ p: 3 }}>
            {tab === 'POS' && (
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Card variant="outlined" sx={{ p: 3 }}>
                    <Typography variant="h6" sx={{ mb: 2 }}>Inject POS Terminal Event</Typography>
                    <Stack spacing={2.5}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Target POS Terminal</InputLabel>
                        <Select
                          value={selectedTerminal}
                          label="Target POS Terminal"
                          onChange={(e) => setSelectedTerminal(e.target.value)}
                        >
                          {terminals.map((term) => (
                            <MenuItem key={term.id} value={term.id}>
                              {term.name || term.code} ({(term as any).type || 'POS'})
                            </MenuItem>
                          ))}
                          {terminals.length === 0 && <MenuItem value="">Default POS Terminal</MenuItem>}
                        </Select>
                      </FormControl>

                      <FormControl fullWidth size="small">
                        <InputLabel>Simulation Scenario</InputLabel>
                        <Select
                          value={posScenario}
                          label="Simulation Scenario"
                          onChange={(e) => setPosScenario(e.target.value)}
                        >
                          <MenuItem value="SUCCESS">Success (Approved Auth Code: 00)</MenuItem>
                          <MenuItem value="TIMEOUT">Terminal Timeout (HTTP 504 / 15s delay)</MenuItem>
                          <MenuItem value="DECLINED">Card Declined / Wrong PIN (Code: 51)</MenuItem>
                          <MenuItem value="NETWORK_DROP">Network Connection Drop / Socket Reset</MenuItem>
                        </Select>
                      </FormControl>

                      <Stack direction="row" spacing={2}>
                        <TextField
                          label="Amount (IRR)"
                          size="small"
                          fullWidth
                          value={posAmount}
                          onChange={(e) => setPosAmount(e.target.value)}
                        />
                        <TextField
                          label="Latency (ms)"
                          size="small"
                          fullWidth
                          value={posLatency}
                          onChange={(e) => setPosLatency(e.target.value)}
                        />
                      </Stack>

                      <Button
                        variant="contained"
                        color="primary"
                        size="large"
                        onClick={handleTestPos}
                        disabled={posTesting}
                        startIcon={posTesting ? <CircularProgress size={20} color="inherit" /> : null}
                      >
                        {posTesting ? 'Transmitting to Simulated POS...' : 'Simulate POS Transaction'}
                      </Button>
                    </Stack>
                  </Card>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                  <Card variant="outlined" sx={{ p: 3, height: '100%' }}>
                    <Typography variant="h6" sx={{ mb: 2 }}>Terminal Response & Telemetry</Typography>
                    {posResult ? (
                      <Stack spacing={2}>
                        <Alert
                          severity={posResult.status === 'APPROVED' ? 'success' : (posResult.status === 'TIMEOUT' ? 'warning' : 'error')}
                        >
                          <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                            Status: {posResult.status} (Code: {posResult.responseCode})
                          </Typography>
                          <Typography variant="body2">{posResult.message}</Typography>
                        </Alert>

                        <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50', fontFamily: 'monospace', fontSize: 13 }}>
                          <pre style={{ margin: 0 }}>{JSON.stringify(posResult, null, 2)}</pre>
                        </Paper>
                      </Stack>
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                        <Typography>Trigger a transaction to inspect live terminal response.</Typography>
                      </Box>
                    )}
                  </Card>
                </Grid>
              </Grid>
            )}

            {tab === 'PRINTERS' && (
              <Stack spacing={3}>
                <Typography variant="h6">Configured Printers & Hardware Sensors</Typography>
                <Grid container spacing={2}>
                  {printers.map((p) => {
                    const st = printerStatuses[p.id] || { status: 'ONLINE', paper: true, cover: true };
                    return (
                      <Grid key={p.id} size={{ xs: 12, md: 6, lg: 4 }}>
                        <Card variant="outlined" sx={{ p: 2.5 }}>
                          <CardHeader
                            title={p.name}
                            subheader={`Code: ${p.code} | Address: ${p.simulated_address || '192.168.1.100'}`}
                            action={
                              <Chip
                                label={st.status}
                                color={st.status === 'ONLINE' ? 'success' : (st.status === 'PAPER_OUT' ? 'error' : 'warning')}
                                size="small"
                                sx={{ fontWeight: 'bold' }}
                              />
                            }
                            sx={{ p: 0, mb: 2 }}
                          />
                          <Divider sx={{ mb: 2 }} />

                          <Stack spacing={1.5}>
                            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                              <Typography variant="body2">Paper Roll Sensor:</Typography>
                              <Button
                                size="small"
                                variant={st.paper ? 'outlined' : 'contained'}
                                color={st.paper ? 'primary' : 'error'}
                                onClick={() => handleTogglePrinterPaper(p.id)}
                              >
                                {st.paper ? 'Paper OK' : 'Trigger Paper Out'}
                              </Button>
                            </Stack>

                            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                              <Typography variant="body2">Cover Sensor:</Typography>
                              <Button
                                size="small"
                                variant={st.cover ? 'outlined' : 'contained'}
                                color={st.cover ? 'primary' : 'warning'}
                                onClick={() => handleTogglePrinterCover(p.id)}
                              >
                                {st.cover ? 'Cover Closed' : 'Trigger Cover Open'}
                              </Button>
                            </Stack>

                            <Button
                              variant="contained"
                              color="secondary"
                              size="small"
                              onClick={() => handleTestPrint(p)}
                              disabled={printTesting === p.id}
                              sx={{ mt: 1 }}
                            >
                              {printTesting === p.id ? 'Testing Slip...' : 'Test Print Slip'}
                            </Button>
                          </Stack>
                        </Card>
                      </Grid>
                    );
                  })}
                </Grid>

                {printResult && (
                  <Card variant="outlined" sx={{ p: 3, mt: 2 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                      Print Job Result: {printResult.printerName}
                    </Typography>
                    <Alert severity={printResult.status === 'PRINTED' ? 'success' : (printResult.status === 'FAILOVER' ? 'warning' : 'error')}>
                      {printResult.message}
                    </Alert>
                  </Card>
                )}
              </Stack>
            )}

            {tab === 'GATEWAY' && (
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Card variant="outlined" sx={{ p: 3 }}>
                    <Typography variant="h6" sx={{ mb: 2 }}>Tara Digital Wallet & IPG Gateway</Typography>
                    <Stack spacing={2.5}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Gateway Action</InputLabel>
                        <Select
                          value={gatewayAction}
                          label="Gateway Action"
                          onChange={(e) => setGatewayAction(e.target.value)}
                        >
                          <MenuItem value="AUTHORIZE">Authorize Payment (OTP Required)</MenuItem>
                          <MenuItem value="CAPTURE">Direct Capture / Settle</MenuItem>
                          <MenuItem value="BALANCE_INQUIRY">Customer Credit Limit Inquiry</MenuItem>
                          <MenuItem value="REFUND">Reverse / Refund Wallet Payment</MenuItem>
                        </Select>
                      </FormControl>

                      <TextField
                        label="Customer Mobile"
                        size="small"
                        fullWidth
                        value={gatewayMobile}
                        onChange={(e) => setGatewayMobile(e.target.value)}
                      />

                      <TextField
                        label="Transaction Amount (IRR)"
                        size="small"
                        fullWidth
                        value={gatewayAmount}
                        onChange={(e) => setGatewayAmount(e.target.value)}
                      />

                      <Button
                        variant="contained"
                        color="primary"
                        onClick={handleTestGateway}
                        disabled={gatewayTesting}
                        startIcon={gatewayTesting ? <CircularProgress size={20} color="inherit" /> : null}
                      >
                        {gatewayTesting ? 'Executing Gateway Call...' : 'Execute Gateway Command'}
                      </Button>
                    </Stack>
                  </Card>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                  <Card variant="outlined" sx={{ p: 3, height: '100%' }}>
                    <Typography variant="h6" sx={{ mb: 2 }}>Gateway Transaction Log</Typography>
                    {gatewayResult ? (
                      <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50', fontFamily: 'monospace', fontSize: 13 }}>
                        <pre style={{ margin: 0 }}>{JSON.stringify(gatewayResult, null, 2)}</pre>
                      </Paper>
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                        <Typography>Execute a gateway action to view response payload.</Typography>
                      </Box>
                    )}
                  </Card>
                </Grid>
              </Grid>
            )}

            {tab === 'HISTORY' && (
              <Stack spacing={2}>
                <Typography variant="h6">Recent Hardware Simulation Events</Typography>
                {simLogs.map((log, idx) => (
                  <Card key={idx} variant="outlined" sx={{ p: 2 }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                        {log.scenario || log.printerName || log.action || 'SIMULATION_EVENT'}
                      </Typography>
                      <Chip
                        label={log.status || 'EVENT'}
                        size="small"
                        color={log.status === 'APPROVED' || log.status === 'PRINTED' || log.status === 'SUCCESS' ? 'success' : 'warning'}
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {log.message || JSON.stringify(log)}
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                      Timestamp: {log.timestamp || new Date().toISOString()}
                    </Typography>
                  </Card>
                ))}
                {simLogs.length === 0 && (
                  <Alert severity="info">No simulation events recorded yet. Run a POS or printer test above.</Alert>
                )}
              </Stack>
            )}
          </Box>
        </Paper>
      </Stack>
    </Box>
  );
}

export default SimulationPaymentsPrintersPage;
