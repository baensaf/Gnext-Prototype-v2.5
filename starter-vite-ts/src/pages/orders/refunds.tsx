import type { RefundRequest } from 'src/api/refundApi';

import React, { useState, useEffect } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  Box,
  Chip,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Dialog,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  IconButton,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { refundApi } from 'src/api/refundApi';

export function RefundsPage() {
  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedRefund, setSelectedRefund] = useState<any | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await refundApi.getRefunds();
      setRefunds(list);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load refunds');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleViewDetail = async (id: string) => {
    try {
      const data = await refundApi.getRefundById(id);
      setSelectedRefund(data);
      setDetailModalOpen(true);
    } catch {
      setError('Failed to view refund details');
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Refunds & Paid Order Cancellations
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Slice 13 — Item-level, partial, full refunds, same-tender rules, and post-preparation cancellation approvals
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
          Refresh
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Refund Code</TableCell>
              <TableCell>Order Reference</TableCell>
              <TableCell>Refund Type</TableCell>
              <TableCell>Refund Amount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Reason / Note</TableCell>
              <TableCell>Timestamp</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {refunds.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                    No refund requests or paid cancellations recorded yet.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              refunds.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                      <code>{r.code}</code>
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <code>{r.order_id.slice(0, 8)}...</code>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={r.refund_type}
                      color={r.refund_type === 'FULL' ? 'error' : r.refund_type === 'ITEM_LEVEL' ? 'info' : 'warning'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 'bold', color: 'error.main' }}>
                    -{Number(r.total_refund_amount).toLocaleString()} IRR
                  </TableCell>
                  <TableCell>
                    <Chip label={r.status} color={r.status === 'APPROVED' ? 'success' : 'default'} size="small" />
                  </TableCell>
                  <TableCell>{r.note || '-'}</TableCell>
                  <TableCell>{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell align="right">
                    <IconButton color="primary" onClick={() => handleViewDetail(r.id)}>
                      <VisibilityIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Detail Modal */}
      <Dialog open={detailModalOpen} onClose={() => setDetailModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>Refund Request Details ({selectedRefund?.code})</DialogTitle>
        <DialogContent>
          {selectedRefund && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">
                <strong>Refund Type:</strong> {selectedRefund.refund_type}
              </Typography>
              <Typography variant="body2">
                <strong>Total Amount Refunded:</strong> {Number(selectedRefund.total_refund_amount).toLocaleString()} IRR
              </Typography>
              <Typography variant="body2">
                <strong>Note / Reason:</strong> {selectedRefund.note || 'None'}
              </Typography>

              <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mt: 2 }}>
                Payment Method Allocations Reversed:
              </Typography>
              {selectedRefund.allocations?.map((a: any) => (
                <Paper key={a.id} variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="body2">
                    Method ID: <code>{a.payment_method_id}</code>
                  </Typography>
                  <Typography variant="body2" color="error.main" sx={{ fontWeight: 'bold' }}>
                    Amount Reversed: -{Number(a.amount_refunded).toLocaleString()} IRR
                  </Typography>
                </Paper>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
