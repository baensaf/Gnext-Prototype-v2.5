import type { Branch } from 'src/api/tenantApi';

import React, { useState, useEffect, useCallback } from 'react';

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

import { tenantApi } from 'src/api/tenantApi';
import { httpClient as axios } from 'src/api/httpClient';

export function OfflineSyncPage() {
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [workerResult, setWorkerResult] = useState<any>(null);

  // Conflict Resolution Modal
  const [activeConflict, setActiveConflict] = useState<any>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<'ACCEPT_CLIENT' | 'ACCEPT_SERVER' | 'MANUAL_OVERRIDE'>('ACCEPT_CLIENT');
  const [customOverrideJson, setCustomOverrideJson] = useState<string>('{}');

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
    <Box sx={{ p: 3 }}>
      <Stack direction="row" spacing={1.5} sx={{ mb: 1, alignItems: 'center' }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
          Offline Sync & Conflict Simulator
        </Typography>
        <Chip label="V5 Preview" color="info" size="small" sx={{ fontWeight: 'bold' }} />
      </Stack>

      <Alert severity="info" variant="outlined" sx={{ mb: 3, borderRadius: 2, fontWeight: 500 }}>
        V5 Preview Module: Cloud-branch offline operation envelope queue, DLQ retry workers & conflict resolution engine. Retained for V5 architectural validation.
      </Alert>

      {/* Branch Context Selector */}
      <Paper sx={{ p: 2, mb: 3, borderRadius: 3 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 300 }}>
            <InputLabel id="branch-select-label">Active Branch Context</InputLabel>
            <Select
              labelId="branch-select-label"
              id="branch-select"
              value={selectedBranchId}
              label="Active Branch Context"
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
            Selected Branch UUID: <strong>{selectedBranchId || 'None Selected'}</strong>
          </Typography>
        </Stack>
      </Paper>

      {!selectedBranchId && (
        <Alert severity="warning" sx={{ mb: 3, borderRadius: 3 }}>
          No branch context selected. Please select a valid branch to perform offline sync operations.
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
            label={isOnline ? 'ONLINE' : 'OFFLINE SIMULATED'}
            sx={{ fontWeight: 'bold' }}
          />
        }
      >
        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
          Branch Connectivity Mode: {isOnline ? 'Online Connected' : 'Offline Disconnected'}
        </Typography>
        <Typography variant="body2">
          Agent Version: <strong>{syncStatus?.agent_version || 'v2.0.0-sim'}</strong> | Health: <strong>{syncStatus?.agent_health || 'HEALTHY'}</strong>
        </Typography>
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
          Last Sync: {syncStatus?.last_synced_at ? new Date(syncStatus.last_synced_at).toLocaleString() : 'Never'} | Offline Since: {syncStatus?.offline_since ? new Date(syncStatus.offline_since).toLocaleString() : 'N/A'}
        </Typography>
      </Alert>

      {workerResult && (
        <Alert severity={workerResult.advanced_last_sync ? 'success' : 'warning'} sx={{ mb: 3, borderRadius: 3 }} onClose={() => setWorkerResult(null)}>
          <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
            Sync Worker Run Results: {workerResult.advanced_last_sync ? '100% Batch Succeeded (Last Sync Advanced)' : 'Batch Included Conflicts/Failures (Last Sync Preserved)'}
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
            <Typography color="text.secondary">Pending Queue Items</Typography>
            <Typography variant="h3" color="warning.main" sx={{ fontWeight: 'bold' }}>
              {syncStatus?.pending_queue_count ?? 0}
            </Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 3 }}>
          <Card sx={{ p: 3, borderRadius: 3, textAlign: 'center' }}>
            <Typography color="text.secondary">DLQ / Failed Items</Typography>
            <Typography variant="h3" color="error.main" sx={{ fontWeight: 'bold' }}>
              {syncStatus?.dlq_count ?? 0}
            </Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3, borderRadius: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
              Sync Engine & Queue Controls
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5 }}>
              <Button variant="outlined" color="primary" onClick={() => handleEnqueueSampleOrder('NORMAL')} disabled={loading}>
                + Offline Order
              </Button>
              <Button variant="outlined" color="warning" onClick={() => handleEnqueueSampleOrder('CONFLICT')} disabled={loading}>
                + Price Conflict
              </Button>
              <Button variant="outlined" color="error" onClick={() => handleEnqueueSampleOrder('DLQ')} disabled={loading}>
                + DLQ Failure
              </Button>
              <Button variant="outlined" color="info" onClick={() => handleEnqueueSampleOrder('DEDUPE')} disabled={loading}>
                + Dedupe Key Order
              </Button>
              <Button variant="contained" color="primary" onClick={handleTriggerSyncWorker} disabled={loading}>
                Trigger Sync Worker
              </Button>
            </Stack>
          </Card>
        </Grid>
      </Grid>

      {/* Pending / Synced Queue Table */}
      <Card sx={{ p: 3, borderRadius: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
          Offline Transaction Queue ({(Array.isArray(queueItems) ? queueItems : []).length} items)
        </Typography>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead sx={{ bgcolor: 'background.neutral' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold' }}>Item ID</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Entity Type</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Dedupe Key</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Retries</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Conflict / Error</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Actions</TableCell>
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
                        Clone for Retry
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Conflicts Table */}
      <Card sx={{ p: 3, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
          Sync Conflict Resolution Center ({(Array.isArray(conflicts) ? conflicts : []).length} records)
        </Typography>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead sx={{ bgcolor: 'background.neutral' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold' }}>Conflict ID</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Conflict Type</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Resolution Strategy</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Timestamp</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Action</TableCell>
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
                      Resolve Diff
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Side-by-side Conflict Diff Resolution Modal */}
      <Dialog open={Boolean(activeConflict)} onClose={() => setActiveConflict(null)} maxWidth="md" fullWidth>
        {activeConflict && (
          <>
            <DialogTitle sx={{ fontWeight: 'bold' }}>
              Resolve Sync Conflict: {activeConflict.conflict_type}
            </DialogTitle>
            <DialogContent dividers>
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1, color: 'primary.main' }}>
                    Client State (Local Original):
                  </Typography>
                  <Paper sx={{ p: 2, bgcolor: 'background.neutral', fontFamily: 'monospace' }} variant="outlined">
                    <pre style={{ margin: 0 }}>{JSON.stringify(activeConflict.client_state, null, 2)}</pre>
                  </Paper>
                </Grid>

                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1, color: 'secondary.main' }}>
                    Server State (Cloud Original):
                  </Typography>
                  <Paper sx={{ p: 2, bgcolor: 'background.neutral', fontFamily: 'monospace' }} variant="outlined">
                    <pre style={{ margin: 0 }}>{JSON.stringify(activeConflict.server_state, null, 2)}</pre>
                  </Paper>
                </Grid>
              </Grid>

              <Box sx={{ mt: 3 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                  Choose Resolution Strategy:
                </Typography>
                <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                  <Button
                    variant={selectedStrategy === 'ACCEPT_CLIENT' ? 'contained' : 'outlined'}
                    color="primary"
                    onClick={() => setSelectedStrategy('ACCEPT_CLIENT')}
                  >
                    Accept Local Version
                  </Button>
                  <Button
                    variant={selectedStrategy === 'ACCEPT_SERVER' ? 'contained' : 'outlined'}
                    color="secondary"
                    onClick={() => setSelectedStrategy('ACCEPT_SERVER')}
                  >
                    Accept Cloud Version
                  </Button>
                  <Button
                    variant={selectedStrategy === 'MANUAL_OVERRIDE' ? 'contained' : 'outlined'}
                    color="warning"
                    onClick={() => setSelectedStrategy('MANUAL_OVERRIDE')}
                  >
                    Merged / Manual Override
                  </Button>
                </Stack>

                {selectedStrategy === 'MANUAL_OVERRIDE' && (
                  <Box sx={{ mt: 2 }}>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                      Financial payloads must obey domain validation rules. Arbitrary or unvalidated financial JSON will be rejected.
                    </Alert>
                    <TextField
                      fullWidth
                      multiline
                      rows={6}
                      label="Merged Domain Payload (JSON)"
                      value={customOverrideJson}
                      onChange={(e) => setCustomOverrideJson(e.target.value)}
                      sx={{ fontFamily: 'monospace' }}
                    />
                  </Box>
                )}
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setActiveConflict(null)}>Cancel</Button>
              <Button variant="contained" color="success" onClick={handleResolveConflict}>
                Confirm Resolution
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}

export default OfflineSyncPage;
