import type { OrderHeader } from 'src/api/orderApi';
import type { RefundRequest } from 'src/api/refundApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
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
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';

import { orderApi } from 'src/api/orderApi';
import { refundApi } from 'src/api/refundApi';
import { useAuthStore } from 'src/store/useAuthStore';
import { useScopedBranchId } from 'src/contexts/branch-context';

import { ApprovalModal } from 'src/components/approval/ApprovalModal';

/** Roles that release a refund on their own authority. Everyone else produces a PIN. */
const APPROVER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OWNER', 'MANAGER', 'SUPERVISOR'];

export function RefundsPage() {
  const { t } = useTranslation();
  const [branchId] = useScopedBranchId();
  const role = useAuthStore((state) => state.user?.role);
  const canApprove = APPROVER_ROLES.includes((role || '').toUpperCase());

  const [orders, setOrders] = useState<OrderHeader[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ orderId: '', amount: '', reason: '' });

  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedRefund, setSelectedRefund] = useState<any | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [list, orderList] = await Promise.all([
        refundApi.getRefunds(),
        orderApi.getOrders(branchId || undefined),
      ]);
      setRefunds(list);
      setOrders(orderList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load refunds');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  // Only an order that took money can give any back.
  const refundableOrders = orders.filter(
    (order) => Number(order.paid_total || order.paid_amount || 0) > 0
  );

  const submitRefund = async (pin?: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await refundApi.createRefund({
        order_id: form.orderId,
        amount: form.amount || undefined,
        full: !form.amount,
        reason: form.reason,
        pin,
      });
      setNewOpen(false);
      setForm({ orderId: '', amount: '', reason: '' });
      await loadData();
    } catch (err: any) {
      setError(
        err?.response?.data?.detail || err.detail || err.message || 'Failed to create the refund'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // A cashier is asked for an approver's PIN before anything is created, so a refused
  // authorization leaves no half-made refund behind.
  const handleSubmitClick = () => {
    if (canApprove) {
      submitRefund();
    } else {
      setPinOpen(true);
    }
  };

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
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            disabled={refundableOrders.length === 0}
            onClick={() => setNewOpen(true)}
          >
            {t('refunds.new', 'New refund')}
          </Button>
        </Stack>
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
                    {/* The order number is what the receipt in the customer's hand shows. */}
                    <code>{orders.find((o) => o.id === r.order_id)?.order_number || `${r.order_id.slice(0, 8)}...`}</code>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={r.refund_type}
                      color={r.refund_type === 'FULL' ? 'error' : r.refund_type === 'ITEM_LEVEL' ? 'info' : 'warning'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 'bold', color: 'error.main' }}>
                    -{MoneyUtil.formatCurrency(r.total_refund_amount)} IRR
                  </TableCell>
                  <TableCell>
                    <Chip label={r.status} color={r.status === 'APPROVED' ? 'success' : 'default'} size="small" />
                  </TableCell>
                  <TableCell>{r.note || '-'}</TableCell>
                  <TableCell>{fDateTime(r.created_at)}</TableCell>
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
                <strong>Total Amount Refunded:</strong> {MoneyUtil.formatCurrency(selectedRefund.total_refund_amount)} IRR
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
                    Amount Reversed: -{MoneyUtil.formatCurrency(a.amount_refunded)} IRR
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

      <Dialog open={newOpen} onClose={() => !submitting && setNewOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('refunds.new', 'New refund')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <TextField
              select
              label={t('refunds.order', 'Order')}
              value={form.orderId}
              onChange={(e) => setForm({ ...form, orderId: e.target.value })}
              fullWidth
            >
              {refundableOrders.map((order) => (
                <MenuItem key={order.id} value={order.id}>
                  {order.order_number} — {MoneyUtil.formatCurrency(order.paid_total || order.paid_amount || '0')}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label={t('refunds.amount', 'Amount')}
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              helperText={t('refunds.amountHelp', 'Leave empty to refund the whole order.')}
              fullWidth
            />

            <TextField
              label={t('refunds.reason', 'Reason')}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              multiline
              rows={2}
              fullWidth
            />

            {!canApprove && (
              <Alert severity="info">
                {t(
                  'refunds.pinNotice',
                  'Money going back out needs a manager PIN. You will be asked for one before the refund is created.'
                )}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmitClick}
            disabled={submitting || !form.orderId || !form.reason.trim()}
          >
            {canApprove ? t('common.save', 'Save') : t('refunds.continue', 'Continue')}
          </Button>
        </DialogActions>
      </Dialog>

      <ApprovalModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        onSuccess={(pin) => {
          setPinOpen(false);
          submitRefund(pin);
        }}
        actionName="REFUND_ORDER"
        entityType="ORDER"
        entityId={form.orderId}
        detailsText={t('refunds.approvalDetails', 'Refund against a paid order')}
      />
    </Box>
  );
}
