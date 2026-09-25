import type { Branch } from 'src/api/tenantApi';
import type { Product, Category } from 'src/api/catalogApi';
import type { PrintRoute, PrinterGroup, PrinterDevice, KitchenStation, PrinterConnection } from 'src/api/kdsApi';

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
  FormHelperText,
  DialogContent,
  DialogActions,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';

import { RouterLink } from 'src/routes/components';

import { kdsApi } from 'src/api/kdsApi';
import { tenantApi } from 'src/api/tenantApi';
import { catalogApi } from 'src/api/catalogApi';
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

  const [tab, setTab] = useState<'PRINTERS' | 'GROUPS' | 'ROUTES'>('PRINTERS');

  // Master Data States
  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [groups, setGroups] = useState<PrinterGroup[]>([]);
  const [routes, setRoutes] = useState<PrintRoute[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stations, setStations] = useState<KitchenStation[]>([]);

  const [selectedBranchId, setSelectedBranchId] = useScopedBranchId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testSuccessMsg, setTestSuccessMsg] = useState<string | null>(null);

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

  // Group Modals (Add / Edit)
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupForm, setGroupForm] = useState({
    code: '',
    name: '',
    branch_id: '',
    // '' takes the document's default: a compact kitchen chit, a detailed receipt.
    ticket_template: '' as '' | 'COMPACT' | 'DETAILED',
    members: [] as Array<{ printer_id: string; priority: number; copies: number }>,
  });

  // Route Modals (Add / Edit)
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [routeForm, setRouteForm] = useState({
    document_type: 'CUSTOMER_RECEIPT',
    printer_group_id: '',
    priority: 1,
    copies: 1,
    branch_id: '',
    selector_type: 'ALL' as 'ALL' | 'CATEGORY' | 'PRODUCT' | 'STATION',
    product_id: '',
    category_id: '',
    station_id: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [prList, grList, rtList, bList, catList, prodList, stList] = await Promise.all([
        kdsApi.getPrinters(selectedBranchId || undefined),
        kdsApi.getPrinterGroups(selectedBranchId || undefined),
        kdsApi.getPrintRoutes(selectedBranchId || undefined),
        tenantApi.getBranches().catch(() => []),
        catalogApi.getCategories().catch(() => []),
        catalogApi.getProducts().catch(() => []),
        kdsApi.getStations(selectedBranchId || undefined).catch(() => []),
      ]);
      setPrinters(prList || []);
      setGroups(grList || []);
      setRoutes(rtList || []);
      setBranches(bList || []);
      setCategories(catList || []);
      setProducts(prodList || []);
      setStations(stList || []);
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
    setConnForm(toConnectionForm(pr.agent_connection));
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

  const handleTestPrintSlip = (printer: PrinterDevice) => {
    setTestSuccessMsg(t('operations.printers.testPrintSuccess', 'Simulated test slip printed cleanly on {{name}}', { name: printer.name }));
  };

  // GROUP HANDLERS
  const handleOpenAddGroup = () => {
    setEditingGroupId(null);
    setGroupForm({
      code: '',
      name: '',
      branch_id: getActiveBranchId(),
      ticket_template: '',
      members: printers.length > 0 ? [{ printer_id: printers[0].id, priority: 1, copies: 1 }] : [],
    });
    setGroupModalOpen(true);
  };

  const handleOpenEditGroup = (grp: PrinterGroup) => {
    setEditingGroupId(grp.id);
    setGroupForm({
      code: grp.code,
      name: grp.name,
      branch_id: (grp as any).branch_id || getActiveBranchId(),
      ticket_template: grp.ticket_template || '',
      members: (grp.members || []).map((m) => ({
        printer_id: m.printer_id,
        priority: m.priority || 1,
        copies: m.copies || 1,
      })),
    });
    setGroupModalOpen(true);
  };

  const handleAddGroupMemberRow = () => {
    const availablePrinter = printers.find((p) => !groupForm.members.some((m) => m.printer_id === p.id)) || printers[0];
    if (availablePrinter) {
      setGroupForm({
        ...groupForm,
        members: [...groupForm.members, { printer_id: availablePrinter.id, priority: groupForm.members.length + 1, copies: 1 }],
      });
    }
  };

  const handleRemoveGroupMemberRow = (index: number) => {
    setGroupForm({
      ...groupForm,
      members: groupForm.members.filter((_, i) => i !== index),
    });
  };

  const handleUpdateGroupMemberField = (index: number, field: string, value: any) => {
    const updated = [...groupForm.members];
    updated[index] = { ...updated[index], [field]: value };
    setGroupForm({ ...groupForm, members: updated });
  };

  const handleSaveGroup = async () => {
    if (!groupForm.code.trim() || !groupForm.name.trim()) {
      setError(t('common.requiredFields', 'Group code and name are required.'));
      return;
    }

    try {
      if (editingGroupId) {
        await kdsApi.updatePrinterGroup(editingGroupId, {
          branch_id: groupForm.branch_id || getActiveBranchId(),
          code: groupForm.code,
          name: groupForm.name,
          ticket_template: groupForm.ticket_template || null,
          members: groupForm.members as any,
        });
      } else {
        await kdsApi.createPrinterGroup({
          branch_id: groupForm.branch_id || getActiveBranchId(),
          code: groupForm.code,
          name: groupForm.name,
          ticket_template: groupForm.ticket_template || null,
          members: groupForm.members as any,
        });
      }
      setGroupModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.printers.createGroupError', 'Failed to save printer group'));
    }
  };

  // ROUTE HANDLERS
  const handleOpenAddRoute = () => {
    setEditingRouteId(null);
    setRouteForm({
      document_type: 'CUSTOMER_RECEIPT',
      printer_group_id: groups[0]?.id || '',
      priority: 1,
      copies: 1,
      branch_id: getActiveBranchId(),
      selector_type: 'ALL',
      product_id: '',
      category_id: '',
      station_id: '',
    });
    setRouteModalOpen(true);
  };

  const handleOpenEditRoute = (rt: PrintRoute) => {
    setEditingRouteId(rt.id);
    let sType: 'ALL' | 'CATEGORY' | 'PRODUCT' | 'STATION' = 'ALL';
    if (rt.product_id) sType = 'PRODUCT';
    else if (rt.category_id) sType = 'CATEGORY';
    else if (rt.station_id) sType = 'STATION';

    setRouteForm({
      document_type: rt.document_type || 'CUSTOMER_RECEIPT',
      printer_group_id: rt.printer_group_id || '',
      priority: rt.priority || 1,
      copies: rt.copies || 1,
      branch_id: rt.branch_id || getActiveBranchId(),
      selector_type: sType,
      product_id: rt.product_id || '',
      category_id: rt.category_id || '',
      station_id: rt.station_id || '',
    });
    setRouteModalOpen(true);
  };

  const handleSaveRoute = async () => {
    if (!routeForm.printer_group_id) {
      setError(t('operations.printers.noGroupError', 'Target printer group is required'));
      return;
    }

    const payload: Partial<PrintRoute> = {
      branch_id: routeForm.branch_id || getActiveBranchId(),
      document_type: routeForm.document_type,
      printer_group_id: routeForm.printer_group_id,
      priority: Number(routeForm.priority) || 1,
      copies: Number(routeForm.copies) || 1,
      // null, not undefined: JSON drops undefined, and the server keeps a selector it is not
      // sent, so a route changed from one product to every product stayed on the product.
      product_id: routeForm.selector_type === 'PRODUCT' ? routeForm.product_id || null : null,
      category_id: routeForm.selector_type === 'CATEGORY' ? routeForm.category_id || null : null,
      station_id: routeForm.selector_type === 'STATION' ? routeForm.station_id || null : null,
    };

    try {
      if (editingRouteId) {
        await kdsApi.updatePrintRoute(editingRouteId, payload);
      } else {
        await kdsApi.createPrintRoute(payload);
      }
      setRouteModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.printers.createRouteError', 'Failed to save print route'));
    }
  };

  // DELETE HANDLER
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

  const renderRouteTargetLabel = (rt: PrintRoute) => {
    if (rt.product_id) {
      const prod = products.find((p) => p.id === rt.product_id);
      return <Chip label={`Product: ${prod ? prod.name : rt.product_id.slice(0, 8)}`} color="info" size="small" />;
    }
    if (rt.category_id) {
      const cat = categories.find((c) => c.id === rt.category_id);
      return <Chip label={`Category: ${cat ? cat.name : rt.category_id.slice(0, 8)}`} color="secondary" size="small" />;
    }
    if (rt.station_id) {
      const st = stations.find((s) => s.id === rt.station_id);
      return <Chip label={`Station: ${st ? st.name : rt.station_id.slice(0, 8)}`} color="warning" size="small" />;
    }
    return <Chip label="All Items (Default)" variant="outlined" size="small" />;
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

      {/* Control Bar: Branch Filter + Tabs */}
      <Paper sx={{ mb: 3, borderRadius: 2, p: 1 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
          <Tabs value={tab} onChange={(_, val) => setTab(val)}>
            <Tab label={`${t('operations.printers.tabs.printers', 'Printers & Devices')} (${printers.length})`} value="PRINTERS" />
            <Tab label={`${t('operations.printers.tabs.groups', 'Printer Groups')} (${groups.length})`} value="GROUPS" />
            <Tab label={`${t('operations.printers.tabs.routes', 'Print Document Routes')} (${routes.length})`} value="ROUTES" />
          </Tabs>

          <FormControl size="small" sx={{ minWidth: 200, m: 1 }}>
            <InputLabel>{t('operations.printers.branchFilter', 'Branch Context')}</InputLabel>
            <Select
              value={selectedBranchId}
              label={t('operations.printers.branchFilter', 'Branch Context')}
              onChange={(e) => setSelectedBranchId(e.target.value)}
            >
              <MenuItem value="">{t('operations.printers.allBranches', 'All Branches')}</MenuItem>
              {branches.map((b) => (
                <MenuItem key={b.id} value={b.id}>{b.name} ({b.code})</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
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

          {/* GROUPS TAB */}
          {tab === 'GROUPS' && (
            <Card sx={{ p: 3, borderRadius: 2 }}>
              <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('operations.printers.tabs.groups', 'Printer Groups')}
                </Typography>
                <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenAddGroup}>
                  {t('operations.printers.addGroup', 'Add Printer Group')}
                </Button>
              </Stack>

              <Box sx={{ overflowX: 'auto' }}>
              <Table sx={{ minWidth: 760 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('operations.printers.colCode', 'Group Code')}</TableCell>
                    <TableCell>{t('operations.printers.colName', 'Group Name')}</TableCell>
                    <TableCell>{t('operations.printers.groupMembers', 'Assigned Printers')}</TableCell>
                    <TableCell>{t('operations.printers.ticketTemplate', 'Paper template')}</TableCell>
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
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                          {(gr.members || []).map((m, idx) => {
                            const pr = printers.find((p) => p.id === m.printer_id);
                            return (
                              <Chip
                                key={idx}
                                label={`${pr ? pr.name : m.printer_id.slice(0, 6)} (P${m.priority || 1}, ${m.copies || 1}x)`}
                                size="small"
                                color="primary"
                                variant="outlined"
                              />
                            );
                          })}
                          {(!gr.members || gr.members.length === 0) && (
                            <Typography variant="caption" color="text.secondary">
                              {t('operations.printers.noMembers', 'No assigned members')}
                            </Typography>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>{t(`operations.printers.templates.${gr.ticket_template || 'DEFAULT'}`)}</TableCell>
                      <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: theme.direction === 'rtl' ? 'flex-start' : 'flex-end' }}>
                          <IconButton
                            color="primary"
                            size="small"
                            aria-label={t('operations.printers.editGroup', 'Edit Group')}
                            title={t('operations.printers.editGroup', 'Edit Group')}
                            onClick={() => handleOpenEditGroup(gr)}
                          >
                            <EditIcon />
                          </IconButton>
                          <IconButton
                            color="error"
                            size="small"
                            aria-label={t('operations.printers.deleteGroup', 'Delete group')}
                            title={t('operations.printers.deleteGroup', 'Delete group')}
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
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                  {groups.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                        {t('common.noRecords', 'No printer groups found.')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </Box>
            </Card>
          )}

          {/* ROUTES TAB */}
          {tab === 'ROUTES' && (
            <Card sx={{ p: 3, borderRadius: 2 }}>
              <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('operations.printers.tabs.routes', 'Print Document Routes')}
                </Typography>
                <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenAddRoute}>
                  {t('operations.printers.addRoute', 'Add Print Route')}
                </Button>
              </Stack>

              <Alert severity="info" sx={{ mb: 2 }}>
                {t('operations.printers.routingHint')}
              </Alert>

              <Box sx={{ overflowX: 'auto' }}>
              <Table sx={{ minWidth: 760 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('operations.printers.colPriority', 'Priority')}</TableCell>
                    <TableCell>{t('operations.printers.colDocType', 'Document Type')}</TableCell>
                    <TableCell>{t('operations.printers.colTargetSelector', 'Target Selector')}</TableCell>
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
                        <TableCell>{renderRouteTargetLabel(rt)}</TableCell>
                        <TableCell>{grp ? grp.name : rt.printer_group_id}</TableCell>
                        <TableCell>{rt.copies} {t('operations.printers.colCopies', 'Copies')}</TableCell>
                        <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                          <Stack direction="row" spacing={0.5} sx={{ justifyContent: theme.direction === 'rtl' ? 'flex-start' : 'flex-end' }}>
                            <IconButton
                              color="primary"
                              size="small"
                              title={t('operations.printers.editRoute', 'Edit Route')}
                              onClick={() => handleOpenEditRoute(rt)}
                            >
                              <EditIcon />
                            </IconButton>
                            <IconButton
                              color="error"
                              size="small"
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
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {routes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                        {t('common.noRecords', 'No print routes configured.')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </Box>
            </Card>
          )}
        </>
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
                <MenuItem value="windows">{t('operations.printers.connection.windows', 'Printer installed in Windows')}</MenuItem>
                <MenuItem value="serial">{t('operations.printers.connection.serial', 'Serial port')}</MenuItem>
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
            {connForm.kind !== 'none' && (
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

      {/* Add/Edit Group Modal with Member Builder */}
      <Dialog open={groupModalOpen} onClose={() => setGroupModalOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingGroupId
            ? t('operations.printers.editGroupModal', 'Edit Printer Station Group')
            : t('operations.printers.createGroupModal', 'Create Printer Station Group')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label={t('operations.printers.colCode', 'Group Code')}
                value={groupForm.code}
                onChange={(e) => setGroupForm({ ...groupForm, code: e.target.value })}
                fullWidth
                required
              />
              <TextField
                label={t('operations.printers.colName', 'Group Name')}
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                fullWidth
                required
              />
            </Stack>

            <FormControl fullWidth>
              <InputLabel>{t('operations.printers.ticketTemplate', 'Paper template')}</InputLabel>
              <Select
                label={t('operations.printers.ticketTemplate', 'Paper template')}
                value={groupForm.ticket_template}
                onChange={(e) => setGroupForm({ ...groupForm, ticket_template: e.target.value as '' | 'COMPACT' | 'DETAILED' })}
              >
                <MenuItem value="">{t('operations.printers.templates.DEFAULT')}</MenuItem>
                <MenuItem value="COMPACT">{t('operations.printers.templates.COMPACT')}</MenuItem>
                <MenuItem value="DETAILED">{t('operations.printers.templates.DETAILED')}</MenuItem>
              </Select>
              <FormHelperText>{t('operations.printers.templateHelp')}</FormHelperText>
            </FormControl>

            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                  {t('operations.printers.groupMembers', 'Station Group Member Printers')}
                </Typography>
                <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={handleAddGroupMemberRow}>
                  {t('operations.printers.addMember', 'Add Printer')}
                </Button>
              </Stack>

              {groupForm.members.map((member, idx) => (
                <Stack key={idx} direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1.5 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>{t('operations.printers.memberPrinter', 'Printer Device')}</InputLabel>
                    <Select
                      value={member.printer_id}
                      label={t('operations.printers.memberPrinter', 'Printer Device')}
                      onChange={(e) => handleUpdateGroupMemberField(idx, 'printer_id', e.target.value)}
                    >
                      {printers.map((p) => (
                        <MenuItem key={p.id} value={p.id}>{p.name} ({p.code})</MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <TextField
                    label={t('operations.printers.memberPriority', 'Priority')}
                    type="number"
                    size="small"
                    sx={{ width: 120 }}
                    value={member.priority}
                    onChange={(e) => handleUpdateGroupMemberField(idx, 'priority', Number(e.target.value))}
                  />

                  <TextField
                    label={t('operations.printers.memberCopies', 'Copies')}
                    type="number"
                    size="small"
                    sx={{ width: 120 }}
                    value={member.copies}
                    onChange={(e) => handleUpdateGroupMemberField(idx, 'copies', Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
                  />

                  <IconButton color="error" size="small" onClick={() => handleRemoveGroupMemberRow(idx)}>
                    <DeleteIcon />
                  </IconButton>
                </Stack>
              ))}

              {groupForm.members.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                  {t('operations.printers.noMembers', 'No printers assigned to this group yet. Add at least one printer below.')}
                </Typography>
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupModalOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleSaveGroup}>
            {editingGroupId
              ? t('operations.printers.editGroupBtn', 'Save Group Changes')
              : t('operations.printers.createGroupBtn', 'Create Printer Group')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add/Edit Route Modal with Target Specificity Selector */}
      <Dialog open={routeModalOpen} onClose={() => setRouteModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingRouteId
            ? t('operations.printers.editRouteModal', 'Edit Print Document Routing Rule')
            : t('operations.printers.createRouteModal', 'Create Print Document Routing Rule')}
        </DialogTitle>
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
                <MenuItem value="ITEM_LABEL">{t('operations.printers.docTypes.ITEM_LABEL', 'Individual Cup / Item Label')}</MenuItem>
                <MenuItem value="DELIVERY_SLIP">{t('operations.printers.docTypes.DELIVERY_SLIP', 'Courier Delivery Manifest')}</MenuItem>
                <MenuItem value="SHIFT_REPORT">{t('operations.printers.docTypes.SHIFT_REPORT', 'Cashier Shift Closure Report')}</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>{t('operations.printers.targetSelector', 'Target Specificity Selector')}</InputLabel>
              <Select
                value={routeForm.selector_type}
                label={t('operations.printers.targetSelector', 'Target Specificity Selector')}
                onChange={(e) => setRouteForm({ ...routeForm, selector_type: e.target.value as any })}
              >
                <MenuItem value="ALL">{t('operations.printers.targetSelectorDefault', 'All Products / Categories (Default Document Route)')}</MenuItem>
                <MenuItem value="CATEGORY">{t('operations.printers.targetSelectorCategory', 'Specific Menu Category')}</MenuItem>
                <MenuItem value="PRODUCT">{t('operations.printers.targetSelectorProduct', 'Specific Product Item')}</MenuItem>
                <MenuItem value="STATION">{t('operations.printers.targetSelectorStation', 'Specific Kitchen Station')}</MenuItem>
              </Select>
            </FormControl>

            {routeForm.selector_type === 'CATEGORY' && (
              <FormControl fullWidth>
                <InputLabel>{t('operations.printers.selectCategory', 'Select Menu Category')}</InputLabel>
                <Select
                  value={routeForm.category_id}
                  label={t('operations.printers.selectCategory', 'Select Menu Category')}
                  onChange={(e) => setRouteForm({ ...routeForm, category_id: e.target.value })}
                >
                  {categories.map((c) => (
                    <MenuItem key={c.id} value={c.id}>{c.name} ({c.code})</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {routeForm.selector_type === 'PRODUCT' && (
              <FormControl fullWidth>
                <InputLabel>{t('operations.printers.selectProduct', 'Select Product Item')}</InputLabel>
                <Select
                  value={routeForm.product_id}
                  label={t('operations.printers.selectProduct', 'Select Product Item')}
                  onChange={(e) => setRouteForm({ ...routeForm, product_id: e.target.value })}
                >
                  {products.map((p) => (
                    <MenuItem key={p.id} value={p.id}>{p.name} ({p.code})</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {routeForm.selector_type === 'STATION' && (
              <FormControl fullWidth>
                <InputLabel>{t('operations.printers.selectStation', 'Select Kitchen Station')}</InputLabel>
                <Select
                  value={routeForm.station_id}
                  label={t('operations.printers.selectStation', 'Select Kitchen Station')}
                  onChange={(e) => setRouteForm({ ...routeForm, station_id: e.target.value })}
                >
                  {stations.map((s) => (
                    <MenuItem key={s.id} value={s.id}>{s.name} ({s.code})</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            <FormControl fullWidth>
              <InputLabel>{t('operations.printers.formPrinterGroup', 'Target Printer Group')}</InputLabel>
              <Select
                value={routeForm.printer_group_id}
                label={t('operations.printers.formPrinterGroup', 'Target Printer Group')}
                onChange={(e) => setRouteForm({ ...routeForm, printer_group_id: e.target.value })}
              >
                {groups.map((g) => (
                  <MenuItem key={g.id} value={g.id}>{g.name} ({g.code})</MenuItem>
                ))}
              </Select>
            </FormControl>

            <Stack direction="row" spacing={2}>
              <TextField
                label={t('operations.printers.formCopies', 'Number of Copies')}
                type="number"
                value={routeForm.copies}
                onChange={(e) => setRouteForm({ ...routeForm, copies: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })}
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
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRouteModalOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleSaveRoute}>
            {editingRouteId
              ? t('operations.printers.editRouteBtn', 'Save Route Changes')
              : t('operations.printers.createRouteBtn', 'Create Print Route')}
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
