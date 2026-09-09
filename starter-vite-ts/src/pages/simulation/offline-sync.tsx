import type { Branch } from 'src/api/tenantApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback, useMemo } from 'react';

import {
  Box,
  Card,
  Grid,
  Chip,
  Table,
  Paper,
  Stack,
  Alert,
  Button,
  Dialog,
  Switch,
  Select,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  InputLabel,
  DialogTitle,
  FormControl,
  DialogContent,
  DialogActions,
  TableContainer,
  FormControlLabel,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SyncIcon from '@mui/icons-material/Sync';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import { tenantApi } from 'src/api/tenantApi';
import { httpClient as axios } from 'src/api/httpClient';
import { useScopedBranchId } from 'src/contexts/branch-context';

export function OfflineSyncPage() {
  const { t } = useTranslation();
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useScopedBranchId();
  const [loading, setLoading] = useState(false);
  const [workerResult, setWorkerResult] = useState<any>(null);

  // Conflict Resolution Modal
  const [activeConflict, setActiveConflict] = useState<any>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<'ACCEPT_CLIENT' | 'ACCEPT_SERVER' | 'MANUAL_OVERRIDE'>('ACCEPT_CLIENT');
  const [customOverrideJson, setCustomOverrideJson] = useState<string>('{}');

  const isOverrideJsonValid = useMemo(() => {
    try {
      JSON.parse(customOverrideJson);
      return true;
    } catch {
      return false;
    }
  }, [customOverrideJson]);

  useEffect(() => {
    tenantApi
      .getBranches()
      .then((bList) => {
        setBranches(bList || []);
        if (bList && bList.length > 0) {
          setSelectedBranchId(bList[0].id);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch branches:', err);
      });
  }, []);

  const fetchSyncData = useCallback(async (branchId?: string) => {
    const bId = branchId || selectedBranchId;
    if (!bId) return;
    setLoading(true);
    try {
      const [statusRes, queueRes, conflictRes] = await Promise.all([
        axios.get('/api/v1/sync/status', { params: { branchId: bId } }),
        axios.get('/api/v1/sync/queue', { params: { branchId: bId } }),
        axios.get('/api/v1/sync/conflicts'),
      ]);
      setSyncStatus(statusRes.data || null);

      const qData = Array.isArray(queueRes.data)
        ? queueRes.data
        : Array.isArray(queueRes.data?.data)
        ? queueRes.data.data
        : [];
      setQueueItems(qData);

      const cData = Array.isArray(conflictRes.data)
        ? conflictRes.data
        : Array.isArray(conflictRes.data?.data)
        ? conflictRes.data.data
        : [];
      setConflicts(cData);
    } catch (err) {
      console.error('Failed to load sync data:', err);
      setSyncStatus(null);
      setQueueItems([]);
      setConflicts([]);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId]);

  useEffect(() => {
    if (selectedBranchId) {
      fetchSyncData(selectedBranchId);
    }
  }, [selectedBranchId, fetchSyncData]);

  const handleToggleConnectivity = async (isOnline: boolean) => {
    if (!selectedBranchId) {
      alert('Please select a valid branch first');
      return;
    }
    setLoading(true);
    try {
      await axios.post('/api/v1/sync/toggle-connectivity', {
        branchId: selectedBranchId,
        isOnline,
      });
      fetchSyncData(selectedBranchId);
    } catch {
      alert('Failed to toggle connectivity');
    } finally {
      setLoading(false);
    }
  };

  const handleEnqueueSampleOrder = async (scenario: 'NORMAL' | 'CONFLICT' | 'DLQ' | 'DEDUPE') => {
    if (!selectedBranchId) {
      alert('Please select a valid branch first');
      return;
    }
    setLoading(true);
    try {
      const payload: any = {
        order_num: `OFF-${Date.now().toString().slice(-4)}`,
        items: [{ product_id: 'prod-burger-101', quantity: 1 }],
      };
      let dedupeKey: string | undefined = undefined;

      if (scenario === 'CONFLICT') {
        payload.simulate_conflict = 'PRICE_MISMATCH';
      } else if (scenario === 'DLQ') {
        payload.simulate_dlq = true;
      } else if (scenario === 'DEDUPE') {
        dedupeKey = 'DEDUPE-FIXED-KEY-101';
      }

      const res = await axios.post('/api/v1/sync/queue', {
        branch_id: selectedBranchId,
        entity_type: 'ORDER',
        payload,
        dedupe_key: dedupeKey,
      });

      if (res.data?.is_duplicate) {
        alert('Duplicate operation detected! Active queue item returned.');
      }

      fetchSyncData(selectedBranchId);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Enqueue failed');
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerSyncWorker = async () => {
    if (!selectedBranchId) {
      alert('Please select a valid branch first');
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post('/api/v1/sync/trigger', { branchId: selectedBranchId });
      setWorkerResult(res.data);
      fetchSyncData(selectedBranchId);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Sync worker failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCloneDlqItem = async (queueItemId: string) => {
    setLoading(true);
    try {
      await axios.post(`/api/v1/sync/queue/${queueItemId}/retry`);
      fetchSyncData();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to clone DLQ item');
    } finally {
      setLoading(false);
    }
  };

  const handleResolveConflict = async () => {
    if (!activeConflict) return;
    setLoading(true);
    try {
      let overridePayload: any = undefined;
      if (selectedStrategy === 'MANUAL_OVERRIDE') {
        try {
          overridePayload = JSON.parse(customOverrideJson);
        } catch {
          alert('Invalid JSON in override payload editor');
          setLoading(false);
          return;
        }
      }

      await axios.post('/api/v1/sync/resolve-conflict', {
        conflict_id: activeConflict.id,
        resolution_strategy: selectedStrategy,
        override_payload: overridePayload,
      });
      setActiveConflict(null);
      fetchSyncData();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to resolve conflict');
    } finally {
      setLoading(false);
    }
  };

  const isOnline = syncStatus?.is_online ?? true;

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <CustomBreadcrumbs
        heading={t('simulation.sync.title', 'Offline Sync & Conflict Simulator')}
        links={[
          { name: t('nav.dashboard', 'Home'), href: '/app/pos' },
          { name: t('simulation.breadcrumb', 'Simulation Hub'), href: '/app/simulation' },
          { name: t('simulation.sync.title', 'Offline Sync Engine') },
        ]}
        action={
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => fetchSyncData()}
            disabled={loading}
            sx={{ fontWeight: 'bold' }}
          >
            {t('simulation.hub.refreshLogs', 'Refresh Status')}
          </Button>
        }
      />

      <Alert severity="info" variant="outlined" sx={{ mb: 3, borderRadius: 2, fontWeight: 500 }}>
        {t('simulation.sync.v5Notice', 'V5 Preview Module: Cloud-branch offline operation envelope queue, DLQ retry workers & conflict resolution engine. Retained for V5 architectural validation.')}
      </Alert>

      {/* Branch Context Selector */}
      <Paper sx={{ p: 2, mb: 3, borderRadius: 3 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 300 }}>
            <InputLabel id="branch-select-label">{t('simulation.sync.branchLabel', 'Active Branch Context')}</InputLabel>
            <Select
              labelId="branch-select-label"
              id="branch-select"
              value={selectedBranchId}
              label={t('simulation.sync.branchLabel', 'Active Branch Context')}
              onChange={(e) => setSelectedBranchId(e.target.value)}
            >
              {branches.map((b) => (
                <MenuItem key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary">
            {t('simulation.sync.branchUuid', 'Selected Branch UUID')}: <strong>{selectedBranchId || t('simulation.sync.noBranch', 'None Selected')}</strong>
          </Typography>
        </Stack>
      </Paper>

      {!selectedBranchId && (
        <Alert severity="warning" sx={{ mb: 3, borderRadius: 3 }}>
          {t('simulation.sync.noBranchWarning', 'No branch context selected. Please select a valid branch to perform offline sync operations.')}
        </Alert>
      )}

      {/* Connectivity Banner */}
      <Alert
        severity={isOnline ? 'success' : 'error'}
        sx={{ mb: 3, p: 2, borderRadius: 3 }}
        action={
          <FormControlLabel
            control={
              <Switch
                checked={isOnline}
                onChange={(e) => handleToggleConnectivity(e.target.checked)}
                color="success"
              />
            }
            label={isOnline ? t('simulation.sync.online', 'ONLINE') : t('simulation.sync.offline', 'OFFLINE SIMULATED')}
            sx={{ fontWeight: 'bold' }}
          />
        }
      >
        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
          {t('simulation.sync.connectivityTitle', 'Branch Connectivity Mode')}: {isOnline ? t('simulation.sync.connected', 'Online Connected') : t('simulation.sync.disconnected', 'Offline Disconnected')}
        </Typography>
        <Typography variant="body2">
          {t('simulation.sync.agentVersion', 'Agent Version')}: <strong>{syncStatus?.agent_version || 'v2.0.0-sim'}</strong> | {t('simulation.sync.health', 'Health')}: <strong>{syncStatus?.agent_health || 'HEALTHY'}</strong>
        </Typography>
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
          {t('simulation.sync.lastSync', 'Last Sync')}: {syncStatus?.last_synced_at ? new Date(syncStatus.last_synced_at).toLocaleString() : 'Never'} | {t('simulation.sync.offlineSince', 'Offline Since')}: {syncStatus?.offline_since ? new Date(syncStatus.offline_since).toLocaleString() : 'N/A'}
        </Typography>
      </Alert>

      {workerResult && (
        <Alert severity={workerResult.advanced_last_sync ? 'success' : 'warning'} sx={{ mb: 3, borderRadius: 3 }} onClose={() => setWorkerResult(null)}>
          <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
            {t('simulation.sync.workerTitle', 'Sync Worker Run Results')}: {workerResult.advanced_last_sync ? t('simulation.sync.batchSuccess', '100% Batch Succeeded (Last Sync Advanced)') : t('simulation.sync.batchConflict', 'Batch Included Conflicts/Failures (Last Sync Preserved)')}
          </Typography>
          <Typography variant="body2">
            Processed: {workerResult.processed_count} | Synced: {workerResult.synced_count} | Conflicts: {workerResult.conflict_count} | DLQ Failures: {workerResult.dlq_count}
          </Typography>
          {workerResult.category_counts && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
              Categories: Orders: {workerResult.category_counts.orders}, Payments: {workerResult.category_counts.payments}, Refunds: {workerResult.category_counts.refunds}, Customers: {workerResult.category_counts.customers}
            </Typography>
          )}
        </Alert>
      )}

      {/* Sync Overview & Worker Controls */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 3 }}>
          <Card sx={{ p: 3, borderRadius: 3, textAlign: 'center' }}>
            <Typography color="text.secondary">{t('simulation.sync.pendingCount', 'Pending Queue Items')}</Typography>
            <Typography variant="h3" color="warning.main" sx={{ fontWeight: 'bold' }}>
              {syncStatus?.pending_queue_count ?? 0}
            </Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 3 }}>
          <Card sx={{ p: 3, borderRadius: 3, textAlign: 'center' }}>
            <Typography color="text.secondary">{t('simulation.sync.dlqCount', 'DLQ / Failed Items')}</Typography>
            <Typography variant="h3" color="error.main" sx={{ fontWeight: 'bold' }}>
              {syncStatus?.dlq_count ?? 0}
            </Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3, borderRadius: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
              {t('simulation.sync.controlsTitle', 'Sync Engine & Queue Controls')}
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5 }}>
              <Button variant="outlined" color="primary" onClick={() => handleEnqueueSampleOrder('NORMAL')} disabled={loading}>
                {t('simulation.sync.btnOfflineOrder', '+ Offline Order')}
              </Button>
              <Button variant="outlined" color="warning" onClick={() => handleEnqueueSampleOrder('CONFLICT')} disabled={loading}>
                {t('simulation.sync.btnConflictOrder', '+ Price Conflict')}
              </Button>
              <Button variant="outlined" color="error" onClick={() => handleEnqueueSampleOrder('DLQ')} disabled={loading}>
                {t('simulation.sync.btnDlqOrder', '+ DLQ Failure')}
              </Button>
              <Button variant="outlined" color="info" onClick={() => handleEnqueueSampleOrder('DEDUPE')} disabled={loading}>
                {t('simulation.sync.btnDedupeOrder', '+ Dedupe Key Order')}
              </Button>
              <Button variant="contained" color="primary" startIcon={<SyncIcon />} onClick={handleTriggerSyncWorker} disabled={loading} sx={{ fontWeight: 'bold' }}>
                {t('simulation.sync.btnTriggerWorker', 'Trigger Sync Worker')}
              </Button>
            </Stack>
          </Card>
        </Grid>
      </Grid>

      {/* Pending / Synced Queue Table */}
      <Card sx={{ p: 3, borderRadius: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
          {t('simulation.sync.queueTitle', 'Offline Transaction Queue')} ({(Array.isArray(queueItems) ? queueItems : []).length} items)
        </Typography>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead sx={{ bgcolor: 'background.neutral' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.sync.table.itemId', 'Item ID')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.sync.table.entityType', 'Entity Type')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.sync.table.status', 'Status')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.sync.table.dedupeKey', 'Dedupe Key')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.sync.table.retries', 'Retries')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.sync.table.conflictError', 'Conflict / Error')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.sync.table.actions', 'Actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(Array.isArray(queueItems) ? queueItems : []).map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{item.id.slice(0, 8)}...</TableCell>
                  <TableCell>
                    <Chip label={item.entity_type} size="small" color="primary" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={item.status}
                      size="small"
                      color={
                        item.status === 'SYNCED'
                          ? 'success'
                          : item.status === 'PENDING'
                          ? 'warning'
                          : item.status === 'CONFLICT'
                          ? 'error'
                          : item.status === 'DLQ_FAILED'
                          ? 'error'
                          : 'default'
                      }
                    />
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{item.dedupe_key || '-'}</TableCell>
                  <TableCell>{item.retry_count}</TableCell>
                  <TableCell>{item.conflict_reason || '-'}</TableCell>
                  <TableCell>
                    {item.status === 'DLQ_FAILED' && (
                      <Button size="small" variant="contained" color="secondary" onClick={() => handleCloneDlqItem(item.id)} disabled={loading}>
                        {t('simulation.sync.table.cloneDlq', 'Clone for Retry')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {queueItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                    {t('simulation.sync.noQueue', 'No queued transactions in this branch context.')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Conflicts Table */}
      <Card sx={{ p: 3, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
          {t('simulation.sync.conflictTitle', 'Sync Conflict Resolution Center')} ({(Array.isArray(conflicts) ? conflicts : []).length} records)
        </Typography>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead sx={{ bgcolor: 'background.neutral' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.sync.table.conflictId', 'Conflict ID')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.sync.table.conflictType', 'Conflict Type')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.sync.table.strategy', 'Resolution Strategy')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.sync.table.timestamp', 'Timestamp')}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.sync.table.action', 'Action')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(Array.isArray(conflicts) ? conflicts : []).map((conf) => (
                <TableRow key={conf.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{conf.id.slice(0, 8)}...</TableCell>
                  <TableCell>
                    <Chip label={conf.conflict_type} color="error" size="small" />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={conf.resolution_strategy}
                      color={conf.resolution_strategy === 'UNRESOLVED' ? 'warning' : 'success'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{new Date(conf.created_at).toLocaleString()}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={conf.resolution_strategy !== 'UNRESOLVED'}
                      onClick={() => {
                        setActiveConflict(conf);
                        setSelectedStrategy('ACCEPT_CLIENT');
                        setCustomOverrideJson(JSON.stringify(conf.client_state, null, 2));
                      }}
                    >
                      {t('simulation.sync.btnResolveDiff', 'Resolve Diff')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {conflicts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                    {t('simulation.sync.noConflicts', 'No active sync conflicts recorded.')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Side-by-side Conflict Diff Resolution Modal */}
      <Dialog open={Boolean(activeConflict)} onClose={() => setActiveConflict(null)} maxWidth="md" fullWidth>
        {activeConflict && (
          <>
            <DialogTitle sx={{ fontWeight: 'bold' }}>
              {t('simulation.sync.modal.title', 'Resolve Sync Conflict')}: {activeConflict.conflict_type}
            </DialogTitle>
            <DialogContent dividers>
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1, color: 'primary.main' }}>
                    {t('simulation.sync.modal.clientState', 'Client State (Local Original)')}:
                  </Typography>
                  <Paper sx={{ p: 2, bgcolor: '#1e1e1e', color: '#00ffcc', fontFamily: 'monospace', fontSize: 12, maxHeight: 220, overflow: 'auto' }} variant="outlined">
                    <pre style={{ margin: 0 }}>{JSON.stringify(activeConflict.client_state, null, 2)}</pre>
                  </Paper>
                </Grid>

                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1, color: 'secondary.main' }}>
                    {t('simulation.sync.modal.serverState', 'Server State (Cloud Original)')}:
                  </Typography>
                  <Paper sx={{ p: 2, bgcolor: '#1e1e1e', color: '#ffcc00', fontFamily: 'monospace', fontSize: 12, maxHeight: 220, overflow: 'auto' }} variant="outlined">
                    <pre style={{ margin: 0 }}>{JSON.stringify(activeConflict.server_state, null, 2)}</pre>
                  </Paper>
                </Grid>
              </Grid>

              <Box sx={{ mt: 3 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                  {t('simulation.sync.modal.chooseStrategy', 'Choose Resolution Strategy')}:
                </Typography>
                <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
                  <Button
                    variant={selectedStrategy === 'ACCEPT_CLIENT' ? 'contained' : 'outlined'}
                    color="primary"
                    onClick={() => setSelectedStrategy('ACCEPT_CLIENT')}
                  >
                    {t('simulation.sync.modal.acceptLocal', 'Accept Local Version')}
                  </Button>
                  <Button
                    variant={selectedStrategy === 'ACCEPT_SERVER' ? 'contained' : 'outlined'}
                    color="secondary"
                    onClick={() => setSelectedStrategy('ACCEPT_SERVER')}
                  >
                    {t('simulation.sync.modal.acceptCloud', 'Accept Cloud Version')}
                  </Button>
                  <Button
                    variant={selectedStrategy === 'MANUAL_OVERRIDE' ? 'contained' : 'outlined'}
                    color="warning"
                    onClick={() => setSelectedStrategy('MANUAL_OVERRIDE')}
                  >
                    {t('simulation.sync.modal.manualOverride', 'Merged / Manual Override')}
                  </Button>
                </Stack>

                {selectedStrategy === 'MANUAL_OVERRIDE' && (
                  <Box sx={{ mt: 2 }}>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                      {t('simulation.sync.modal.validationWarning', 'Financial payloads must obey domain validation rules. Arbitrary or unvalidated financial JSON will be rejected.')}
                    </Alert>
                    <Box sx={{ mb: 1, display: 'flex', justifyContent: 'flex-end' }}>
                      <Chip
                        label={isOverrideJsonValid ? 'JSON Valid' : 'Invalid JSON Syntax'}
                        color={isOverrideJsonValid ? 'success' : 'error'}
                        size="small"
                      />
                    </Box>
                    <TextField
                      fullWidth
                      multiline
                      rows={6}
                      label={t('simulation.sync.modal.overridePayloadLabel', 'Merged Domain Payload (JSON)')}
                      value={customOverrideJson}
                      onChange={(e) => setCustomOverrideJson(e.target.value)}
                      error={!isOverrideJsonValid}
                      helperText={!isOverrideJsonValid ? 'Please provide valid JSON syntax' : ''}
                      sx={{ fontFamily: 'monospace' }}
                    />
                  </Box>
                )}
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setActiveConflict(null)}>
                {t('simulation.sync.modal.cancel', 'Cancel')}
              </Button>
              <Button
                variant="contained"
                color="success"
                onClick={handleResolveConflict}
                disabled={selectedStrategy === 'MANUAL_OVERRIDE' && !isOverrideJsonValid}
              >
                {t('simulation.sync.modal.confirm', 'Confirm Resolution')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}

export default OfflineSyncPage;
