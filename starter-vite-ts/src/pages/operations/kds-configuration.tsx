import type { KdsScreen, KitchenStation, KdsRoutingRule } from 'src/api/kdsApi';

import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import SoupKitchenIcon from '@mui/icons-material/SoupKitchen';
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
import { catalogApi } from 'src/api/catalogApi';

export function KdsConfigurationPage() {
  const [tab, setTab] = useState<'STATIONS' | 'SCREENS' | 'RULES'>('STATIONS');

  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [screens, setScreens] = useState<KdsScreen[]>([]);
  const [rules, setRules] = useState<KdsRoutingRule[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialogs
  const [stationModalOpen, setStationModalOpen] = useState(false);
  const [stationForm, setStationForm] = useState({ code: '', name: '', target_minutes: 10 });

  const [screenModalOpen, setScreenModalOpen] = useState(false);
  const [screenForm, setScreenForm] = useState({ code: '', name: '', station_ids: [] as string[] });

  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState({ station_id: '', selector_type: 'PRODUCT', product_id: '', category_id: '', priority: 1 });

  const loadData = async () => {
    setLoading(true);
    try {
      const [stList, scList, rlList, prodList, catList] = await Promise.all([
        kdsApi.getStations(),
        kdsApi.getScreens(),
        kdsApi.getRoutingRules(),
        catalogApi.getProducts().catch(() => []),
        catalogApi.getCategories().catch(() => []),
      ]);
      setStations(stList);
      setScreens(scList);
      setRules(rlList);
      setProducts(Array.isArray(prodList) ? prodList : (prodList as any).items || []);
      setCategories(Array.isArray(catList) ? catList : (catList as any).items || []);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to load KDS configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateStation = async () => {
    try {
      await kdsApi.createStation(stationForm);
      setStationModalOpen(false);
      setStationForm({ code: '', name: '', target_minutes: 10 });
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create station');
    }
  };

  const handleDeleteStation = async (id: string) => {
    try {
      await kdsApi.deleteStation(id);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to delete station');
    }
  };

  const handleCreateScreen = async () => {
    try {
      await kdsApi.createScreen({
        branch_id: stations[0]?.id || '00000000-0000-0000-0000-000000000000',
        ...screenForm,
      });
      setScreenModalOpen(false);
      setScreenForm({ code: '', name: '', station_ids: [] });
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create screen');
    }
  };

  const handleDeleteScreen = async (id: string) => {
    try {
      await kdsApi.deleteScreen(id);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to delete screen');
    }
  };

  const handleCreateRule = async () => {
    try {
      await kdsApi.createRoutingRule({
        branch_id: stations[0]?.id || '00000000-0000-0000-0000-000000000000',
        station_id: ruleForm.station_id,
        product_id: ruleForm.selector_type === 'PRODUCT' ? ruleForm.product_id : undefined,
        category_id: ruleForm.selector_type === 'CATEGORY' ? ruleForm.category_id : undefined,
        priority: ruleForm.priority,
      });
      setRuleModalOpen(false);
      setRuleForm({ station_id: '', selector_type: 'PRODUCT', product_id: '', category_id: '', priority: 1 });
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create routing rule');
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      await kdsApi.deleteRoutingRule(id);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to delete routing rule');
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" sx={{ mb: 3, justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
            <SoupKitchenIcon color="primary" /> KDS Configuration
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure kitchen stations, KDS screens, and product/category preparation routing rules.
          </Typography>
        </Box>

        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
          Refresh
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Paper sx={{ mb: 3, borderRadius: 2 }}>
        <Tabs value={tab} onChange={(_, val) => setTab(val)}>
          <Tab label="Kitchen Stations" value="STATIONS" />
          <Tab label="KDS Screens" value="SCREENS" />
          <Tab label="Station Routing Rules" value="RULES" />
        </Tabs>
      </Paper>

      {/* STATIONS TAB */}
      {tab === 'STATIONS' && (
        <Card sx={{ p: 3, borderRadius: 2 }}>
          <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Kitchen Stations ({stations.length})</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setStationModalOpen(true)}>
              Add Station
            </Button>
          </Stack>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Target Minutes</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {stations.map((st) => (
                <TableRow key={st.id}>
                  <TableCell><strong>{st.code}</strong></TableCell>
                  <TableCell>{st.name}</TableCell>
                  <TableCell><Chip label={st.station_type || 'HOT_KITCHEN'} size="small" /></TableCell>
                  <TableCell>{st.target_minutes || 10} mins</TableCell>
                  <TableCell><Chip label={st.is_active ? 'Active' : 'Inactive'} color={st.is_active ? 'success' : 'default'} size="small" /></TableCell>
                  <TableCell align="right">
                    <IconButton color="error" onClick={() => handleDeleteStation(st.id)}>
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* SCREENS TAB */}
      {tab === 'SCREENS' && (
        <Card sx={{ p: 3, borderRadius: 2 }}>
          <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>KDS Display Screens ({screens.length})</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setScreenModalOpen(true)}>
              Add KDS Screen
            </Button>
          </Stack>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Screen Name</TableCell>
                <TableCell>Assigned Stations</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {screens.map((sc) => (
                <TableRow key={sc.id}>
                  <TableCell><strong>{sc.code}</strong></TableCell>
                  <TableCell>{sc.name}</TableCell>
                  <TableCell>
                    {(sc.station_ids || []).map((stId) => {
                      const st = stations.find((s) => s.id === stId);
                      return <Chip key={stId} label={st ? st.name : stId} size="small" sx={{ mr: 0.5 }} />;
                    })}
                  </TableCell>
                  <TableCell><Chip label={sc.is_active ? 'Active' : 'Inactive'} color={sc.is_active ? 'success' : 'default'} size="small" /></TableCell>
                  <TableCell align="right">
                    <IconButton color="error" onClick={() => handleDeleteScreen(sc.id)}>
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* RULES TAB */}
      {tab === 'RULES' && (
        <Card sx={{ p: 3, borderRadius: 2 }}>
          <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Routing Rules ({rules.length})</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setRuleModalOpen(true)}>
              Add Routing Rule
            </Button>
          </Stack>

          <Alert severity="info" sx={{ mb: 2 }}>
            Specificity Order: Product-level rules override Category-level rules. If no rule matches, item defaults to Main Kitchen.
          </Alert>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Priority</TableCell>
                <TableCell>Target Station</TableCell>
                <TableCell>Target Product / Category</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.map((rl) => {
                const st = stations.find((s) => s.id === rl.station_id);
                const prod = products.find((p) => p.id === rl.product_id);
                const cat = categories.find((c) => c.id === rl.category_id);

                return (
                  <TableRow key={rl.id}>
                    <TableCell><Chip label={`P${rl.priority}`} color="primary" size="small" /></TableCell>
                    <TableCell><strong>{st ? st.name : rl.station_id}</strong></TableCell>
                    <TableCell>
                      {rl.product_id && <Chip label={`Product: ${prod ? prod.name : rl.product_id}`} color="success" size="small" />}
                      {rl.category_id && <Chip label={`Category: ${cat ? cat.name : rl.category_id}`} color="info" size="small" />}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton color="error" onClick={() => handleDeleteRule(rl.id)}>
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

      {/* Add Station Modal */}
      <Dialog open={stationModalOpen} onClose={() => setStationModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Kitchen Station</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Station Code" value={stationForm.code} onChange={(e) => setStationForm({ ...stationForm, code: e.target.value })} fullWidth />
            <TextField label="Station Name" value={stationForm.name} onChange={(e) => setStationForm({ ...stationForm, name: e.target.value })} fullWidth />
            <TextField label="Target Prep Minutes" type="number" value={stationForm.target_minutes} onChange={(e) => setStationForm({ ...stationForm, target_minutes: Number(e.target.value) })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStationModalOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateStation}>Save Station</Button>
        </DialogActions>
      </Dialog>

      {/* Add Screen Modal */}
      <Dialog open={screenModalOpen} onClose={() => setScreenModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add KDS Screen</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Screen Code" value={screenForm.code} onChange={(e) => setScreenForm({ ...screenForm, code: e.target.value })} fullWidth />
            <TextField label="Screen Name" value={screenForm.name} onChange={(e) => setScreenForm({ ...screenForm, name: e.target.value })} fullWidth />
            <FormControl fullWidth>
              <InputLabel>Assigned Stations</InputLabel>
              <Select
                multiple
                value={screenForm.station_ids}
                label="Assigned Stations"
                onChange={(e) => setScreenForm({ ...screenForm, station_ids: typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value })}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map((value) => {
                      const st = stations.find((s) => s.id === value);
                      return <Chip key={value} label={st ? st.name : value} size="small" />;
                    })}
                  </Box>
                )}
              >
                {stations.map((st) => (
                  <MenuItem key={st.id} value={st.id}>{st.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScreenModalOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateScreen}>Save Screen</Button>
        </DialogActions>
      </Dialog>

      {/* Add Rule Modal */}
      <Dialog open={ruleModalOpen} onClose={() => setRuleModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Routing Rule</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Target Station</InputLabel>
              <Select value={ruleForm.station_id} label="Target Station" onChange={(e) => setRuleForm({ ...ruleForm, station_id: e.target.value })}>
                {stations.map((st) => (
                  <MenuItem key={st.id} value={st.id}>{st.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Rule Selector Type</InputLabel>
              <Select value={ruleForm.selector_type} label="Rule Selector Type" onChange={(e) => setRuleForm({ ...ruleForm, selector_type: e.target.value })}>
                <MenuItem value="PRODUCT">Specific Product</MenuItem>
                <MenuItem value="CATEGORY">Whole Category</MenuItem>
              </Select>
            </FormControl>

            {ruleForm.selector_type === 'PRODUCT' ? (
              <FormControl fullWidth>
                <InputLabel>Product</InputLabel>
                <Select value={ruleForm.product_id} label="Product" onChange={(e) => setRuleForm({ ...ruleForm, product_id: e.target.value })}>
                  {products.map((p) => (
                    <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select value={ruleForm.category_id} label="Category" onChange={(e) => setRuleForm({ ...ruleForm, category_id: e.target.value })}>
                  {categories.map((c) => (
                    <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            <TextField label="Priority" type="number" value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: Number(e.target.value) })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRuleModalOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateRule}>Save Rule</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
