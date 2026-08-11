import type { PrintRoute, PrinterGroup, PrinterDevice } from 'src/api/kdsApi';

import React, { useState, useEffect } from 'react';

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
} from '@mui/material';

import { kdsApi } from 'src/api/kdsApi';

export function PrintersPage() {
  const [tab, setTab] = useState<'PRINTERS' | 'GROUPS' | 'ROUTES'>('PRINTERS');

  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [groups, setGroups] = useState<PrinterGroup[]>([]);
  const [routes, setRoutes] = useState<PrintRoute[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const loadData = async () => {
    setLoading(true);
    try {
      const [prList, grList, rtList] = await Promise.all([
        kdsApi.getPrinters(),
        kdsApi.getPrinterGroups(),
        kdsApi.getPrintRoutes(),
      ]);
      setPrinters(prList);
      setGroups(grList);
      setRoutes(rtList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to load printers configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreatePrinter = async () => {
    try {
      const targetBranchId = (printers[0] as any)?.branch_id || printers[0]?.id;
      if (!targetBranchId) {
        setError('No active printer/branch context');
        return;
      }
      await kdsApi.createPrinter({
        branch_id: targetBranchId,
        ...printerForm,
      } as any);
      setPrinterModalOpen(false);
      setPrinterForm({ code: '', name: '', printer_type: 'THERMAL_RECEIPT', simulated_address: '192.168.1.100:9100', paper_width_mm: 80, fallback_printer_id: '' });
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create printer');
    }
  };

  const handleDeletePrinter = async (id: string) => {
    try {
      await kdsApi.deletePrinter(id);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to delete printer');
    }
  };

  const handleCreateGroup = async () => {
    try {
      const targetBranchId = (printers[0] as any)?.branch_id || printers[0]?.id;
      if (!targetBranchId) {
        setError('No active printer/branch context');
        return;
      }
      await kdsApi.createPrinterGroup({
        branch_id: targetBranchId,
        ...groupForm,
      } as any);
      setGroupModalOpen(false);
      setGroupForm({ code: '', name: '' });
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create printer group');
    }
  };

  const handleDeleteGroup = async (id: string) => {
    try {
      await kdsApi.deletePrinterGroup(id);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to delete printer group');
    }
  };

  const handleCreateRoute = async () => {
    try {
      const targetBranchId = (printers[0] as any)?.branch_id || printers[0]?.id;
      if (!targetBranchId) {
        setError('No active printer/branch context');
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
      setError(err.detail || 'Failed to create print route');
    }
  };

  const handleDeleteRoute = async (id: string) => {
    try {
      await kdsApi.deletePrintRoute(id);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to delete print route');
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Alert severity="info" variant="filled" sx={{ mb: 3, fontWeight: 'bold' }}>
        SIMULATED PRINTER HARDWARE & ROUTING CONFIGURATION
      </Alert>

      <Stack direction="row" sx={{ mb: 3, justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
            <PrintIcon color="primary" /> Printers & Print Routing
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage simulated receipt/kitchen printers, fallback chain routing, and document group targets.
          </Typography>
        </Box>

        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
          Refresh
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Paper sx={{ mb: 3, borderRadius: 2 }}>
        <Tabs value={tab} onChange={(_, val) => setTab(val)}>
          <Tab label="Printers & Devices" value="PRINTERS" />
          <Tab label="Printer Groups" value="GROUPS" />
          <Tab label="Print Document Routes" value="ROUTES" />
        </Tabs>
      </Paper>

      {/* PRINTERS TAB */}
      {tab === 'PRINTERS' && (
        <Card sx={{ p: 3, borderRadius: 2 }}>
          <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Printers ({printers.length})</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setPrinterModalOpen(true)}>
              Add Printer
            </Button>
          </Stack>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Simulated Address</TableCell>
                <TableCell>Paper Width</TableCell>
                <TableCell>Fallback Printer</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {printers.map((pr) => {
                const fb = printers.find((p) => p.id === pr.fallback_printer_id);
                return (
                  <TableRow key={pr.id}>
                    <TableCell><strong>{pr.code}</strong></TableCell>
                    <TableCell>{pr.name}</TableCell>
                    <TableCell><Chip label={pr.printer_type} color="primary" size="small" /></TableCell>
                    <TableCell><code>{pr.simulated_address || '192.168.1.100'}</code></TableCell>
                    <TableCell>{pr.paper_width_mm}mm</TableCell>
                    <TableCell>{fb ? <Chip label={fb.name} color="warning" size="small" /> : 'None'}</TableCell>
                    <TableCell align="right">
                      <IconButton color="error" onClick={() => handleDeletePrinter(pr.id)}>
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
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Printer Groups ({groups.length})</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setGroupModalOpen(true)}>
              Add Printer Group
            </Button>
          </Stack>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Group Code</TableCell>
                <TableCell>Group Name</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.map((gr) => (
                <TableRow key={gr.id}>
                  <TableCell><strong>{gr.code}</strong></TableCell>
                  <TableCell>{gr.name}</TableCell>
                  <TableCell align="right">
                    <IconButton color="error" onClick={() => handleDeleteGroup(gr.id)}>
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
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Print Document Routes ({routes.length})</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setRouteModalOpen(true)}>
              Add Print Route
            </Button>
          </Stack>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Priority</TableCell>
                <TableCell>Document Type</TableCell>
                <TableCell>Printer Group</TableCell>
                <TableCell>Copies</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {routes.map((rt) => {
                const grp = groups.find((g) => g.id === rt.printer_group_id);
                return (
                  <TableRow key={rt.id}>
                    <TableCell><Chip label={`P${rt.priority}`} color="primary" size="small" /></TableCell>
                    <TableCell><strong>{rt.document_type}</strong></TableCell>
                    <TableCell>{grp ? grp.name : rt.printer_group_id}</TableCell>
                    <TableCell>{rt.copies} copy(ies)</TableCell>
                    <TableCell align="right">
                      <IconButton color="error" onClick={() => handleDeleteRoute(rt.id)}>
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

      {/* Add Printer Modal */}
      <Dialog open={printerModalOpen} onClose={() => setPrinterModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Simulated Printer</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Printer Code" value={printerForm.code} onChange={(e) => setPrinterForm({ ...printerForm, code: e.target.value })} fullWidth />
            <TextField label="Printer Name" value={printerForm.name} onChange={(e) => setPrinterForm({ ...printerForm, name: e.target.value })} fullWidth />
            <FormControl fullWidth>
              <InputLabel>Type</InputLabel>
              <Select value={printerForm.printer_type} label="Type" onChange={(e) => setPrinterForm({ ...printerForm, printer_type: e.target.value })}>
                <MenuItem value="THERMAL_RECEIPT">Thermal Receipt (80mm)</MenuItem>
                <MenuItem value="KITCHEN_IMPACT">Kitchen Impact Chit</MenuItem>
                <MenuItem value="LABEL">Label Printer</MenuItem>
              </Select>
            </FormControl>
            <TextField label="Simulated Network Address" value={printerForm.simulated_address} onChange={(e) => setPrinterForm({ ...printerForm, simulated_address: e.target.value })} fullWidth />
            <FormControl fullWidth>
              <InputLabel>Fallback Printer</InputLabel>
              <Select value={printerForm.fallback_printer_id} label="Fallback Printer" onChange={(e) => setPrinterForm({ ...printerForm, fallback_printer_id: e.target.value })}>
                <MenuItem value="">None</MenuItem>
                {printers.map((p) => (
                  <MenuItem key={p.id} value={p.id}>{p.name} ({p.code})</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPrinterModalOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreatePrinter}>Save Printer</Button>
        </DialogActions>
      </Dialog>

      {/* Add Group Modal */}
      <Dialog open={groupModalOpen} onClose={() => setGroupModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Printer Group</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Group Code" value={groupForm.code} onChange={(e) => setGroupForm({ ...groupForm, code: e.target.value })} fullWidth />
            <TextField label="Group Name" value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupModalOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateGroup}>Save Group</Button>
        </DialogActions>
      </Dialog>

      {/* Add Route Modal */}
      <Dialog open={routeModalOpen} onClose={() => setRouteModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Print Route</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Document Type</InputLabel>
              <Select value={routeForm.document_type} label="Document Type" onChange={(e) => setRouteForm({ ...routeForm, document_type: e.target.value })}>
                <MenuItem value="CUSTOMER_RECEIPT">Customer Receipt</MenuItem>
                <MenuItem value="KITCHEN_TICKET">Kitchen Dispatch Chit</MenuItem>
                <MenuItem value="COURIER_SLIP">Courier Slip</MenuItem>
                <MenuItem value="GUEST_BILL">Guest Bill</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Target Printer Group</InputLabel>
              <Select value={routeForm.printer_group_id} label="Target Printer Group" onChange={(e) => setRouteForm({ ...routeForm, printer_group_id: e.target.value })}>
                {groups.map((g) => (
                  <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField label="Copies" type="number" value={routeForm.copies} onChange={(e) => setRouteForm({ ...routeForm, copies: Number(e.target.value) })} fullWidth />
            <TextField label="Priority" type="number" value={routeForm.priority} onChange={(e) => setRouteForm({ ...routeForm, priority: Number(e.target.value) })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRouteModalOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateRoute}>Save Route</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
