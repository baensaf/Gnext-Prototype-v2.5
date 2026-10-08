import type { OrderListRow } from 'src/api/orderApi';
import type { RefundRequest } from 'src/api/refundApi';
import type { PaymentMethod } from 'src/api/settingsApi';

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
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  DialogTitle,
  Autocomplete,
  ToggleButton,
  DialogContent,
  DialogActions,
  TableContainer,
  ToggleButtonGroup,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';
import { serverText } from 'src/utils/server-text';
import { useCurrencyLabel } from 'src/utils/currency';
import { amountText, amountFromText } from 'src/utils/amount-input';

import { orderApi } from 'src/api/orderApi';
import { refundApi } from 'src/api/refundApi';
import { settingsApi } from 'src/api/settingsApi';
import { useAuthStore } from 'src/store/useAuthStore';
import { useScopedBranchId } from 'src/contexts/branch-context';

import { ApprovalModal } from 'src/components/approval/ApprovalModal';

/** Roles that release a refund on their own authority. Everyone else produces a PIN. */
const APPROVER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OWNER', 'MANAGER', 'SUPERVISOR'];

export function RefundsPage() {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();
  const [branchId] = useScopedBranchId();
  const role = useAuthStore((state) => state.user?.role);
  const canApprove = APPROVER_ROLES.includes((role || '').toUpperCase());

  // The orders the listed refunds belong to, for their numbers.
  const [orders, setOrders] = useState<OrderListRow[]>([]);
  // Orders that took money, found by the search in the new-refund dialog. Searching the
  // server reaches any order; the old list only ever held the newest 50.
  const [orderQuery, setOrderQuery] = useState('');
  const [orderOptions, setOrderOptions] = useState<OrderListRow[]>([]);
  const [searchingOrders, setSearchingOrders] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // A card paid in Iran cannot be refunded on the terminal, so money goes back in cash from the
  // drawer or by a card-to-card transfer, whose tracking number is kept with the refund.
  const EMPTY_FORM = { orderId: '', amount: '', reason: '', payBack: 'CASH' as 'CASH' | 'TRANSFER', reference: '' };
  const [form, setForm] = useState(EMPTY_FORM);
  // The server refunds a completed order only; saying so before the PIN saves the manager a trip.
  const pickedOrder = orderOptions.find((order) => order.id === form.orderId);
  const pickedStillOpen = !!pickedOrder && pickedOrder.state !== 'COMPLETED';

  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedRefund, setSelectedRefund] = useState<any | null>(null);
  // Names for the methods a refund went back to; the refund itself carries only their ids.
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const methodNames: Record<string, string> = Object.fromEntries(methods.map((m) => [m.id, m.name]));
  // How a refund went back, named the way the dialog offers it.
  const payBackLabel = (r: { method_id?: string; method_kind?: string }) =>
    r.method_kind === 'CASH'
      ? t('refunds.payBack.cash')
      : r.method_kind === 'BANK_TRANSFER'
        ? t('refunds.payBack.transfer')
        : (r.method_id && methodNames[r.method_id]) || r.method_kind || '-';
  const cashMethod = methods.find((m) => m.is_active && m.kind === 'CASH');
  const transferMethod = methods.find((m) => m.is_active && m.kind === 'BANK_TRANSFER');
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await refundApi.getRefunds();
      const orderIds = [...new Set(list.map((r) => r.order_id))];
      const orderList = orderIds.length
        ? (await orderApi.listOrders({ ids: orderIds, limit: Math.min(200, orderIds.length) })).data
        : [];
      setRefunds(list);
      setOrders(orderList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('refunds.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    settingsApi.getPaymentMethods().then(setMethods).catch(() => setMethods([]));
  }, []);

  useEffect(() => {
    loadData();
     
  }, [branchId]);

  // Only an order that took money can give any back, so the search asks for those alone.
  useEffect(() => {
    if (!newOpen) return undefined;
    const timer = setTimeout(async () => {
      setSearchingOrders(true);
      try {
        const res = await orderApi.listOrders({ branchId: branchId || undefined, q: orderQuery, paid: true, limit: 20 });
        // A cancelled order, or one already refunded in full, has nothing left to give back.
        setOrderOptions(
          res.data.filter(
            (order) =>
              order.state !== 'CANCELLED' &&
              order.state !== 'REJECTED' &&
              MoneyUtil.greaterThan(order.paid_total || order.paid_amount || '0', order.refunded_total || '0')
          )
        );
      } catch {
        setOrderOptions([]);
      } finally {
        setSearchingOrders(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [newOpen, orderQuery, branchId]);

  const submitRefund = async (pin?: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await refundApi.createRefund({
        order_id: form.orderId,
        amount: form.amount || undefined,
        full: !form.amount,
        reason: form.reason,
        targetMethodId: (form.payBack === 'TRANSFER' ? transferMethod : cashMethod)?.id,
        reference: form.payBack === 'TRANSFER' ? form.reference.trim() : undefined,
        pin,
      });
      setNewOpen(false);
      setForm(EMPTY_FORM);
      await loadData();
    } catch (err: any) {
      setError(
        err?.response?.data?.detail || err.detail || err.message || t('refunds.createFailed')
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

  // The API does not say whether a refund took back the whole order: it did when it matches the total.
  const typeOf = (r: { order_id: string; total_refund_amount?: string }) => {
    const order = orders.find((o) => o.id === r.order_id);
    return order && MoneyUtil.equals(r.total_refund_amount || '0', order.total_amount || '0') ? 'FULL' : 'PARTIAL';
  };

  const handleViewDetail = async (id: string) => {
    try {
      const data = await refundApi.getRefundById(id);
      setSelectedRefund(data);
      setDetailModalOpen(true);
    } catch {
      setError(t('refunds.detailFailed'));
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('refunds.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('refunds.subtitle', 'Full and partial refunds of paid orders, released by a manager PIN.')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            {t('common.refresh', 'Refresh')}
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
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
              <TableCell>{t('refunds.col.code')}</TableCell>
              <TableCell>{t('refunds.order')}</TableCell>
              <TableCell>{t('refunds.col.type')}</TableCell>
              <TableCell>{t('refunds.payBack.label')}</TableCell>
              <TableCell>{t('refunds.amount')}</TableCell>
              <TableCell>{t('refunds.col.status')}</TableCell>
              <TableCell>{t('refunds.reason')}</TableCell>
              <TableCell>{t('refunds.col.time')}</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {refunds.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                    {t('refunds.empty')}
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
                      label={t(`refunds.type.${typeOf(r)}`)}
                      color={typeOf(r) === 'FULL' ? 'error' : 'warning'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{payBackLabel(r)}</TableCell>
                  <TableCell sx={{ fontWeight: 'bold', color: 'error.main' }}>
                    -{MoneyUtil.formatCurrency(r.total_refund_amount)} {currency}
                  </TableCell>
                  <TableCell>
                    <Chip label={t(`refunds.status.${r.status}`, r.status)} color={r.status === 'APPROVED' ? 'success' : 'default'} size="small" />
                  </TableCell>
                  <TableCell>{serverText(r.note, t) || '-'}</TableCell>
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
        <DialogTitle sx={{ fontWeight: 'bold' }}>{t('refunds.detailTitle', { code: selectedRefund?.code })}</DialogTitle>
        <DialogContent>
          {selectedRefund && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">
                <strong>{t('refunds.col.type')}:</strong> {t(`refunds.type.${typeOf(selectedRefund)}`)}
              </Typography>
              <Typography variant="body2">
                <strong>{t('refunds.amount')}:</strong> {MoneyUtil.formatCurrency(selectedRefund.total_refund_amount)} {currency}
              </Typography>
              <Typography variant="body2">
                <strong>{t('refunds.reason')}:</strong> {serverText(selectedRefund.note, t) || '-'}
              </Typography>

              <Typography variant="body2">
                <strong>{t('refunds.payBack.label')}:</strong>{' '}
                {payBackLabel(selectedRefund)}
                {selectedRefund.reference && ` · ${selectedRefund.reference}`}
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailModalOpen(false)}>{t('common.close', 'Close')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={newOpen} onClose={() => !submitting && setNewOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('refunds.new', 'New refund')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <Autocomplete
              options={orderOptions}
              loading={searchingOrders}
              filterOptions={(options) => options}
              value={orderOptions.find((order) => order.id === form.orderId) ?? null}
              onChange={(_, order) => setForm({ ...form, orderId: order?.id || '' })}
              onInputChange={(_, value, reason) => {
                if (reason === 'input') setOrderQuery(value);
              }}
              getOptionLabel={(order) =>
                `${order.order_number} — ${MoneyUtil.formatCurrency(order.paid_total || order.paid_amount || '0')}`
              }
              isOptionEqualToValue={(a, b) => a.id === b.id}
              noOptionsText={t('refunds.noPaidOrders', 'No paid order matches')}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('refunds.order', 'Order')}
                  placeholder={t('refunds.orderSearch', 'Order no., customer or phone')}
                />
              )}
            />

            {pickedStillOpen && (
              <Alert severity="warning">
                {t('refunds.notCompleted', { number: pickedOrder?.call_number || pickedOrder?.order_number })}
              </Alert>
            )}

            <TextField
              label={`${t('refunds.amount', 'Amount')} (${currency})`}
              placeholder={t('refunds.wholeOrder')}
              value={amountText(form.amount)}
              onChange={(e) => setForm({ ...form, amount: amountFromText(e.target.value) })}
              helperText={t('refunds.amountHelp', 'Leave empty to refund the whole order.')}
              slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
              fullWidth
            />

            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                {t('refunds.payBack.label')}
              </Typography>
              <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                value={form.payBack}
                onChange={(_, value) => value && setForm({ ...form, payBack: value })}
              >
                <ToggleButton value="CASH" disabled={!cashMethod}>
                  {t('refunds.payBack.cash')}
                </ToggleButton>
                <ToggleButton value="TRANSFER" disabled={!transferMethod}>
                  {t('refunds.payBack.transfer')}
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>

            {form.payBack === 'TRANSFER' && (
              <TextField
                required
                label={t('refunds.payBack.reference')}
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                slotProps={{ htmlInput: { dir: 'ltr' } }}
                fullWidth
              />
            )}

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
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmitClick}
            disabled={
              submitting ||
              !form.orderId ||
              !form.reason.trim() ||
              pickedStillOpen ||
              (form.payBack === 'TRANSFER' && !form.reference.trim())
            }
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
