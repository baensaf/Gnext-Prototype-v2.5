import axios from 'axios';
import React, { useState, useEffect } from 'react';

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
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
  FormControlLabel,
} from '@mui/material';

export function OfflineSyncPage() {
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Conflict Resolution Modal
  const [activeConflict, setActiveConflict] = useState<any>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<'ACCEPT_CLIENT' | 'ACCEPT_SERVER' | 'MANUAL_OVERRIDE'>('ACCEPT_CLIENT');

  const fetchSyncData = async () => {
    setLoading(true);
    try {
      const [statusRes, queueRes, conflictRes] = await Promise.all([
        axios.get('/api/v1/sync/status'),
        axios.get('/api/v1/sync/queue'),
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
      setQueueItems([]);
      setConflicts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSyncData();
  }, []);

  const handleToggleConnectivity = async (isOnline: boolean) => {
    setLoading(true);
    try {
      await axios.post('/api/v1/sync/toggle-connectivity', {
        branchId: 'default-branch',
        isOnline,
      });
      fetchSyncData();
    } catch (err) {
      alert('Failed to toggle connectivity');
    } finally {
      setLoading(false);
    }
  };

  const handleEnqueueSampleOrder = async (simulateConflict: boolean = false) => {
    setLoading(true);
    try {
      const payload: any = {
        order_num: `OFF-${Date.now().toString().slice(-4)}`,
        items: [{ name: 'Cheeseburger', qty: 1, price: '12.00' }],
        total: '12.00',
      };
      if (simulateConflict) {
        payload.simulate_conflict = 'PRICE_MISMATCH';
      }

      await axios.post('/api/v1/sync/queue', {
        branch_id: 'default-branch',
        entity_type: 'ORDER',
        payload,
      });
      fetchSyncData();
    } catch (err) {
      alert('Enqueue failed');
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerSyncWorker = async () => {
    setLoading(true);
    try {
      const res = await axios.post('/api/v1/sync/trigger', { branchId: 'default-branch' });
      alert(`Sync Worker Complete! Processed: ${res.data.processed_count}, Synced: ${res.data.synced_count}, Conflicts: ${res.data.conflict_count}`);
      fetchSyncData();
    } catch (err) {
      alert('Sync worker failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResolveConflict = async () => {
    if (!activeConflict) return;
    setLoading(true);
    try {
      await axios.post('/api/v1/sync/resolve-conflict', {
        conflict_id: activeConflict.id,
        resolution_strategy: selectedStrategy,
      });
      setActiveConflict(null);
      fetchSyncData();
    } catch (err) {
      alert('Failed to resolve conflict');
    } finally {
      setLoading(false);
    }
  };

  const isOnline = syncStatus?.is_online ?? true;

  return (
    <Box sx={{ p: 3 }}>
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
          {isOnline
            ? 'Transactions pass directly to server. Background sync worker is ready.'
            : 'All POS & Kiosk transactions are stored in local offline queue until re-connected.'}
        </Typography>
      </Alert>

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
            <Typography color="text.secondary">Detected Sync Conflicts</Typography>
            <Typography variant="h3" color="error.main" sx={{ fontWeight: 'bold' }}>
              {syncStatus?.conflict_count ?? 0}
            </Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3, borderRadius: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
              Sync Engine & Queue Controls
            </Typography>
            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                color="secondary"
                onClick={() => handleEnqueueSampleOrder(false)}
                disabled={loading}
              >
                Enqueue Offline POS Order
              </Button>
              <Button
                variant="outlined"
                color="warning"
                onClick={() => handleEnqueueSampleOrder(true)}
                disabled={loading}
              >
                Enqueue Price Conflict Order
              </Button>
              <Button
                variant="contained"
                color="primary"
                onClick={handleTriggerSyncWorker}
                disabled={loading}
              >
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
                <TableCell sx={{ fontWeight: 'bold' }}>Retries</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Conflict / Detail</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Created At</TableCell>
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
                          : 'default'
                      }
                    />
                  </TableCell>
                  <TableCell>{item.retry_count}</TableCell>
                  <TableCell>{item.conflict_reason || '-'}</TableCell>
                  <TableCell>{new Date(item.created_at).toLocaleString()}</TableCell>
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
                    Client State (Offline POS):
                  </Typography>
                  <Paper sx={{ p: 2, bgcolor: 'background.neutral', fontFamily: 'monospace' }} variant="outlined">
                    <pre style={{ margin: 0 }}>{JSON.stringify(activeConflict.client_state, null, 2)}</pre>
                  </Paper>
                </Grid>

                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1, color: 'secondary.main' }}>
                    Server State (Central DB):
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
                <Stack direction="row" spacing={2}>
                  <Button
                    variant={selectedStrategy === 'ACCEPT_CLIENT' ? 'contained' : 'outlined'}
                    color="primary"
                    onClick={() => setSelectedStrategy('ACCEPT_CLIENT')}
                  >
                    Accept Client Version
                  </Button>
                  <Button
                    variant={selectedStrategy === 'ACCEPT_SERVER' ? 'contained' : 'outlined'}
                    color="secondary"
                    onClick={() => setSelectedStrategy('ACCEPT_SERVER')}
                  >
                    Accept Server Version
                  </Button>
                </Stack>
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
