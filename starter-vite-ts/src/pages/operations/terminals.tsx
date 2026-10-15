import type { PaymentDevice } from 'src/api/paymentApi';
import type { PrinterDevice } from 'src/api/printingApi';
import type { Branch, Terminal } from 'src/api/tenantApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Box,
  Card,
  Chip,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Drawer,
  Select,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  InputLabel,
  CardContent,
  FormControl,
  FormHelperText,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { tenantApi } from 'src/api/tenantApi';
import { paymentApi } from 'src/api/paymentApi';
import { printingApi } from 'src/api/printingApi';
import { useScopedBranchId } from 'src/contexts/branch-context';

import { VersionTag } from 'src/components/version-tag';
import { ConfirmDialog } from 'src/components/confirm-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

export function TerminalsPage() {
  const { t } = useTranslation();

  const [terminals, setTerminals] = useState<Terminal[]>([]);
  // Card terminals the branch agent drives: what a kiosk can charge its guests on.
  const [cardTerminals, setCardTerminals] = useState<PaymentDevice[]>([]);
  // Printers a till's receipts can print on.
  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  // The header's switcher is the only branch filter; head office lists every branch.
  const [selectedBranchId] = useScopedBranchId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  // The register being edited; null while adding a new one.
  const [editing, setEditing] = useState<Terminal | null>(null);
  const [name, setName] = useState('');
  const [terminalType, setTerminalType] = useState<'CASHIER' | 'KIOSK'>('CASHIER');

  // Confirm dialog state for archive
  const [archiveConfirm, setArchiveConfirm] = useState<{ id: string; name: string; code: string; open: boolean }>({
    open: false,
    id: '',
    name: '',
    code: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const bList = await tenantApi.getBranches();
      setBranches(bList || []);
      const tList = await tenantApi.getTerminals(selectedBranchId || undefined);
      setTerminals(tList || []);
      const devices = await paymentApi.getDevices(selectedBranchId || undefined).catch(() => []);
      setCardTerminals((devices || []).filter((d) => d.is_active && d.agent_connection && d.agent_driver));
      const printerList = await printingApi.getPrinters(selectedBranchId || undefined).catch(() => []);
      setPrinters((printerList || []).filter((p) => p.is_active));
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.terminals.loadError', 'Failed to load terminals'));
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setTerminalType('CASHIER');
    setDrawerOpen(true);
  };

  const openEdit = (terminal: Terminal) => {
    setEditing(terminal);
    setName(terminal.name);
    setTerminalType(terminal.terminal_type === 'KIOSK' ? 'KIOSK' : 'CASHIER');
    setDrawerOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (editing) {
      try {
        await tenantApi.updateTerminal(editing.id, { name });
        setDrawerOpen(false);
        setEditing(null);
        setSuccess(t('operations.terminals.editSuccess', { name }));
        loadData();
      } catch (err: any) {
        setError(err.detail || err.message || t('operations.terminals.editError'));
      }
      return;
    }
    try {
      // The page opens only with a branch picked in the header, and the register joins it.
      // The server numbers it for the branch (POS-1, POS-2, KIOSK-1).
      await tenantApi.createTerminal({ branch_id: selectedBranchId, name, terminal_type: terminalType });
      setDrawerOpen(false);
      setName('');
      setSuccess(t('operations.terminals.createSuccess', 'Terminal created successfully'));
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.terminals.createError', 'Failed to create terminal'));
    }
  };

  const handleLinkCardTerminal = async (terminal: Terminal, deviceId: string) => {
    try {
      await tenantApi.updateTerminal(terminal.id, { payment_device_id: deviceId || null });
      setSuccess(t('operations.terminals.cardLinked', 'Card terminal saved for {{name}}', { name: terminal.name }));
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.terminals.cardLinkError', 'Could not link the card terminal'));
    }
  };

  const handleReceiptSetting = async (
    terminal: Terminal,
    patch: Pick<Terminal, 'receipt_printer_id' | 'receipt_template'>
  ) => {
    try {
      await tenantApi.updateTerminal(terminal.id, patch);
      setSuccess(t('operations.terminals.receiptSaved', { name: terminal.name }));
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.terminals.receiptError'));
    }
  };

  // Tills with no receipt printer of their own print at the branch's default one (K-23).
  const receiptDefault = printers.find((p) => p.branch_id === selectedBranchId && p.receipt_default);
  const handleReceiptDefault = async (printerId: string) => {
    try {
      const printer = await printingApi.setReceiptDefault(printerId);
      setSuccess(t('operations.terminals.receiptDefaultSaved', { name: printer.name }));
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.terminals.receiptDefaultError'));
    }
  };

  const handleConfirmArchive = async () => {
    try {
      await tenantApi.archiveTerminal(archiveConfirm.id);
      setArchiveConfirm({ open: false, id: '', name: '', code: '' });
      setSuccess(t('operations.terminals.archiveSuccess', 'Terminal archived successfully'));
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.terminals.archiveError', 'Failed to archive terminal'));
    }
  };

  const getTypeChipColor = (type: string) => {
    switch (type) {
      case 'CASHIER': return 'primary';
      case 'KIOSK': return 'secondary';
      default: return 'default';
    }
  };

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('operations.terminals.title', 'Terminal Registry')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('operations.terminals.title', 'Terminal Registry') },
        ]}
        action={
          <Stack direction="row" spacing={1.5}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
              {t('common.refresh', 'Refresh')}
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={openCreate}
              sx={{ fontWeight: 'bold' }}
            >
              {t('operations.terminals.addTerminal', 'Add Terminal')}
            </Button>
          </Stack>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {selectedBranchId && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3, alignItems: { sm: 'center' } }}>
          <Select
            size="small"
            displayEmpty
            value={receiptDefault?.id || ''}
            onChange={(e) => e.target.value && handleReceiptDefault(e.target.value)}
            sx={{ minWidth: 240 }}
            inputProps={{ 'aria-label': t('operations.terminals.receiptDefault') }}
            renderValue={(id) =>
              `${t('operations.terminals.receiptDefault')}: ${
                printers.find((p) => p.id === id)?.name || t('operations.terminals.receiptDefaultNone')
              }`
            }
          >
            {printers
              .filter((p) => p.branch_id === selectedBranchId)
              .map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
          </Select>
          <Typography variant="body2" color="text.secondary">
            {t('operations.terminals.receiptDefaultHelp')}
          </Typography>
        </Stack>
      )}

      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 0 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('operations.terminals.colCode', 'Code')}</TableCell>
                  <TableCell>{t('operations.terminals.colName', 'Terminal Name')}</TableCell>
                  <TableCell>{t('operations.terminals.colType', 'Terminal Type')}</TableCell>
                  <TableCell>{t('operations.terminals.colBranch', 'Branch')}</TableCell>
                  <TableCell>{t('operations.terminals.colCardTerminal', 'Card terminal')}</TableCell>
                  <TableCell>{t('operations.terminals.colReceipts')}</TableCell>
                  <TableCell>{t('operations.terminals.colStatus', 'Status')}</TableCell>
                  <TableCell align="center">{t('operations.terminals.colActions', 'Actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                      <CircularProgress size={32} />
                    </TableCell>
                  </TableRow>
                ) : terminals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">
                        {t('operations.terminals.noTerminals', 'No terminals found for this selection.')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  terminals.map((item) => {
                    const branchObj = branches.find((b) => b.id === item.branch_id);
                    return (
                      <TableRow key={item.id} hover>
                        <TableCell><code>{item.code}</code></TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>{item.name}</TableCell>
                        <TableCell>
                          <Chip
                            label={t(`operations.terminals.types.${item.terminal_type === 'CASHIER' ? 'POS' : item.terminal_type}`, item.terminal_type)}
                            color={getTypeChipColor(item.terminal_type) as any}
                            size="small"
                            sx={{ fontWeight: 'bold' }}
                          />
                        </TableCell>
                        <TableCell>{branchObj ? `${branchObj.name} (${branchObj.code})` : '—'}</TableCell>
                        <TableCell>
                          {/* The card terminal (PC-POS) beside this register or kiosk: its card charges go there. */}
                          <Select
                              size="small"
                              displayEmpty
                              value={item.payment_device_id || ''}
                              onChange={(e) => handleLinkCardTerminal(item, e.target.value)}
                              sx={{ minWidth: 180 }}
                              inputProps={{ 'aria-label': t('operations.terminals.colCardTerminal', 'Card terminal') }}
                            >
                              <MenuItem value="">{t('operations.terminals.cardAuto', "Branch's only terminal")}</MenuItem>
                              {cardTerminals
                                .filter((d) => !d.branch_id || d.branch_id === item.branch_id)
                                .map((d) => (
                                  <MenuItem key={d.id} value={d.id}>
                                    {d.name} ({d.code})
                                  </MenuItem>
                                ))}
                          </Select>
                        </TableCell>
                        <TableCell>
                            {/* Where this till's receipts, bills and courier slips come out. */}
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                              <Select
                                size="small"
                                displayEmpty
                                value={item.receipt_printer_id || ''}
                                onChange={(e) => handleReceiptSetting(item, { receipt_printer_id: e.target.value || null })}
                                sx={{ minWidth: 180 }}
                                inputProps={{ 'aria-label': t('operations.terminals.colReceipts') }}
                              >
                                <MenuItem value="">{t('operations.terminals.receiptBranchPrinter')}</MenuItem>
                                {printers
                                  .filter((p) => p.branch_id === item.branch_id)
                                  .map((p) => (
                                    <MenuItem key={p.id} value={p.id}>
                                      {p.name}
                                    </MenuItem>
                                  ))}
                              </Select>
                              <Select
                                size="small"
                                displayEmpty
                                value={item.receipt_template || ''}
                                onChange={(e) =>
                                  handleReceiptSetting(item, {
                                    receipt_template: (e.target.value || null) as Terminal['receipt_template'],
                                  })
                                }
                                inputProps={{ 'aria-label': t('operations.printers.ticketTemplate') }}
                              >
                                <MenuItem value="">{t('operations.printers.templates.DEFAULT')}</MenuItem>
                                <MenuItem value="COMPACT">{t('operations.printers.templates.COMPACT')}</MenuItem>
                                <MenuItem value="DETAILED">{t('operations.printers.templates.DETAILED')}</MenuItem>
                              </Select>
                            </Stack>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={item.is_active ? t('common.active', 'Active') : t('common.archived', 'Archived')}
                            color={item.is_active ? 'success' : 'default'}
                            size="small"
                          />
                        </TableCell>
                        <TableCell align="center" sx={{ whiteSpace: 'nowrap' }}>
                          <IconButton title={t('operations.terminals.edit')} onClick={() => openEdit(item)}>
                            <EditIcon />
                          </IconButton>
                          <IconButton
                            title={t('operations.terminals.archive', 'Archive Terminal')}
                            color="error"
                            onClick={() => setArchiveConfirm({ open: true, id: item.id, name: item.name, code: item.code })}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create Terminal Drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditing(null);
        }}
      >
        <Box sx={{ width: { xs: 320, sm: 400 }, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            {editing ? t('operations.terminals.editTerminal') : t('operations.terminals.newTerminal', 'Add New Terminal')}
          </Typography>
          <form onSubmit={handleSubmit}>
            <Stack spacing={2.5}>
              <TextField
                label={t('operations.terminals.formName', 'Terminal Name')}
                placeholder="e.g. Cashier Counter 2"
                required
                fullWidth
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <FormControl fullWidth required disabled={!!editing}>
                <InputLabel>{t('operations.terminals.formType', 'Terminal Type')}</InputLabel>
                <Select
                  value={terminalType}
                  label={t('operations.terminals.formType', 'Terminal Type')}
                  onChange={(e) => setTerminalType(e.target.value as any)}
                >
                  <MenuItem value="CASHIER">{t('operations.terminals.types.POS', 'CASHIER (POS Touch)')}</MenuItem>
                  <MenuItem value="KIOSK">{t('operations.terminals.types.KIOSK', 'KIOSK (Self-Service)')} <VersionTag feature="terminals.kiosk" sx={{ ml: 1 }} /></MenuItem>
                </Select>
                {editing && <FormHelperText>{t('operations.terminals.typeLocked')}</FormHelperText>}
              </FormControl>

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                {t('operations.terminals.saveTerminal', 'Save Terminal')}
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>

      {/* Archive Confirm Dialog */}
      <ConfirmDialog
        open={archiveConfirm.open}
        onClose={() => setArchiveConfirm({ open: false, id: '', name: '', code: '' })}
        onConfirm={handleConfirmArchive}
        title={t('operations.terminals.archiveConfirmTitle', 'Archive Terminal')}
        content={t(
          'operations.terminals.archiveConfirmContent',
          'Are you sure you want to archive terminal "{{name}}" ({{code}})?',
          { name: archiveConfirm.name, code: archiveConfirm.code }
        )}
        confirmLabel={t('operations.terminals.archive', 'Archive')}
        confirmColor="warning"
      />
    </Box>
  );
}
