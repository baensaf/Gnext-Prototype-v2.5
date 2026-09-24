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
import PrintIcon from '@mui/icons-material/Print';
import FormControl from '@mui/material/FormControl';
import RefreshIcon from '@mui/icons-material/Refresh';
import HistoryIcon from '@mui/icons-material/History';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import CircularProgress from '@mui/material/CircularProgress';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';

import { MoneyUtil } from 'src/utils/money.util';

import { kdsApi } from 'src/api/kdsApi';
import { tenantApi } from 'src/api/tenantApi';
import { httpClient as axios } from 'src/api/httpClient';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

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

  const handleSeedMockHardware = () => {
    const mockPrinters: PrinterDevice[] = [
      { id: 'mock-p1', name: 'Kitchen Hot Line (Thermal 80mm)', code: 'PRN-KIT-1', simulated_address: '192.168.1.101', role: 'KITCHEN' } as any,
      { id: 'mock-p2', name: 'Front Counter Cashier Slip', code: 'PRN-FOH-1', simulated_address: '192.168.1.102', role: 'RECEIPT' } as any,
      { id: 'mock-p3', name: 'Bar & Beverage Station', code: 'PRN-BAR-1', simulated_address: '192.168.1.103', role: 'BAR' } as any,
    ];
    const mockTerminals: Terminal[] = [
      { id: 'mock-term1', name: 'Saman POS Terminal #1', code: 'POS-SAMAN-01', ip_address: '192.168.1.120' } as any,
      { id: 'mock-term2', name: 'Pasargad Mobile POS #2', code: 'POS-PAS-02', ip_address: '192.168.1.121' } as any,
    ];
    setPrinters(mockPrinters);
    setTerminals(mockTerminals);
    setSelectedTerminal(mockTerminals[0].id);
    const initialStatus: Record<string, { status: string; paper: boolean; cover: boolean }> = {};
    mockPrinters.forEach((p) => {
      initialStatus[p.id] = { status: 'ONLINE', paper: true, cover: true };
    });
    setPrinterStatuses(initialStatus);
    setSuccessMsg('Mock hardware devices injected for simulation.');
  };

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
        terminalId: selectedTerminal || 'POS-DEFAULT-01',
        scenario: posScenario,
        amount: MoneyUtil.format(posAmount || '500000', 0),
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
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <CustomBreadcrumbs
        heading={t('simulation.hardware.title', 'Hardware Failure & Response Simulator')}
        links={[
          { name: t('nav.dashboard', 'Home'), href: '/app/dashboard' },
          { name: t('simulation.breadcrumb', 'Simulation Hub'), href: '/app/simulation' },
          { name: t('simulation.hardware.title', 'Payments & Printers') },
        ]}
        action={
          <Stack direction="row" spacing={1}>
            {printers.length === 0 && (
              <Button
                variant="contained"
                color="secondary"
                startIcon={<AddCircleIcon />}
                onClick={handleSeedMockHardware}
              >
                {t('simulation.hardware.seedMock', 'Seed Demo Hardware')}
              </Button>
            )}
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={loadData}
              sx={{ fontWeight: 'bold' }}
            >
              {t('simulation.hub.refreshLogs', 'Refresh')}
            </Button>
          </Stack>
        }
      />

      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        {t(
          'simulation.hardware.subtitle',
          'Simulate mobile POS timeouts, paper-out printer errors, network drops, and device failover rerouting.'
        )}
      </Typography>

      <Stack spacing={3}>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {successMsg && <Alert severity="success" onClose={() => setSuccessMsg(null)}>{successMsg}</Alert>}

        <Paper sx={{ borderRadius: 3, boxShadow: 2 }}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            sx={{ px: 2, pt: 1, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab icon={<PointOfSaleIcon />} iconPosition="start" label={t('simulation.hardware.tabs.pos', 'POS Terminal Simulator')} value="POS" sx={{ fontWeight: 'bold' }} />
            <Tab icon={<PrintIcon />} iconPosition="start" label={t('simulation.hardware.tabs.printers', 'Printers & Paper Sensors')} value="PRINTERS" sx={{ fontWeight: 'bold' }} />
            <Tab icon={<AccountBalanceWalletIcon />} iconPosition="start" label={t('simulation.hardware.tabs.gateway', 'Digital Wallets & Gateway')} value="GATEWAY" sx={{ fontWeight: 'bold' }} />
            <Tab icon={<HistoryIcon />} iconPosition="start" label={t('simulation.hardware.tabs.history', 'Simulation Event Log')} value="HISTORY" sx={{ fontWeight: 'bold' }} />
          </Tabs>

          <Box sx={{ p: 3 }}>
            {tab === 'POS' && (
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Card variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                      {t('simulation.hardware.pos.cardTitle', 'Inject POS Terminal Event')}
                    </Typography>
                    <Stack spacing={2.5}>
                      <FormControl fullWidth size="small">
                        <InputLabel>{t('simulation.hardware.pos.terminalLabel', 'Target POS Terminal')}</InputLabel>
                        <Select
                          value={selectedTerminal}
                          label={t('simulation.hardware.pos.terminalLabel', 'Target POS Terminal')}
                          onChange={(e) => setSelectedTerminal(e.target.value)}
                        >
                          {terminals.map((term) => (
                            <MenuItem key={term.id} value={term.id}>
                              {term.name || term.code} ({(term as any).type || 'POS'})
                            </MenuItem>
                          ))}
                          {terminals.length === 0 && <MenuItem value="">Default Simulated POS Terminal</MenuItem>}
                        </Select>
                      </FormControl>

                      <FormControl fullWidth size="small">
                        <InputLabel>{t('simulation.hardware.pos.scenarioLabel', 'Simulation Scenario')}</InputLabel>
                        <Select
                          value={posScenario}
                          label={t('simulation.hardware.pos.scenarioLabel', 'Simulation Scenario')}
                          onChange={(e) => setPosScenario(e.target.value)}
                        >
                          <MenuItem value="SUCCESS">{t('simulation.hardware.pos.scenarioSuccess', 'Success (Approved Auth Code: 00)')}</MenuItem>
                          <MenuItem value="TIMEOUT">{t('simulation.hardware.pos.scenarioTimeout', 'Terminal Timeout (HTTP 504 / 15s delay)')}</MenuItem>
                          <MenuItem value="DECLINED">{t('simulation.hardware.pos.scenarioDeclined', 'Card Declined / Wrong PIN (Code: 51)')}</MenuItem>
                          <MenuItem value="NETWORK_DROP">{t('simulation.hardware.pos.scenarioNetworkDrop', 'Network Connection Drop / Socket Reset')}</MenuItem>
                        </Select>
                      </FormControl>

                      <Stack direction="row" spacing={2}>
                        <TextField
                          label={t('simulation.hardware.pos.amount', 'Amount (IRR)')}
                          size="small"
                          fullWidth
                          value={posAmount}
                          onChange={(e) => setPosAmount(e.target.value)}
                        />
                        <TextField
                          label={t('simulation.hardware.pos.latency', 'Latency (ms)')}
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
                        sx={{ fontWeight: 'bold' }}
                      >
                        {posTesting
                          ? t('simulation.hardware.pos.testing', 'Transmitting to Simulated POS...')
                          : t('simulation.hardware.pos.simulateBtn', 'Simulate POS Transaction')}
                      </Button>
                    </Stack>
                  </Card>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                  <Card variant="outlined" sx={{ p: 3, height: '100%', borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                      {t('simulation.hardware.pos.responseTitle', 'Terminal Response & Telemetry')}
                    </Typography>
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

                        <Paper variant="outlined" sx={{ p: 2, bgcolor: '#1e1e1e', color: '#00ffcc', fontFamily: 'monospace', fontSize: 13 }}>
                          <pre style={{ margin: 0 }}>{JSON.stringify(posResult, null, 2)}</pre>
                        </Paper>
                      </Stack>
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                        <Typography>{t('simulation.hardware.pos.placeholder', 'Trigger a transaction to inspect live terminal response.')}</Typography>
                      </Box>
                    )}
                  </Card>
                </Grid>
              </Grid>
            )}

            {tab === 'PRINTERS' && (
              <Stack spacing={3}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('simulation.hardware.printers.title', 'Configured Printers & Hardware Sensors')}
                </Typography>
                <Grid container spacing={2}>
                  {printers.map((p) => {
                    const st = printerStatuses[p.id] || { status: 'ONLINE', paper: true, cover: true };
                    return (
                      <Grid key={p.id} size={{ xs: 12, md: 6, lg: 4 }}>
                        <Card variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
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
                              <Typography variant="body2">{t('simulation.hardware.printers.paperSensor', 'Paper Roll Sensor')}:</Typography>
                              <Button
                                size="small"
                                variant={st.paper ? 'outlined' : 'contained'}
                                color={st.paper ? 'primary' : 'error'}
                                onClick={() => handleTogglePrinterPaper(p.id)}
                              >
                                {st.paper
                                  ? t('simulation.hardware.printers.paperOk', 'Paper OK')
                                  : t('simulation.hardware.printers.triggerPaperOut', 'Trigger Paper Out')}
                              </Button>
                            </Stack>

                            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                              <Typography variant="body2">{t('simulation.hardware.printers.coverSensor', 'Cover Sensor')}:</Typography>
                              <Button
                                size="small"
                                variant={st.cover ? 'outlined' : 'contained'}
                                color={st.cover ? 'primary' : 'warning'}
                                onClick={() => handleTogglePrinterCover(p.id)}
                              >
                                {st.cover
                                  ? t('simulation.hardware.printers.coverClosed', 'Cover Closed')
                                  : t('simulation.hardware.printers.triggerCoverOpen', 'Trigger Cover Open')}
                              </Button>
                            </Stack>

                            <Button
                              variant="contained"
                              color="secondary"
                              size="small"
                              onClick={() => handleTestPrint(p)}
                              disabled={printTesting === p.id}
                              sx={{ mt: 1, fontWeight: 'bold' }}
                            >
                              {printTesting === p.id
                                ? t('simulation.hardware.printers.testingSlip', 'Testing Slip...')
                                : t('simulation.hardware.printers.testPrintSlip', 'Test Print Slip')}
                            </Button>
                          </Stack>
                        </Card>
                      </Grid>
                    );
                  })}
                </Grid>

                {printResult && (
                  <Card variant="outlined" sx={{ p: 3, mt: 2, borderRadius: 2 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                      {t('simulation.hardware.printers.jobResult', 'Print Job Result:')} {printResult.printerName}
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
                  <Card variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                      {t('simulation.hardware.gateway.title', 'Tara Digital Wallet & IPG Gateway')}
                    </Typography>
                    <Stack spacing={2.5}>
                      <FormControl fullWidth size="small">
                        <InputLabel>{t('simulation.hardware.gateway.actionLabel', 'Gateway Action')}</InputLabel>
                        <Select
                          value={gatewayAction}
                          label={t('simulation.hardware.gateway.actionLabel', 'Gateway Action')}
                          onChange={(e) => setGatewayAction(e.target.value)}
                        >
                          <MenuItem value="AUTHORIZE">{t('simulation.hardware.gateway.authorize', 'Authorize Payment (OTP Required)')}</MenuItem>
                          <MenuItem value="CAPTURE">{t('simulation.hardware.gateway.capture', 'Direct Capture / Settle')}</MenuItem>
                          <MenuItem value="BALANCE_INQUIRY">{t('simulation.hardware.gateway.balanceInquiry', 'Customer Credit Limit Inquiry')}</MenuItem>
                          <MenuItem value="REFUND">{t('simulation.hardware.gateway.refund', 'Reverse / Refund Wallet Payment')}</MenuItem>
                        </Select>
                      </FormControl>

                      <TextField
                        label={t('simulation.hardware.gateway.customerMobile', 'Customer Mobile')}
                        size="small"
                        fullWidth
                        value={gatewayMobile}
                        onChange={(e) => setGatewayMobile(e.target.value)}
                      />

                      <TextField
                        label={t('simulation.hardware.gateway.amount', 'Transaction Amount (IRR)')}
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
                        sx={{ fontWeight: 'bold' }}
                      >
                        {gatewayTesting
                          ? t('simulation.hardware.gateway.executing', 'Executing Gateway Call...')
                          : t('simulation.hardware.gateway.executeBtn', 'Execute Gateway Command')}
                      </Button>
                    </Stack>
                  </Card>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                  <Card variant="outlined" sx={{ p: 3, height: '100%', borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                      {t('simulation.hardware.gateway.responseTitle', 'Gateway Transaction Log')}
                    </Typography>
                    {gatewayResult ? (
                      <Paper variant="outlined" sx={{ p: 2, bgcolor: '#1e1e1e', color: '#ffcc00', fontFamily: 'monospace', fontSize: 13 }}>
                        <pre style={{ margin: 0 }}>{JSON.stringify(gatewayResult, null, 2)}</pre>
                      </Paper>
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                        <Typography>{t('simulation.hardware.gateway.placeholder', 'Execute a gateway action to view response payload.')}</Typography>
                      </Box>
                    )}
                  </Card>
                </Grid>
              </Grid>
            )}

            {tab === 'HISTORY' && (
              <Stack spacing={2}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('simulation.hardware.history.title', 'Recent Hardware Simulation Events')}
                </Typography>
                {simLogs.map((log, idx) => (
                  <Card key={idx} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
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
                  <Alert severity="info">{t('simulation.hardware.history.noLogs', 'No simulation events recorded yet. Run a POS or printer test above.')}</Alert>
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
