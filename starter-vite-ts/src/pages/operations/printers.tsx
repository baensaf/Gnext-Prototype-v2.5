import type { Branch } from 'src/api/tenantApi';
import type { PrintRoute, PrinterGroup, PrinterDevice } from 'src/api/kdsApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import PrintIcon from '@mui/icons-material/Print';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Box,
  Tab,
  Card,
  Tabs,
  Chip,
  Table,
  Stack,
  Alert,
  Paper,
  Button,
  Dialog,
  Select,
  TableRow,
  MenuItem,
  useTheme,
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
  CircularProgress,
} from '@mui/material';

import { kdsApi } from 'src/api/kdsApi';
import { tenantApi } from 'src/api/tenantApi';

import { ConfirmDialog } from 'src/components/confirm-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

export function PrintersPage() {
  const { t } = useTranslation();
  const theme = useTheme();

  const [tab, setTab] = useState<'PRINTERS' | 'GROUPS' | 'ROUTES'>('PRINTERS');

  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [groups, setGroups] = useState<PrinterGroup[]>([]);
  const [routes, setRoutes] = useState<PrintRoute[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Deletion confirm dialog state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: string;
    name?: string;
    open: boolean;
    type: 'PRINTER' | 'GROUP' | 'ROUTE';
  }>({
    open: false,
    id: '',
    name: '',
    type: 'PRINTER',
  });

  // Dialogs
  const [printerModalOpen, setPrinterModalOpen] = useState(false);
  const [printerForm, setPrinterForm] = useState({
    code: '',
    name: '',
    printer_type: 'THERMAL_RECEIPT',
    simulated_address: '192.168.1.100:9100',
    paper_width_mm: 80,
    fallback_printer_id: '',
  });

  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupForm, setGroupForm] = useState({ code: '', name: '' });

  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [routeForm, setRouteForm] = useState({
    document_type: 'CUSTOMER_RECEIPT',
    printer_group_id: '',
    priority: 1,
    copies: 1,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [prList, grList, rtList, bList] = await Promise.all([
        kdsApi.getPrinters(),
        kdsApi.getPrinterGroups(),
        kdsApi.getPrintRoutes(),
        tenantApi.getBranches().catch(() => []),
      ]);
      setPrinters(prList || []);
      setGroups(grList || []);
      setRoutes(rtList || []);
      setBranches(bList || []);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.printers.loadError', 'Failed to load printers configuration'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreatePrinter = async () => {
    try {
      const targetBranchId = (printers[0] as any)?.branch_id || branches[0]?.id || 'branch-1';
      await kdsApi.createPrinter({
        branch_id: targetBranchId,
        ...printerForm,
      } as any);
      setPrinterModalOpen(false);
      setPrinterForm({ code: '', name: '', printer_type: 'THERMAL_RECEIPT', simulated_address: '192.168.1.100:9100', paper_width_mm: 80, fallback_printer_id: '' });
      loadData();
    } catch (err: any) {
      setError(err.detail || t('operations.printers.createPrinterError', 'Failed to create printer'));
    }
  };

  const handleConfirmDelete = async () => {
    try {
      if (deleteConfirm.type === 'PRINTER') {
        await kdsApi.deletePrinter(deleteConfirm.id);
      } else if (deleteConfirm.type === 'GROUP') {
        await kdsApi.deletePrinterGroup(deleteConfirm.id);
      } else if (deleteConfirm.type === 'ROUTE') {
        await kdsApi.deletePrintRoute(deleteConfirm.id);
      }
      setDeleteConfirm({ open: false, id: '', name: '', type: 'PRINTER' });
      loadData();
    } catch (err: any) {
      setError(err.detail || t('common.deleteError', 'Failed to delete item'));
    }
  };

  const handleCreateGroup = async () => {
    try {
      const targetBranchId = (printers[0] as any)?.branch_id || branches[0]?.id || 'branch-1';
      await kdsApi.createPrinterGroup({
        branch_id: targetBranchId,
        ...groupForm,
      } as any);
      setGroupModalOpen(false);
      setGroupForm({ code: '', name: '' });
      loadData();
    } catch (err: any) {
      setError(err.detail || t('operations.printers.createGroupError', 'Failed to create printer group'));
    }
  };

  const handleCreateRoute = async () => {
    try {
      const targetBranchId = (printers[0] as any)?.branch_id || printers[0]?.id || (branches[0] as any)?.id;
      if (!targetBranchId) {
        setError(t('operations.printers.noContextError', 'No active printer/branch context'));
        return;
      }
      await kdsApi.createPrintRoute({
        branch_id: targetBranchId,
        ...routeForm,
      });
      setRouteModalOpen(false);
      setRouteForm({ document_type: 'CUSTOMER_RECEIPT', printer_group_id: '', priority: 1, copies: 1 });
      loadData();
    } catch (err: any) {
      setError(err.detail || t('operations.printers.createRouteError', 'Failed to create print route'));
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
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            {t('common.refresh', 'Refresh')}
          </Button>
        }
      />

      <Alert severity="info" variant="outlined" sx={{ mb: 3, borderRadius: 2, fontWeight: 500 }}>
        {t(
          'operations.printers.v5PreviewBanner',
          'V5 Preview Module: Advanced ESC/POS printer device hardware models, station group matrix routing & fallback chains. Retained for V5 hardware integration testing.'
        )}
      </Alert>

      {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}

      <Paper sx={{ mb: 3, borderRadius: 2 }}>
        <Tabs value={tab} onChange={(_, val) => setTab(val)}>
          <Tab label={t('operations.printers.tabs.printers', 'Printers & Devices')} value="PRINTERS" />
          <Tab label={t('operations.printers.tabs.groups', 'Printer Groups')} value="GROUPS" />
          <Tab label={t('operations.printers.tabs.routes', 'Print Document Routes')} value="ROUTES" />
        </Tabs>
      </Paper>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {/* PRINTERS TAB */}
          {tab === 'PRINTERS' && (
            <Card sx={{ p: 3, borderRadius: 2 }}>
              <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('operations.printers.tabs.printers', 'Printers & Devices')} ({printers.length})
                </Typography>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setPrinterModalOpen(true)}>
                  {t('operations.printers.addPrinter', 'Add Printer')}
                </Button>
              </Stack>

              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('operations.printers.colCode', 'Code')}</TableCell>
                    <TableCell>{t('operations.printers.colName', 'Printer Name')}</TableCell>
                    <TableCell>{t('operations.printers.colType', 'Type')}</TableCell>
                    <TableCell>{t('operations.printers.colAddress', 'Network Address')}</TableCell>
                    <TableCell>{t('operations.printers.colPaper', 'Paper Width')}</TableCell>
                    <TableCell>{t('operations.printers.colFallback', 'Fallback Printer')}</TableCell>
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
                        <TableCell><code>{pr.simulated_address || '192.168.1.100'}</code></TableCell>
                        <TableCell>{pr.paper_width_mm}mm</TableCell>
                        <TableCell>
                          {fb ? (
                            <Chip label={fb.name} color="warning" size="small" />
                          ) : (
                            t('operations.printers.noneFallback', 'None')
                          )}
                        </TableCell>
                        <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                          <IconButton
                            color="error"
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
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}

          {/* GROUPS TAB */}
          {tab === 'GROUPS' && (
            <Card sx={{ p: 3, borderRadius: 2 }}>
              <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('operations.printers.tabs.groups', 'Printer Groups')} ({groups.length})
                </Typography>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setGroupModalOpen(true)}>
                  {t('operations.printers.addGroup', 'Add Printer Group')}
                </Button>
              </Stack>

              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('operations.printers.colCode', 'Group Code')}</TableCell>
                    <TableCell>{t('operations.printers.colName', 'Group Name')}</TableCell>
                    <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                      {t('operations.printers.colActions', 'Actions')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {groups.map((gr) => (
                    <TableRow key={gr.id}>
                      <TableCell><strong>{gr.code}</strong></TableCell>
                      <TableCell>{gr.name}</TableCell>
                      <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                        <IconButton
                          color="error"
                          onClick={() =>
                            setDeleteConfirm({
                              open: true,
                              id: gr.id,
                              name: gr.name,
                              type: 'GROUP',
                            })
                          }
                        >
                          <DeleteIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {/* ROUTES TAB */}
          {tab === 'ROUTES' && (
            <Card sx={{ p: 3, borderRadius: 2 }}>
              <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('operations.printers.tabs.routes', 'Print Document Routes')} ({routes.length})
                </Typography>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setRouteModalOpen(true)}>
                  {t('operations.printers.addRoute', 'Add Print Route')}
                </Button>
              </Stack>

              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('operations.printers.colPriority', 'Priority')}</TableCell>
                    <TableCell>{t('operations.printers.colDocType', 'Document Type')}</TableCell>
                    <TableCell>{t('operations.printers.colTargetGroup', 'Target Printer Group')}</TableCell>
                    <TableCell>{t('operations.printers.colCopies', 'Copies')}</TableCell>
                    <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                      {t('operations.printers.colActions', 'Actions')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {routes.map((rt) => {
                    const grp = groups.find((g) => g.id === rt.printer_group_id);
                    return (
                      <TableRow key={rt.id}>
                        <TableCell><Chip label={`P${rt.priority}`} color="primary" size="small" /></TableCell>
                        <TableCell>
                          <strong>{t(`operations.printers.docTypes.${rt.document_type}`, rt.document_type)}</strong>
                        </TableCell>
                        <TableCell>{grp ? grp.name : rt.printer_group_id}</TableCell>
                        <TableCell>{rt.copies} {t('operations.printers.colCopies', 'Copies')}</TableCell>
                        <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                          <IconButton
                            color="error"
                            onClick={() =>
                              setDeleteConfirm({
                                open: true,
                                id: rt.id,
                                name: rt.document_type,
                                type: 'ROUTE',
                              })
                            }
                          >
                            <DeleteIcon />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}

      {/* Add Printer Modal */}
      <Dialog open={printerModalOpen} onClose={() => setPrinterModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('operations.printers.createPrinterModal', 'Configure Thermal / Network Printer')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t('operations.printers.formCode', 'Printer Code')}
              value={printerForm.code}
              onChange={(e) => setPrinterForm({ ...printerForm, code: e.target.value })}
              fullWidth
            />
            <TextField
              label={t('operations.printers.formName', 'Printer Name')}
              value={printerForm.name}
              onChange={(e) => setPrinterForm({ ...printerForm, name: e.target.value })}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>{t('operations.printers.formType', 'Printer Type')}</InputLabel>
              <Select
                value={printerForm.printer_type}
                label={t('operations.printers.formType', 'Printer Type')}
                onChange={(e) => setPrinterForm({ ...printerForm, printer_type: e.target.value })}
              >
                <MenuItem value="THERMAL_RECEIPT">{t('operations.printers.types.THERMAL_RECEIPT', 'Thermal Receipt (80mm)')}</MenuItem>
                <MenuItem value="KITCHEN_IMPACT">{t('operations.printers.types.KITCHEN_IMPACT', 'Kitchen Impact / Dot Matrix')}</MenuItem>
                <MenuItem value="LABEL_STICKER">{t('operations.printers.types.LABEL_STICKER', 'Label Sticker')}</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label={t('operations.printers.formAddress', 'Simulated Network Address')}
              value={printerForm.simulated_address}
              onChange={(e) => setPrinterForm({ ...printerForm, simulated_address: e.target.value })}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>{t('operations.printers.formFallback', 'Fallback Printer')}</InputLabel>
              <Select
                value={printerForm.fallback_printer_id}
                label={t('operations.printers.formFallback', 'Fallback Printer')}
                onChange={(e) => setPrinterForm({ ...printerForm, fallback_printer_id: e.target.value })}
              >
                <MenuItem value="">{t('operations.printers.noneFallback', 'None')}</MenuItem>
                {printers.map((p) => (
                  <MenuItem key={p.id} value={p.id}>{p.name} ({p.code})</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPrinterModalOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleCreatePrinter}>
            {t('operations.printers.createPrinterBtn', 'Save Printer')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Group Modal */}
      <Dialog open={groupModalOpen} onClose={() => setGroupModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('operations.printers.createGroupModal', 'Create Printer Station Group')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t('operations.printers.colCode', 'Group Code')}
              value={groupForm.code}
              onChange={(e) => setGroupForm({ ...groupForm, code: e.target.value })}
              fullWidth
            />
            <TextField
              label={t('operations.printers.colName', 'Group Name')}
              value={groupForm.name}
              onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupModalOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleCreateGroup}>
            {t('operations.printers.createGroupBtn', 'Save Group')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Route Modal */}
      <Dialog open={routeModalOpen} onClose={() => setRouteModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('operations.printers.createRouteModal', 'Create Print Document Routing Rule')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>{t('operations.printers.formDocType', 'Document Type')}</InputLabel>
              <Select
                value={routeForm.document_type}
                label={t('operations.printers.formDocType', 'Document Type')}
                onChange={(e) => setRouteForm({ ...routeForm, document_type: e.target.value })}
              >
                <MenuItem value="CUSTOMER_RECEIPT">{t('operations.printers.docTypes.CUSTOMER_RECEIPT', 'Customer Sales Receipt')}</MenuItem>
                <MenuItem value="KITCHEN_TICKET">{t('operations.printers.docTypes.KITCHEN_TICKET', 'Kitchen Preparation Ticket')}</MenuItem>
                <MenuItem value="ITEM_LABEL">{t('operations.printers.docTypes.ITEM_LABEL', 'Individual Item Label')}</MenuItem>
                <MenuItem value="DELIVERY_SLIP">{t('operations.printers.docTypes.DELIVERY_SLIP', 'Courier Delivery Manifest')}</MenuItem>
                <MenuItem value="SHIFT_REPORT">{t('operations.printers.docTypes.SHIFT_REPORT', 'Shift Closure Report')}</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>{t('operations.printers.formPrinterGroup', 'Target Printer Group')}</InputLabel>
              <Select
                value={routeForm.printer_group_id}
                label={t('operations.printers.formPrinterGroup', 'Target Printer Group')}
                onChange={(e) => setRouteForm({ ...routeForm, printer_group_id: e.target.value })}
              >
                {groups.map((g) => (
                  <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label={t('operations.printers.formCopies', 'Number of Copies')}
              type="number"
              value={routeForm.copies}
              onChange={(e) => setRouteForm({ ...routeForm, copies: Number(e.target.value) })}
              fullWidth
            />
            <TextField
              label={t('operations.printers.formPriority', 'Priority (1=Highest)')}
              type="number"
              value={routeForm.priority}
              onChange={(e) => setRouteForm({ ...routeForm, priority: Number(e.target.value) })}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRouteModalOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleCreateRoute}>
            {t('operations.printers.createRouteBtn', 'Save Route')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: '', name: '', type: 'PRINTER' })}
        onConfirm={handleConfirmDelete}
        title={
          deleteConfirm.type === 'PRINTER'
            ? t('operations.printers.deletePrinterTitle', 'Delete Printer Device')
            : deleteConfirm.type === 'GROUP'
            ? t('operations.printers.deleteGroupTitle', 'Delete Printer Group')
            : t('operations.printers.deleteRouteTitle', 'Delete Print Document Route')
        }
        content={
          deleteConfirm.type === 'PRINTER'
            ? t('operations.printers.deletePrinterContent', 'Are you sure you want to delete printer "{{name}}"? This will remove all hardware routing rules bound to this device.', { name: deleteConfirm.name })
            : deleteConfirm.type === 'GROUP'
            ? t('operations.printers.deleteGroupContent', 'Are you sure you want to delete printer group "{{name}}"?', { name: deleteConfirm.name })
            : t('operations.printers.deleteRouteContent', 'Are you sure you want to delete this print routing rule?')
        }
        confirmLabel={t('common.delete', 'Delete')}
        confirmColor="error"
      />
    </Box>
  );
}
