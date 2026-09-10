import type { KdsScreen, KitchenStation, KdsRoutingRule } from 'src/api/kdsApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

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
import { catalogApi } from 'src/api/catalogApi';
import { useScopedBranchId } from 'src/contexts/branch-context';

import { ConfirmDialog } from 'src/components/confirm-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

export function KdsConfigurationPage() {
  const { t } = useTranslation();
  const theme = useTheme();

  const [tab, setTab] = useState<'STATIONS' | 'SCREENS' | 'RULES'>('STATIONS');

  // Which shop this configuration belongs to. The page used to take the branch from the
  // first station in the list and fall back to that station's own id when there were none,
  // so "add station" on an empty branch sent no branch at all and the request died on a
  // not-null constraint. The header switcher is the answer, as it is everywhere else.
  const [selectedBranchId] = useScopedBranchId();

  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [screens, setScreens] = useState<KdsScreen[]>([]);
  const [rules, setRules] = useState<KdsRoutingRule[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Deletion confirm dialog state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: string;
    name?: string;
    open: boolean;
    type: 'STATION' | 'SCREEN' | 'RULE';
  }>({
    open: false,
    id: '',
    name: '',
    type: 'STATION',
  });

  // Dialogs
  const [stationModalOpen, setStationModalOpen] = useState(false);
  const [stationForm, setStationForm] = useState({ code: '', name: '', target_minutes: 10 });

  const [screenModalOpen, setScreenModalOpen] = useState(false);
  const [screenForm, setScreenForm] = useState({ code: '', name: '', station_ids: [] as string[] });

  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState({ station_id: '', selector_type: 'PRODUCT', product_id: '', category_id: '', priority: 1 });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [stList, scList, rlList, prodList, catList] = await Promise.all([
        kdsApi.getStations(selectedBranchId || undefined),
        kdsApi.getScreens(selectedBranchId || undefined),
        kdsApi.getRoutingRules(selectedBranchId || undefined),
        catalogApi.getProducts().catch(() => []),
        catalogApi.getCategories().catch(() => []),
      ]);
      setStations(stList || []);
      setScreens(scList || []);
      setRules(rlList || []);
      setProducts(Array.isArray(prodList) ? prodList : (prodList as any).items || []);
      setCategories(Array.isArray(catList) ? catList : (catList as any).items || []);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.kds.loadError', 'Failed to load KDS configuration'));
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateStation = async () => {
    try {
      if (!selectedBranchId) {
        setError(t('operations.kds.noBranchError', 'Choose a branch before adding kitchen configuration'));
        return;
      }
      await kdsApi.createStation({ branch_id: selectedBranchId, ...stationForm });
      setStationModalOpen(false);
      setStationForm({ code: '', name: '', target_minutes: 10 });
      loadData();
    } catch (err: any) {
      setError(err.detail || t('operations.kds.createStationError', 'Failed to create station'));
    }
  };

  const handleConfirmDelete = async () => {
    try {
      if (deleteConfirm.type === 'STATION') {
        await kdsApi.deleteStation(deleteConfirm.id);
      } else if (deleteConfirm.type === 'SCREEN') {
        await kdsApi.deleteScreen(deleteConfirm.id);
      } else if (deleteConfirm.type === 'RULE') {
        await kdsApi.deleteRoutingRule(deleteConfirm.id);
      }
      setDeleteConfirm({ open: false, id: '', name: '', type: 'STATION' });
      loadData();
    } catch (err: any) {
      setError(err.detail || t('common.deleteError', 'Failed to delete item'));
    }
  };

  const handleCreateScreen = async () => {
    try {
      if (!selectedBranchId) {
        setError(t('operations.kds.noBranchError', 'Choose a branch before adding kitchen configuration'));
        return;
      }
      await kdsApi.createScreen({
        branch_id: selectedBranchId,
        ...screenForm,
      });
      setScreenModalOpen(false);
      setScreenForm({ code: '', name: '', station_ids: [] });
      loadData();
    } catch (err: any) {
      setError(err.detail || t('operations.kds.createScreenError', 'Failed to create screen'));
    }
  };

  const handleCreateRule = async () => {
    try {
      if (!selectedBranchId) {
        setError(t('operations.kds.noBranchError', 'Choose a branch before adding kitchen configuration'));
        return;
      }
      await kdsApi.createRoutingRule({
        branch_id: selectedBranchId,
        station_id: ruleForm.station_id,
        product_id: ruleForm.selector_type === 'PRODUCT' ? ruleForm.product_id : undefined,
        category_id: ruleForm.selector_type === 'CATEGORY' ? ruleForm.category_id : undefined,
        priority: ruleForm.priority,
      });
      setRuleModalOpen(false);
      setRuleForm({ station_id: '', selector_type: 'PRODUCT', product_id: '', category_id: '', priority: 1 });
      loadData();
    } catch (err: any) {
      setError(err.detail || t('operations.kds.createRuleError', 'Failed to create routing rule'));
    }
  };

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('operations.kds.title', 'KDS Configuration & Station Routing')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('operations.kds.title', 'KDS Configuration') },
        ]}
        action={
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            {t('common.refresh', 'Refresh')}
          </Button>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}

      <Paper sx={{ mb: 3, borderRadius: 2 }}>
        <Tabs value={tab} onChange={(_, val) => setTab(val)}>
          <Tab label={t('operations.kds.tabs.stations', 'Kitchen Preparation Stations')} value="STATIONS" />
          <Tab label={t('operations.kds.tabs.screens', 'KDS Bump Screens')} value="SCREENS" />
          <Tab label={t('operations.kds.tabs.rules', 'Station Routing Rules')} value="RULES" />
        </Tabs>
      </Paper>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {/* STATIONS TAB */}
          {tab === 'STATIONS' && (
            <Card sx={{ p: 3, borderRadius: 2 }}>
              <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('operations.kds.tabs.stations', 'Kitchen Preparation Stations')} ({stations.length})
                </Typography>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setStationModalOpen(true)}>
                  {t('operations.kds.addStation', 'Add Prep Station')}
                </Button>
              </Stack>

              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('operations.kds.colCode', 'Code')}</TableCell>
                    <TableCell>{t('operations.kds.colName', 'Name')}</TableCell>
                    <TableCell>{t('operations.kds.colTargetMinutes', 'Target Prep Time')}</TableCell>
                    <TableCell>{t('operations.kds.colStatus', 'Status')}</TableCell>
                    <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                      {t('operations.kds.colActions', 'Actions')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stations.map((st) => (
                    <TableRow key={st.id}>
                      <TableCell><strong>{st.code}</strong></TableCell>
                      <TableCell>{st.name}</TableCell>
                      <TableCell>{t('operations.kds.colMinutesVal', '{{minutes}} min', { minutes: st.target_minutes || 10 })}</TableCell>
                      <TableCell>
                        <Chip
                          label={st.is_active ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
                          color={st.is_active ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                        <IconButton
                          color="error"
                          onClick={() =>
                            setDeleteConfirm({
                              open: true,
                              id: st.id,
                              name: st.name,
                              type: 'STATION',
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

          {/* SCREENS TAB */}
          {tab === 'SCREENS' && (
            <Card sx={{ p: 3, borderRadius: 2 }}>
              <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('operations.kds.tabs.screens', 'KDS Bump Screens')} ({screens.length})
                </Typography>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setScreenModalOpen(true)}>
                  {t('operations.kds.addScreen', 'Add KDS Screen')}
                </Button>
              </Stack>

              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('operations.kds.colScreenCode', 'Screen Code')}</TableCell>
                    <TableCell>{t('operations.kds.colScreenName', 'Screen Name')}</TableCell>
                    <TableCell>{t('operations.kds.colAssignedStations', 'Assigned Stations')}</TableCell>
                    <TableCell>{t('operations.kds.colStatus', 'Status')}</TableCell>
                    <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                      {t('operations.kds.colActions', 'Actions')}
                    </TableCell>
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
                      <TableCell>
                        <Chip
                          label={sc.is_active ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
                          color={sc.is_active ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                        <IconButton
                          color="error"
                          onClick={() =>
                            setDeleteConfirm({
                              open: true,
                              id: sc.id,
                              name: sc.name,
                              type: 'SCREEN',
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

          {/* RULES TAB */}
          {tab === 'RULES' && (
            <Card sx={{ p: 3, borderRadius: 2 }}>
              <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('operations.kds.tabs.rules', 'Station Routing Rules')} ({rules.length})
                </Typography>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setRuleModalOpen(true)}>
                  {t('operations.kds.addRule', 'Add Routing Rule')}
                </Button>
              </Stack>

              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('operations.printers.colPriority', 'Priority')}</TableCell>
                    <TableCell>{t('operations.kds.colTargetStation', 'Target Station')}</TableCell>
                    <TableCell>{t('operations.kds.colCategory', 'Menu Category / Product')}</TableCell>
                    <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                      {t('operations.kds.colActions', 'Actions')}
                    </TableCell>
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
                        <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                          <IconButton
                            color="error"
                            onClick={() =>
                              setDeleteConfirm({
                                open: true,
                                id: rl.id,
                                name: st ? st.name : rl.station_id,
                                type: 'RULE',
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

      {/* Add Station Modal */}
      <Dialog open={stationModalOpen} onClose={() => setStationModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('operations.kds.createStationModal', 'Create Kitchen Preparation Station')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t('operations.kds.formStationCode', 'Station Code')}
              value={stationForm.code}
              onChange={(e) => setStationForm({ ...stationForm, code: e.target.value })}
              fullWidth
            />
            <TextField
              label={t('operations.kds.formStationName', 'Station Name')}
              value={stationForm.name}
              onChange={(e) => setStationForm({ ...stationForm, name: e.target.value })}
              fullWidth
            />
            <TextField
              label={t('operations.kds.formTargetMinutes', 'Target Preparation Time (Minutes)')}
              type="number"
              value={stationForm.target_minutes}
              onChange={(e) => setStationForm({ ...stationForm, target_minutes: Number(e.target.value) })}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStationModalOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleCreateStation}>
            {t('operations.kds.createStationBtn', 'Save Station')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Screen Modal */}
      <Dialog open={screenModalOpen} onClose={() => setScreenModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('operations.kds.createScreenModal', 'Configure KDS Bump Screen')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t('operations.kds.formScreenCode', 'Screen Code')}
              value={screenForm.code}
              onChange={(e) => setScreenForm({ ...screenForm, code: e.target.value })}
              fullWidth
            />
            <TextField
              label={t('operations.kds.formScreenName', 'Screen Name')}
              value={screenForm.name}
              onChange={(e) => setScreenForm({ ...screenForm, name: e.target.value })}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>{t('operations.kds.formAssignedStations', 'Assigned Stations')}</InputLabel>
              <Select
                multiple
                value={screenForm.station_ids}
                label={t('operations.kds.formAssignedStations', 'Assigned Stations')}
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
          <Button onClick={() => setScreenModalOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleCreateScreen}>
            {t('operations.kds.createScreenBtn', 'Save Screen')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Rule Modal */}
      <Dialog open={ruleModalOpen} onClose={() => setRuleModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('operations.kds.createRuleModal', 'Configure Category Station Routing Rule')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>{t('operations.kds.formTargetStation', 'Target Station')}</InputLabel>
              <Select
                value={ruleForm.station_id}
                label={t('operations.kds.formTargetStation', 'Target Station')}
                onChange={(e) => setRuleForm({ ...ruleForm, station_id: e.target.value })}
              >
                {stations.map((st) => (
                  <MenuItem key={st.id} value={st.id}>{st.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>{t('operations.kds.formCategory', 'Menu Category')}</InputLabel>
              <Select
                value={ruleForm.category_id}
                label={t('operations.kds.formCategory', 'Menu Category')}
                onChange={(e) => setRuleForm({ ...ruleForm, selector_type: 'CATEGORY', category_id: e.target.value })}
              >
                {categories.map((c) => (
                  <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label={t('operations.printers.formPriority', 'Priority')}
              type="number"
              value={ruleForm.priority}
              onChange={(e) => setRuleForm({ ...ruleForm, priority: Number(e.target.value) })}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRuleModalOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleCreateRule}>
            {t('operations.kds.createRuleBtn', 'Save Rule')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: '', name: '', type: 'STATION' })}
        onConfirm={handleConfirmDelete}
        title={
          deleteConfirm.type === 'STATION'
            ? t('operations.kds.deleteStationTitle', 'Delete Kitchen Station')
            : deleteConfirm.type === 'SCREEN'
            ? t('operations.kds.deleteScreenTitle', 'Delete KDS Bump Screen')
            : t('operations.kds.deleteRuleTitle', 'Delete Station Routing Rule')
        }
        content={
          deleteConfirm.type === 'STATION'
            ? t('operations.kds.deleteStationContent', 'Are you sure you want to delete prep station "{{name}}"? This will remove all items routed to this station.', { name: deleteConfirm.name })
            : deleteConfirm.type === 'SCREEN'
            ? t('operations.kds.deleteScreenContent', 'Are you sure you want to delete KDS screen "{{name}}"?', { name: deleteConfirm.name })
            : t('operations.kds.deleteRuleContent', 'Are you sure you want to delete this kitchen station routing rule?')
        }
        confirmLabel={t('common.delete', 'Delete')}
        confirmColor="error"
      />
    </Box>
  );
}
