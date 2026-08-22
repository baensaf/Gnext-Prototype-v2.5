import type { PrintJob } from 'src/api/kdsApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import PrintIcon from '@mui/icons-material/Print';
import ReplayIcon from '@mui/icons-material/Replay';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  Box,
  Card,
  Chip,
  Table,
  Stack,
  Alert,
  Paper,
  Button,
  Dialog,
  Select,
  Tooltip,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  IconButton,
  InputLabel,
  DialogTitle,
  FormControl,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { kdsApi } from 'src/api/kdsApi';

export function PrintQueuePage() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [_total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [docTypeFilter, setDocTypeFilter] = useState<string>('');
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Preview & Outcome Modals
  const [previewJob, setPreviewJob] = useState<PrintJob | null>(null);

  const [outcomeJob, setOutcomeJob] = useState<PrintJob | null>(null);
  const [outcomeVal, setOutcomeVal] = useState<'SUCCESS' | 'FAILED'>('SUCCESS');
  const [useFallback, _setUseFallback] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await kdsApi.getPrintJobs({
        status: statusFilter || undefined,
        documentType: docTypeFilter || undefined,
      });
      setJobs(res.items);
      setTotal(res.total);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to load print queue');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, docTypeFilter]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleSimulateOutcome = async () => {
    if (!outcomeJob) return;
    try {
      await kdsApi.simulatePrintOutcome({
        printJobId: outcomeJob.id,
        outcome: outcomeVal,
        useFallback,
      });
      setOutcomeJob(null);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to simulate outcome');
    }
  };

  const handleRetryJob = async (id: string) => {
    try {
      await kdsApi.retryPrintJob(id, { useFallback: true });
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to retry print job');
    }
  };

  const handleReprintJob = async (id: string) => {
    try {
      await kdsApi.reprintJob(id, 'Manual Reprint Request');
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to enqueue reprint job');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'SUCCESS': return 'success';
      case 'FAILED': return 'error';
      case 'QUEUED': return 'info';
      case 'PROCESSING': return 'warning';
      default: return 'default';
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Alert severity="info" variant="outlined" sx={{ mb: 3, borderRadius: 2, fontWeight: 500 }}>
        {t('inventory.v5Banner', 'ماژول پیش‌نمایش نسخه ۵: مدیریت صف چاپ شبیه‌سازی‌شده و صدور مجدد فیش.')}
      </Alert>

      <Stack direction="row" sx={{ mb: 3, justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Typography variant="h4" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
              {t('printQueue.title', 'Print Queue & History')}
            </Typography>
            <Chip label="V5 Preview" color="info" size="small" sx={{ fontWeight: 'bold' }} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t('nav.hardwareSimDesc', 'View generated print jobs, preview rendered HTML receipts, simulate printer hardware outcomes, and trigger reprints.')}
          </Typography>
        </Box>

        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
          {t('monitoring.refresh', 'Refresh')}
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3, borderRadius: 2 }}>
        <Stack direction="row" spacing={2}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{t('printQueue.filterStatus', 'Status')}</InputLabel>
            <Select value={statusFilter} label={t('printQueue.filterStatus', 'Status')} onChange={(e) => setStatusFilter(e.target.value)}>
              <MenuItem value="">{t('printQueue.allStatuses', 'All Statuses')}</MenuItem>
              <MenuItem value="QUEUED">QUEUED</MenuItem>
              <MenuItem value="PROCESSING">PROCESSING</MenuItem>
              <MenuItem value="SUCCESS">SUCCESS</MenuItem>
              <MenuItem value="FAILED">FAILED</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>{t('printQueue.filterDocType', 'Document Type')}</InputLabel>
            <Select value={docTypeFilter} label={t('printQueue.filterDocType', 'Document Type')} onChange={(e) => setDocTypeFilter(e.target.value)}>
              <MenuItem value="">{t('printQueue.allDocTypes', 'All Document Types')}</MenuItem>
              <MenuItem value="CUSTOMER_RECEIPT">Customer Receipt</MenuItem>
              <MenuItem value="KITCHEN_TICKET">Kitchen Ticket</MenuItem>
              <MenuItem value="COURIER_SLIP">Courier Slip</MenuItem>
              <MenuItem value="GUEST_BILL">Guest Bill</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {/* Jobs Table */}
      <Card sx={{ borderRadius: 2 }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('printQueue.columnJobId', 'Job ID')}</TableCell>
              <TableCell>{t('printQueue.columnType', 'Document Type')}</TableCell>
              <TableCell>{t('payments.columnOrder', 'Entity')}</TableCell>
              <TableCell>{t('printQueue.columnStatus', 'Status')}</TableCell>
              <TableCell>{t('printQueue.columnAttempts', 'Copies')}</TableCell>
              <TableCell>{t('printQueue.reprint', 'Reprint')}</TableCell>
              <TableCell>{t('printQueue.columnCreatedAt', 'Created At')}</TableCell>
              <TableCell align="right">{t('printQueue.columnActions', 'Actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell><code>{job.id.slice(0, 8)}...</code></TableCell>
                <TableCell><strong>{job.document_type}</strong></TableCell>
                <TableCell>{job.entity_type} #{job.entity_id.slice(0, 8)}</TableCell>
                <TableCell>
                  <Chip label={job.status} color={getStatusColor(job.status) as any} size="small" />
                </TableCell>
                <TableCell>{job.copies}</TableCell>
                <TableCell>
                  {job.is_reprint ? <Chip label="REPRINT" color="warning" size="small" /> : <Chip label="ORIGINAL" size="small" variant="outlined" />}
                </TableCell>
                <TableCell>{new Date(job.created_at).toLocaleString()}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    <Tooltip title="Preview Rendered HTML">
                      <IconButton color="primary" onClick={() => setPreviewJob(job)}>
                        <VisibilityIcon />
                      </IconButton>
                    </Tooltip>

                    <Tooltip title="Simulate Printer Outcome">
                      <IconButton color="info" onClick={() => { setOutcomeJob(job); setOutcomeVal('SUCCESS'); }}>
                        <PlayArrowIcon />
                      </IconButton>
                    </Tooltip>

                    {job.status === 'FAILED' && (
                      <Tooltip title="Retry Job">
                        <IconButton color="warning" onClick={() => handleRetryJob(job.id)}>
                          <ReplayIcon />
                        </IconButton>
                      </Tooltip>
                    )}

                    <Tooltip title="Reprint Document">
                      <IconButton color="secondary" onClick={() => handleReprintJob(job.id)}>
                        <PrintIcon />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}

            {jobs.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                  {t('printQueue.noJobsFound', 'No print jobs found in queue.')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Rendered HTML Preview Modal */}
      <Dialog open={Boolean(previewJob)} onClose={() => setPreviewJob(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('printQueue.simulateOutcome', 'Simulated Thermal Print Preview')}</DialogTitle>
        <DialogContent dividers>
          {previewJob && (
            <Box
              sx={{ p: 2, bg: '#fff', border: '1px solid #ccc', borderRadius: 1 }}
              dangerouslySetInnerHTML={{ __html: previewJob.rendered_html }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewJob(null)}>{t('common.cancel', 'Close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Simulate Outcome Modal */}
      <Dialog open={Boolean(outcomeJob)} onClose={() => setOutcomeJob(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('printQueue.simulateOutcome', 'Simulate Printer Hardware Outcome')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Simulate hardware success or failure for Print Job #{outcomeJob?.id.slice(0, 8)}
          </Typography>
          <Stack spacing={2}>
            <FormControl fullWidth>
              <InputLabel>{t('printQueue.simulateOutcome', 'Simulated Outcome')}</InputLabel>
              <Select value={outcomeVal} label={t('printQueue.simulateOutcome', 'Simulated Outcome')} onChange={(e) => setOutcomeVal(e.target.value as any)}>
                <MenuItem value="SUCCESS">SUCCESS (Thermal Print Succeeded)</MenuItem>
                <MenuItem value="FAILED">FAILED (Printer Error / Out of Paper)</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOutcomeJob(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleSimulateOutcome}>{t('common.confirm', 'Submit Outcome')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
