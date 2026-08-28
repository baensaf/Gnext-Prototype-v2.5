import type { Payment } from 'src/api/paymentApi';
import type { OrderHeader } from 'src/api/orderApi';
import type { PaymentMethod } from 'src/api/settingsApi';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import PrintIcon from '@mui/icons-material/Print';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import PaymentIcon from '@mui/icons-material/Payment';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import {
  Box,
  Chip,
  Stack,
  Alert,
  Paper,
  Table,
  Dialog,
  Button,
  Select,
  Divider,
  MenuItem,
  TableRow,
  TextField,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  InputLabel,
  DialogTitle,
  FormControl,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';

import { orderApi } from 'src/api/orderApi';
import { paymentApi } from 'src/api/paymentApi';
import { settingsApi } from 'src/api/settingsApi';

import { toast, showErrorToast } from 'src/components/snackbar';

interface CheckoutModalProps {
  open: boolean;
  orderId: string | null;
  onClose: () => void;
  onPaymentComplete?: () => void;
}

export function CheckoutModal({ open, orderId, onClose, onPaymentComplete }: CheckoutModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [order, setOrder] = useState<OrderHeader | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [refNumber, setRefNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [_loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const o = await orderApi.getOrderById(orderId);
      setOrder(o);
      setPayAmount(o.due_amount || o.outstanding_total || '0');

      const pms = await settingsApi.getPaymentMethods();
      setPaymentMethods(pms.filter((m) => m.is_active));
      if (pms.length > 0 && !selectedMethodId) {
        setSelectedMethodId(pms[0].id);
      }

      const pays = await paymentApi.getOrderPayments(orderId);
      setPayments(pays);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load checkout details');
    } finally {
      setLoading(false);
    }
  }, [orderId, selectedMethodId]);

  useEffect(() => {
    if (open && orderId) {
      loadData();
    }
  }, [open, orderId, loadData]);

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderId || !selectedMethodId || !payAmount) return;

    try {
      const res = await paymentApi.postPayment({
        order_id: orderId,
        payment_method_id: selectedMethodId,
        amount: payAmount,
        reference_number: refNumber || undefined,
      });

      setOrder(res.order);
      setPayAmount(res.order.due_amount);
      setRefNumber('');

      const updatedPays = await paymentApi.getOrderPayments(orderId);
      setPayments(updatedPays);
      toast.success(t('pos.paymentSuccess', 'Payment recorded successfully'));

      if (MoneyUtil.isZero(res.order.due_amount) && onPaymentComplete) {
        onPaymentComplete();
      }
    } catch (err: any) {
      const errorMsg = err.detail || 'Payment failed';
      setError(errorMsg);
      showErrorToast(err, errorMsg);
    }
  };

  const handleFastTender = useCallback(
    async (methodKind: 'CASH' | 'CARD' | 'POS') => {
      if (!order || !orderId || MoneyUtil.isZero(order.due_amount)) return;

      const matchedMethod = paymentMethods.find((m) => m.kind === methodKind) || paymentMethods[0];
      if (!matchedMethod) return;

      try {
        setLoading(true);
        const res = await paymentApi.postPayment({
          order_id: orderId,
          payment_method_id: matchedMethod.id,
          amount: order.due_amount || '0',
          reference_number:
            methodKind === 'CARD' || methodKind === 'POS' ? `POS-${Date.now().toString().slice(-6)}` : undefined,
        });

        setOrder(res.order);
        setPayAmount(res.order.due_amount || '0');
        setRefNumber('');

        const updatedPays = await paymentApi.getOrderPayments(orderId);
        setPayments(updatedPays);
        toast.success(t('pos.paymentSuccess', 'Payment recorded successfully'));

        if (MoneyUtil.isZero(res.order.due_amount) && onPaymentComplete) {
          onPaymentComplete();
        }
      } catch (err: any) {
        const errorMsg = err.detail || 'Fast tender payment failed';
        setError(errorMsg);
        showErrorToast(err, errorMsg);
      } finally {
        setLoading(false);
      }
    },
    [order, orderId, paymentMethods, t, onPaymentComplete]
  );

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F8') {
        e.preventDefault();
        handleFastTender('CASH');
      } else if (e.key === 'F9') {
        e.preventDefault();
        handleFastTender('CARD');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, handleFastTender]);

  const isFullyPaid = order ? MoneyUtil.isZero(order.due_amount) : false;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
        <PaymentIcon color="primary" />
        {t('pos.checkout')} — {order?.order_number}
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {order && (
          <Stack spacing={2} sx={{ mb: 3, mt: 1 }}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'background.neutral' }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary">{t('orders.totalAmount')}:</Typography>
                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                  {MoneyUtil.formatCurrency(order.total_amount)} IRR
                </Typography>
              </Stack>
              <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary">{t('orders.paidAmount')}:</Typography>
                <Typography variant="body2" color="success.main" sx={{ fontWeight: 'bold' }}>
                  {MoneyUtil.formatCurrency(order.paid_amount)} IRR
                </Typography>
              </Stack>
              <Divider sx={{ my: 1 }} />
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>{t('settlements.variance')}:</Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', color: isFullyPaid ? 'success.main' : 'error.main' }}>
                  {MoneyUtil.formatCurrency(order.due_amount)} IRR
                </Typography>
              </Stack>
            </Paper>

            {isFullyPaid ? (
              <Alert severity="success" sx={{ py: 1 }}>
                <strong>{t('pos.orderSettled')}</strong>
              </Alert>
            ) : (
              <Box component="form" onSubmit={handleAddPayment} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                {/* 1-Click Fast Tender Actions */}
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 1 }}>
                  FAST 1-CLICK TENDER (HOTKEYS)
                </Typography>
                <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
                  <Button
                    fullWidth
                    variant="contained"
                    color="success"
                    startIcon={<FlashOnIcon />}
                    onClick={() => handleFastTender('CASH')}
                    sx={{ fontWeight: 700, py: 1 }}
                  >
                    Exact Cash [F8]
                  </Button>
                  <Button
                    fullWidth
                    variant="contained"
                    color="primary"
                    startIcon={<CreditCardIcon />}
                    onClick={() => handleFastTender('CARD')}
                    sx={{ fontWeight: 700, py: 1 }}
                  >
                    EFT POS [F9]
                  </Button>
                </Stack>

                <Divider sx={{ my: 2 }}>
                  <Chip label="Or Custom Tender" size="small" />
                </Divider>

                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1.5 }}>
                  {t('pos.postPayment')}
                </Typography>

                {/* Quick Cash Presets */}
                <Stack direction="row" spacing={0.75} sx={{ mb: 2, flexWrap: 'wrap', gap: 0.75 }}>
                  <Chip
                    label="Exact"
                    clickable
                    color="primary"
                    variant="outlined"
                    size="small"
                    onClick={() => setPayAmount(order.due_amount || '0')}
                  />
                  {['500000', '1000000', '2000000', '5000000', '10000000'].map((val) => (
                    <Chip
                      key={val}
                      label={`${(Number(val) / 10).toLocaleString('fa-IR')} ت`}
                      clickable
                      variant="outlined"
                      size="small"
                      onClick={() => setPayAmount(val)}
                    />
                  ))}
                </Stack>

                <Stack spacing={2}>
                  <FormControl fullWidth size="small">
                    <InputLabel>{t('payments.instrument')}</InputLabel>
                    <Select
                      value={selectedMethodId}
                      label={t('payments.instrument')}
                      onChange={(e) => setSelectedMethodId(e.target.value)}
                    >
                      {paymentMethods.map((m) => (
                        <MenuItem key={m.id} value={m.id}>
                          {m.name} ({m.code})
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <TextField
                    size="small"
                    label={t('payments.amount')}
                    type="number"
                    required
                    fullWidth
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                  />

                  <TextField
                    size="small"
                    label={t('payments.reference')}
                    placeholder="e.g. POS-998822"
                    fullWidth
                    value={refNumber}
                    onChange={(e) => setRefNumber(e.target.value)}
                  />

                  <Button type="submit" variant="contained" fullWidth sx={{ fontWeight: 'bold' }}>
                    {t('pos.postPayment')}
                  </Button>
                </Stack>
              </Box>
            )}

            {/* Payments Table */}
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mt: 2 }}>
              {t('payments.title')}
            </Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, maxHeight: 180 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('common.time')}</TableCell>
                    <TableCell align="right">{t('payments.amount')}</TableCell>
                    <TableCell>{t('payments.reference')}</TableCell>
                    <TableCell>{t('common.status')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{new Date(p.recorded_at).toLocaleTimeString()}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                        {MoneyUtil.formatCurrency(p.amount)} IRR
                      </TableCell>
                      <TableCell>{p.reference_number || '—'}</TableCell>
                      <TableCell>
                        <Chip label={p.status} color="success" size="small" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {isFullyPaid && (
          <Button
            variant="contained"
            color="primary"
            startIcon={<PrintIcon />}
            onClick={() => navigate(`/app/pos/receipt/${orderId}`)}
            sx={{ fontWeight: 'bold' }}
          >
            {t('pos.printReceipt')}
          </Button>
        )}
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
