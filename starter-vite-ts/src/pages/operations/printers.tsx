import type { Branch } from 'src/api/tenantApi';
import type { PrinterDevice, PrinterConnection } from 'src/api/kdsApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import SensorsIcon from '@mui/icons-material/Sensors';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import {
  Box,
  Card,
  Chip,
  Table,
  Stack,
  Alert,
  Button,
  Dialog,
  Select,
  Switch,
  TableRow,
  MenuItem,
  useTheme,
  Snackbar,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  InputLabel,
  DialogTitle,
  FormControl,
  DialogContent,
  DialogActions,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';

import { RouterLink } from 'src/routes/components';

import { kdsApi } from 'src/api/kdsApi';
import { tenantApi } from 'src/api/tenantApi';
import { canReachPath } from 'src/config/role-access';
import { useScopedBranchId } from 'src/contexts/branch-context';
import { useAuthStore, useIsHeadOffice } from 'src/store/useAuthStore';

import { ConfirmDialog } from 'src/components/confirm-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

export function PrintersPage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const role = useAuthStore((state) => state.user?.role);
  const isHeadOffice = useIsHeadOffice();
  // The simulator is head office's sandbox; a branch manager's copy of this button opened
  // a page the router then refused.
  const canOpenSimulator = canReachPath(role, '/app/simulation/payments-printers', isHeadOffice);

  // Master Data States
  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  // The header's switcher is the only branch filter; head office lists every branch.
  const [selectedBranchId] = useScopedBranchId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testSuccessMsg, setTestSuccessMsg] = useState<string | null>(null);
  // The printer whose test page is out, so its button cannot send a second one meanwhile.
  const [testingId, setTestingId] = useState<string | null>(null);

  // Deletion confirm dialog state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: string;
    name?: string;
    open: boolean;
    type: 'PRINTER';
  }>({
    open: false,
    id: '',
    name: '',
    type: 'PRINTER',
  });

  // Printer Modals (Add / Edit)
  const [printerModalOpen, setPrinterModalOpen] = useState(false);
  const [editingPrinterId, setEditingPrinterId] = useState<string | null>(null);
  const [printerForm, setPrinterForm] = useState({
    code: '',
    name: '',
    printer_type: 'THERMAL_RECEIPT',
    simulated_address: '192.168.1.100:9100',
    paper_width_mm: 80,
    fallback_printer_id: '',
    is_active: true,
    branch_id: '',
  });

  // How the branch agent reaches the printer, kept apart from the form the API takes as is.
  const [connForm, setConnForm] = useState<ConnectionForm>(EMPTY_CONNECTION);
  // The connection the printer was saved with. Windows and serial are offered only to a printer
  // that already has one, so editing it does not silently lose the setting.
  const [savedConnKind, setSavedConnKind] = useState<ConnectionForm['kind']>('none');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [prList, bList] = await Promise.all([
        kdsApi.getPrinters(selectedBranchId || undefined),
        tenantApi.getBranches().catch(() => []),
      ]);
      setPrinters(prList || []);
      setBranches(bList || []);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.printers.loadError', 'Failed to load printers configuration'));
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Active branch resolution helper
  const getActiveBranchId = () => selectedBranchId || branches[0]?.id || 'branch-1';

  // PRINTER HANDLERS
  const handleOpenAddPrinter = () => {
    setEditingPrinterId(null);
    setPrinterForm({
      code: '',
      name: '',
      printer_type: 'THERMAL_RECEIPT',
      simulated_address: '192.168.1.100:9100',
      paper_width_mm: 80,
      fallback_printer_id: '',
      is_active: true,
      branch_id: getActiveBranchId(),
    });
    setConnForm(EMPTY_CONNECTION);
    setSavedConnKind('none');
    setPrinterModalOpen(true);
  };

  const handleOpenEditPrinter = (pr: PrinterDevice) => {
    setEditingPrinterId(pr.id);
    setPrinterForm({
      code: pr.code,
      name: pr.name,
      printer_type: pr.printer_type || 'THERMAL_RECEIPT',
      simulated_address: pr.simulated_address || '192.168.1.100:9100',
      paper_width_mm: pr.paper_width_mm || 80,
      fallback_printer_id: pr.fallback_printer_id || '',
      is_active: pr.is_active !== false,
      branch_id: (pr as any).branch_id || getActiveBranchId(),
    });
    const conn = toConnectionForm(pr.agent_connection);
    setConnForm(conn);
    setSavedConnKind(conn.kind);
    setPrinterModalOpen(true);
  };

  const handleSavePrinter = async () => {
    if (!printerForm.code.trim() || !printerForm.name.trim()) {
      setError(t('common.requiredFields', 'Printer code and name are required.'));
      return;
    }

    if (editingPrinterId && printerForm.fallback_printer_id === editingPrinterId) {
      setError(t('operations.printers.cycleError', 'Printer cannot have itself as fallback printer.'));
      return;
    }

    const agent_connection = fromConnectionForm(connForm);
    try {
      if (editingPrinterId) {
        await kdsApi.updatePrinter(editingPrinterId, { ...printerForm, agent_connection } as any);
      } else {
        await kdsApi.createPrinter({
          ...printerForm,
          agent_connection,
          branch_id: printerForm.branch_id || getActiveBranchId(),
        } as any);
      }
      setPrinterModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.printers.createPrinterError', 'Failed to save printer'));
    }
  };

  // The test page goes through the branch agent like any job; the answer is the printer's own,
  // so the page waits for it (the agent gives a printer 60 seconds) rather than assume success.
  const handleTestPrintSlip = async (printer: PrinterDevice) => {
    const name = printer.name;
    setTestingId(printer.id);
    setTestSuccessMsg(t('operations.printers.testPrintSending', 'Sending a test page to {{name}}…', { name }));
    try {
      const sent = await kdsApi.testPrint(printer.id);
      const deadline = Date.now() + 75_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const job = await kdsApi.getPrintJobById(sent.id);
        if (job.status === 'SUCCESS') {
          setTestSuccessMsg(t('operations.printers.testPrintSuccess', '{{name}} printed the test page.', { name }));
          return;
        }
        if (job.status === 'FAILED') {
          const last = (job as any).attempts?.at(-1);
          setTestSuccessMsg(null);
          setError(
            t('operations.printers.testPrintFailed', '{{name}} did not print the test page: {{reason}}', {
              name,
              reason: last?.error_message || last?.error_code || '-',
            })
          );
          return;
        }
      }
      setTestSuccessMsg(
        t('operations.printers.testPrintNoAnswer', 'No answer from {{name}} yet. The print queue will show the result.', { name })
      );
    } catch (err: any) {
      setTestSuccessMsg(null);
      setError(err.detail || err.message || t('operations.printers.testPrintError', 'Could not send the test page.'));
    } finally {
      setTestingId(null);
    }
  };

  // DELETE HANDLER
  const handleConfirmDelete = async () => {
    try {
      await kdsApi.deletePrinter(deleteConfirm.id);
      setDeleteConfirm({ open: false, id: '', name: '', type: 'PRINTER' });
      loadData();
    } catch (err: any) {
      setError(err.detail || t('common.deleteError', 'Failed to delete item'));
    }
  };

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('operations.printers.title', 'Printers & Print Routing')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('operations.printers.title', 'Printers & Print Routing') },
        ]}
        action={
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Button
              component={RouterLink}
              href="/app/operations/print-queue"
              variant="outlined"
              color="primary"
              startIcon={<ReceiptLongIcon />}
            >
              {t('operations.printers.quickLinks.queue', 'Print Queue & Jobs')}
            </Button>
            {canOpenSimulator && (
              <Button
                component={RouterLink}
                href="/app/simulation/payments-printers"
                variant="outlined"
                color="warning"
                startIcon={<SensorsIcon />}
              >
                {t('operations.printers.quickLinks.simulator', 'Hardware Sensor Simulator')}
              </Button>
            )}
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
              {t('common.refresh', 'Refresh')}
            </Button>
          </Stack>
        }
      />

      <Alert
        severity="info"
        variant="outlined"
        icon={<SensorsIcon />}
        sx={{ mb: 3, borderRadius: 2, fontWeight: 500 }}
      >
        {t(
          'operations.printers.v5PreviewBanner',
          "Printers with a network connection print for real through this branch's agent. Printers without one are simulated: their jobs are marked printed and nothing comes out."
        )}
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Where each document prints is set where it belongs: kitchen chits on the prep stations,
          receipts and bills on the tills. */}
      <Alert severity="info" sx={{ mb: 3, borderRadius: 2 }}>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {t('operations.printers.routingHint')}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button component={RouterLink} href="/app/operations/kds-configuration" size="small" variant="outlined">
            {t('operations.printers.stationsLink')}
          </Button>
          <Button component={RouterLink} href="/app/operations/terminals" size="small" variant="outlined">
            {t('operations.printers.tillsLink')}
          </Button>
        </Stack>
      </Alert>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
            <Card sx={{ p: 3, borderRadius: 2 }}>
              <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('operations.printers.tabs.printers', 'Printers & Devices')}
                </Typography>
                <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenAddPrinter}>
                  {t('operations.printers.addPrinter', 'Add Printer')}
                </Button>
              </Stack>

              <Box sx={{ overflowX: 'auto' }}>
              <Table sx={{ minWidth: 760 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('operations.printers.colCode', 'Code')}</TableCell>
                    <TableCell>{t('operations.printers.colName', 'Printer Name')}</TableCell>
                    <TableCell>{t('operations.printers.colType', 'Type')}</TableCell>
                    <TableCell>{t('operations.printers.colAddress', 'Network Address')}</TableCell>
                    <TableCell>{t('operations.printers.colPaper', 'Paper Width')}</TableCell>
                    <TableCell>{t('operations.printers.colFallback', 'Fallback Printer')}</TableCell>
                    <TableCell>{t('operations.printers.colStatus', 'Status')}</TableCell>
                    <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                      {t('operations.printers.colActions', 'Actions')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {printers.map((pr) => {
                    const fb = printers.find((p) => p.id === pr.fallback_printer_id);
                    return (
                      <TableRow key={pr.id}>
                        <TableCell><strong>{pr.code}</strong></TableCell>
                        <TableCell>{pr.name}</TableCell>
                        <TableCell>
                          <Chip
                            label={t(`operations.printers.types.${pr.printer_type}`, pr.printer_type)}
                            color="primary"
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          {pr.agent_connection ? (
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                              <Chip label={t('operations.printers.connection.agentChip', 'Agent')} color="info" size="small" />
                              <code dir="ltr">{describeConnection(pr.agent_connection)}</code>
                            </Stack>
                          ) : (
                            <code>{pr.simulated_address || '192.168.1.100:9100'}</code>
                          )}
                        </TableCell>
                        <TableCell>{pr.paper_width_mm}mm</TableCell>
                        <TableCell>
                          {fb ? (
                            <Chip label={fb.name} color="warning" size="small" />
                          ) : (
                            <Typography variant="caption" color="text.secondary">{t('operations.printers.noneFallback', 'None')}</Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={pr.is_active !== false ? 'ACTIVE' : 'INACTIVE'}
                            color={pr.is_active !== false ? 'success' : 'default'}
                            size="small"
                          />
                        </TableCell>
                        <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                          <Stack direction="row" spacing={0.5} sx={{ justifyContent: theme.direction === 'rtl' ? 'flex-start' : 'flex-end' }}>
                            <IconButton
                              color="info"
                              size="small"
                              title={t('operations.printers.testPrint', 'Test Slip')}
                              disabled={testingId === pr.id}
                              onClick={() => handleTestPrintSlip(pr)}
                            >
                              <PlayArrowIcon />
                            </IconButton>
                            <IconButton
                              color="primary"
                              size="small"
                              title={t('operations.printers.editPrinter', 'Edit Printer')}
                              onClick={() => handleOpenEditPrinter(pr)}
                            >
                              <EditIcon />
                            </IconButton>
                            <IconButton
                              color="error"
                              size="small"
                              onClick={() =>
                                setDeleteConfirm({
                                  open: true,
                                  id: pr.id,
                                  name: pr.name,
                                  type: 'PRINTER',
                                })
                              }
                            >
                              <DeleteIcon />
                            </IconButton>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {printers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                        {t('common.noRecords', 'No printers found. Click "Add Printer" to create one.')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </Box>
            </Card>
      )}

      {/* Add/Edit Printer Modal */}
      <Dialog open={printerModalOpen} onClose={() => setPrinterModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingPrinterId
            ? t('operations.printers.editPrinterModal', 'Edit Thermal / Network Printer')
            : t('operations.printers.createPrinterModal', 'Configure Thermal / Network Printer')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t('operations.printers.formCode', 'Printer Code')}
              value={printerForm.code}
              onChange={(e) => setPrinterForm({ ...printerForm, code: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label={t('operations.printers.formName', 'Printer Name')}
              value={printerForm.name}
              onChange={(e) => setPrinterForm({ ...printerForm, name: e.target.value })}
              fullWidth
              required
            />
            <FormControl fullWidth>
              <InputLabel>{t('operations.printers.formType', 'Printer Type')}</InputLabel>
              <Select
                value={printerForm.printer_type}
                label={t('operations.printers.formType', 'Printer Type')}
                onChange={(e) => setPrinterForm({ ...printerForm, printer_type: e.target.value })}
              >
                <MenuItem value="THERMAL_RECEIPT">{t('operations.printers.types.THERMAL_RECEIPT', 'Thermal Customer Receipt (80mm)')}</MenuItem>
                <MenuItem value="KITCHEN_IMPACT">{t('operations.printers.types.KITCHEN_IMPACT', 'Kitchen Impact / Dot Matrix (80mm)')}</MenuItem>
                <MenuItem value="LABEL_STICKER">{t('operations.printers.types.LABEL_STICKER', 'Cup / Item Label Sticker')}</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>{t('operations.printers.connection.kind', 'Connection')}</InputLabel>
              <Select
                value={connForm.kind}
                label={t('operations.printers.connection.kind', 'Connection')}
                onChange={(e) => setConnForm({ ...connForm, kind: e.target.value as ConnectionForm['kind'] })}
              >
                <MenuItem value="none">{t('operations.printers.connection.none', 'Simulated (no branch agent)')}</MenuItem>
                <MenuItem value="tcp">{t('operations.printers.connection.tcp', 'Network printer (TCP)')}</MenuItem>
                {/* The branch agent prints over TCP only; see Supported() in agent/internal/printing. */}
                {savedConnKind === 'windows' && (
                  <MenuItem value="windows">{t('operations.printers.connection.windows', 'Printer installed in Windows')}</MenuItem>
                )}
                {savedConnKind === 'serial' && (
                  <MenuItem value="serial">{t('operations.printers.connection.serial', 'Serial port')}</MenuItem>
                )}
              </Select>
            </FormControl>
            {connForm.kind === 'none' && (
              <TextField
                label={t('operations.printers.formAddress', 'Simulated Address / IP Port')}
                value={printerForm.simulated_address}
                onChange={(e) => setPrinterForm({ ...printerForm, simulated_address: e.target.value })}
                fullWidth
              />
            )}
            {connForm.kind === 'tcp' && (
              <Stack direction="row" spacing={2}>
                <TextField
                  label={t('operations.printers.connection.host', 'IP address')}
                  value={connForm.host}
                  onChange={(e) => setConnForm({ ...connForm, host: e.target.value })}
                  placeholder="192.168.1.50"
                  slotProps={{ htmlInput: { dir: 'ltr' } }}
                  fullWidth
                  required
                />
                <TextField
                  label={t('operations.printers.connection.port', 'Port')}
                  type="number"
                  value={connForm.port}
                  onChange={(e) => setConnForm({ ...connForm, port: e.target.value })}
                  sx={{ width: 140 }}
                  required
                />
              </Stack>
            )}
            {connForm.kind === 'windows' && (
              <TextField
                label={t('operations.printers.connection.printerName', 'Windows printer name')}
                helperText={t('operations.printers.connection.printerNameHelp', 'Exactly as it appears in Windows under Printers & scanners.')}
                value={connForm.printerName}
                onChange={(e) => setConnForm({ ...connForm, printerName: e.target.value })}
                slotProps={{ htmlInput: { dir: 'ltr' } }}
                fullWidth
                required
              />
            )}
            {connForm.kind === 'serial' && (
              <Stack direction="row" spacing={2}>
                <TextField
                  label={t('operations.printers.connection.serialPort', 'Serial port')}
                  value={connForm.serialPort}
                  onChange={(e) => setConnForm({ ...connForm, serialPort: e.target.value.toUpperCase() })}
                  placeholder="COM3"
                  slotProps={{ htmlInput: { dir: 'ltr' } }}
                  fullWidth
                  required
                />
                <FormControl sx={{ width: 160 }}>
                  <InputLabel>{t('operations.printers.connection.baud', 'Baud rate')}</InputLabel>
                  <Select
                    value={connForm.baud}
                    label={t('operations.printers.connection.baud', 'Baud rate')}
                    onChange={(e) => setConnForm({ ...connForm, baud: String(e.target.value) })}
                  >
                    {BAUD_RATES.map((b) => (
                      <MenuItem key={b} value={b}>
                        {b}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            )}
            {(connForm.kind === 'windows' || connForm.kind === 'serial') && (
              <Alert severity="warning">
                {t(
                  'operations.printers.connection.notSupported',
                  'The branch agent cannot print through this connection yet. Connect the printer to the network and choose Network printer (TCP).'
                )}
              </Alert>
            )}
            {connForm.kind === 'tcp' && (
              <Alert severity="info">
                {t(
                  'operations.printers.connection.agentHelp',
                  'Jobs for this printer go to the branch agent. While the agent is offline they wait in the print queue.'
                )}
              </Alert>
            )}
            <TextField
              label={t('operations.printers.formPaper', 'Paper Width (mm)')}
              type="number"
              value={printerForm.paper_width_mm}
              onChange={(e) => setPrinterForm({ ...printerForm, paper_width_mm: Number(e.target.value) })}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>{t('operations.printers.formFallback', 'Fallback Backup Printer')}</InputLabel>
              <Select
                value={printerForm.fallback_printer_id}
                label={t('operations.printers.formFallback', 'Fallback Backup Printer')}
                onChange={(e) => setPrinterForm({ ...printerForm, fallback_printer_id: e.target.value })}
              >
                <MenuItem value="">{t('operations.printers.noneFallback', 'None')}</MenuItem>
                {printers
                  .filter((p) => p.id !== editingPrinterId)
                  .map((p) => (
                    <MenuItem key={p.id} value={p.id}>{p.name} ({p.code})</MenuItem>
                  ))}
              </Select>
            </FormControl>

            <FormControlLabel
              control={
                <Switch
                  checked={printerForm.is_active}
                  onChange={(e) => setPrinterForm({ ...printerForm, is_active: e.target.checked })}
                />
              }
              label={t('operations.printers.formActive', 'Device Status Active')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPrinterModalOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleSavePrinter}>
            {editingPrinterId
              ? t('operations.printers.editPrinterBtn', 'Save Printer Changes')
              : t('operations.printers.createPrinterBtn', 'Create Printer Device')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: '', name: '', type: 'PRINTER' })}
        onConfirm={handleConfirmDelete}
        title={t('operations.printers.deletePrinterTitle', 'Delete Printer Device')}
        content={t('operations.printers.deletePrinterContent', { name: deleteConfirm.name })}
        confirmLabel={t('common.delete', 'Delete')}
        confirmColor="error"
      />

      {/* Test Print Toast */}
      <Snackbar
        open={Boolean(testSuccessMsg)}
        autoHideDuration={4000}
        onClose={() => setTestSuccessMsg(null)}
        message={testSuccessMsg}
      />
    </Box>
  );
}

export default PrintersPage;

// ----------------------------------------------------------------------

type ConnectionForm = {
  kind: 'none' | 'tcp' | 'windows' | 'serial';
  host: string;
  port: string;
  printerName: string;
  serialPort: string;
  baud: string;
};

const BAUD_RATES = ['9600', '19200', '38400', '57600', '115200'];

const EMPTY_CONNECTION: ConnectionForm = {
  kind: 'none',
  host: '',
  port: '9100',
  printerName: '',
  serialPort: '',
  baud: '9600',
};

function toConnectionForm(c?: PrinterConnection | null): ConnectionForm {
  if (!c) return EMPTY_CONNECTION;
  switch (c.kind) {
    case 'tcp':
      return { ...EMPTY_CONNECTION, kind: 'tcp', host: c.host, port: String(c.port) };
    case 'windows':
      return { ...EMPTY_CONNECTION, kind: 'windows', printerName: c.printer_name };
    case 'serial':
      return { ...EMPTY_CONNECTION, kind: 'serial', serialPort: c.port, baud: String(c.baud) };
    default:
      return EMPTY_CONNECTION;
  }
}

/** What the API takes; the server checks that it is complete. */
function fromConnectionForm(f: ConnectionForm): PrinterConnection | null {
  switch (f.kind) {
    case 'tcp':
      return { kind: 'tcp', host: f.host.trim(), port: Number(f.port) };
    case 'windows':
      return { kind: 'windows', printer_name: f.printerName.trim() };
    case 'serial':
      return { kind: 'serial', port: f.serialPort.trim(), baud: Number(f.baud) };
    default:
      return null;
  }
}

function describeConnection(c: PrinterConnection): string {
  switch (c.kind) {
    case 'tcp':
      return `${c.host}:${c.port}`;
    case 'windows':
      return c.printer_name;
    case 'serial':
      return `${c.port} @ ${c.baud}`;
    default:
      return '';
  }
}
