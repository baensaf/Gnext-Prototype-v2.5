import type { Payment } from 'src/api/paymentApi';
import type { OrderHeader } from 'src/api/orderApi';
import type { PaymentMethod } from 'src/api/settingsApi';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import PrintIcon from '@mui/icons-material/Print';
import DialpadIcon from '@mui/icons-material/Dialpad';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import PaymentIcon from '@mui/icons-material/Payment';
import BackspaceIcon from '@mui/icons-material/Backspace';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import {
  Box,
  Chip,
  Grid,
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
  CircularProgress,
} from '@mui/material';

import { fTime } from 'src/utils/format-time';
import { MoneyUtil } from 'src/utils/money.util';

import { usePosSource, PosFeatureGate } from 'src/contexts/pos-source';

import { toast, showErrorToast } from 'src/components/snackbar';
import { UnconfirmedChargeActions } from 'src/components/payment-terminal/unconfirmed-charge-actions';

/**
 * The amount the keypad starts from. The API sends "42292000.0000": shown as is it looked odd,
 * and a digit typed after it made 42292000.00001.
 */
const wholeRials = (amount?: string | null) => String(amount || '0').replace(/\.0*$/, '');

interface CheckoutModalProps {
  open: boolean;
  orderId: string | null;
  onClose: () => void;
  onPaymentComplete?: () => void;
}

export function CheckoutModal({ open, orderId, onClose, onPaymentComplete }: CheckoutModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pos = usePosSource();

  const [order, setOrder] = useState<OrderHeader | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [refNumber, setRefNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [terminalProcessing, setTerminalProcessing] = useState(false);
  const [showNumpad, setShowNumpad] = useState(false);
  // Cash handed over beyond what is due: the drawer keeps only the due amount, and the
  // cashier gives this back.
  const [changeDue, setChangeDue] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const o = await pos.orders.getOrderById(orderId);
      setOrder(o);
      setPayAmount(wholeRials(o.due_amount || o.outstanding_total));

      const pms = await pos.settings.getPaymentMethods();
      const activeMethods = pms.filter((m) => m.is_active);
      setPaymentMethods(activeMethods);

      if (activeMethods.length > 0) {
        // Prefer CARD / POS (کارتخوان) as the 90% default in Iran
        const preferredPos = activeMethods.find(
          (m) =>
            m.kind === 'CARD' ||
            m.kind === 'POS' ||
            m.code?.toUpperCase().includes('POS') ||
            m.name?.includes('کارتخوان') ||
            m.name?.toLowerCase().includes('card')
        );
        setSelectedMethodId(preferredPos ? preferredPos.id : activeMethods[0].id);
      }

      const pays = await pos.payments.getOrderPayments(orderId);
      setPayments(pays);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load checkout details');
    } finally {
      setLoading(false);
    }
  }, [orderId, pos]);

  useEffect(() => {
    if (open && orderId) {
      loadData();
    }
  }, [open, orderId, loadData]);

  const handleAddPayment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!orderId || !selectedMethodId || !payAmount) return;

    const method = paymentMethods.find((m) => m.id === selectedMethodId);
    const due = order?.due_amount || '0';
    const overTendered = method?.kind === 'CASH' && MoneyUtil.greaterThan(payAmount, due);
    try {
      setLoading(true);
      const res = await pos.payments.postPayment({
        order_id: orderId,
        payment_method_id: selectedMethodId,
        amount: overTendered ? due : payAmount,
        reference_number: refNumber || undefined,
      });

      setOrder(res.order);
      setPayAmount(wholeRials(res.order?.due_amount));
      setRefNumber('');
      setChangeDue(overTendered ? MoneyUtil.subtract(payAmount, due) : null);
      if (overTendered) {
        // Screens that close this dialog once the order is settled would hide the alert.
        toast.warning(
          `${t('pos.changeDue', 'Change to give back')}: ${MoneyUtil.formatCurrency(MoneyUtil.subtract(payAmount, due))} IRR`,
          { duration: 15000 }
        );
      }

      const updatedPays = await pos.payments.getOrderPayments(orderId);
      setPayments(updatedPays);
      toast.success(t('pos.paymentSuccess', 'Payment recorded successfully'));

      if (res.order && MoneyUtil.isZero(res.order.due_amount) && onPaymentComplete) {
        onPaymentComplete();
      }
    } catch (err: any) {
      const errorMsg = err.detail || 'Payment failed';
      setError(errorMsg);
      showErrorToast(err, errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleVoidPayment = async (paymentId: string) => {
    if (!orderId) return;
    try {
      setLoading(true);
      await pos.payments.voidPayment(paymentId);
      const updatedPays = await pos.payments.getOrderPayments(orderId);
      setPayments(updatedPays);
      setError(null);
      toast.success(t('pos.paymentVoided', 'Payment attempt voided'));
    } catch (err: any) {
      const errorMsg = err.detail || 'Failed to void payment';
      setError(errorMsg);
      showErrorToast(err, errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleFastTender = useCallback(
    async (methodKind: 'CASH' | 'CARD' | 'POS') => {
      if (!order || !orderId || MoneyUtil.isZero(order.due_amount)) return;

      // The counter's card reader is kind CARD_POS. Falling back to the first method in the
      // list recorded card sales as bank transfers, so a missing tender is reported instead.
      const cardKinds = ['CARD_POS', 'CARD', 'POS'];
      const matchedMethod = paymentMethods.find((m) =>
        methodKind === 'CASH' ? m.kind === 'CASH' : cardKinds.includes(m.kind)
      );
      if (!matchedMethod) {
        setError(t('pos.noTenderMethod', 'No active payment method for this tender'));
        return;
      }

      try {
        setTerminalProcessing(true);
        const res = await pos.payments.postPayment({
          order_id: orderId,
          payment_method_id: matchedMethod.id,
          amount: order.due_amount || '0',
          reference_number: undefined,
        });

        setOrder(res.order);
        setPayAmount(wholeRials(res.order?.due_amount));
        setRefNumber('');

        const updatedPays = await pos.payments.getOrderPayments(orderId);
        setPayments(updatedPays);
        toast.success(t('pos.paymentSuccess', 'Payment recorded successfully'));

        if (res.order && MoneyUtil.isZero(res.order.due_amount) && onPaymentComplete) {
          onPaymentComplete();
        }
      } catch (err: any) {
        const errorMsg = err.detail || 'Fast tender payment failed';
        setError(errorMsg);
        showErrorToast(err, errorMsg);
      } finally {
        setTerminalProcessing(false);
      }
    },
    [order, orderId, paymentMethods, t, onPaymentComplete, pos]
  );

  // Hotkeys: F8 = Cash, F9 = Terminal POS
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

  // Touch Numpad handlers
  const handleNumpadDigit = (digit: string) => {
    setPayAmount((prev) => {
      if (!prev || prev === '0') return digit;
      return prev + digit;
    });
  };

  const handleNumpadBackspace = () => {
    setPayAmount((prev) => {
      if (!prev || prev.length <= 1) return '';
      return prev.slice(0, -1);
    });
  };

  const handleNumpadClear = () => {
    setPayAmount('');
  };

  const isFullyPaid = order ? MoneyUtil.isZero(order.due_amount) : false;

  // Another copy on the branch's receipt printer. The first one printed by itself when the
  // order was paid; the browser's print dialog only helps a till with a desktop printer.
  const handlePrintReceipt = async () => {
    if (!orderId) return;
    try {
      const jobs = await pos.printing.reprintOrder(orderId, 'CUSTOMER_RECEIPT', t('pos.printReceipt', 'Print Receipt'));
      if (!Array.isArray(jobs) || jobs.length === 0 || jobs.every((j) => j.status === 'FAILED')) {
        throw new Error(t('pos.receiptFailed', 'The receipt could not be sent to a printer'));
      }
      toast.success(t('pos.receiptSent', 'Receipt sent to the counter printer'));
    } catch (err: any) {
      toast.error(err?.detail || err?.message || t('pos.receiptFailed', 'The receipt could not be sent to a printer'));
      navigate(`/app/pos/receipt/${orderId}`);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <PaymentIcon color="primary" />
          <Typography component="span" variant="h6" sx={{ fontWeight: 700 }}>
            {t('pos.checkout', 'Checkout & Settlement')} — #{order?.order_number || ''}
          </Typography>
        </Stack>
        <Chip
          label={t('pos.posReady', 'PC-POS ready')}
          color="success"
          size="small"
          variant="outlined"
          sx={{ fontWeight: 600 }}
        />
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {order && (
          <Stack spacing={2} sx={{ mb: 2, mt: 1 }}>
            {changeDue && (
              <Alert severity="warning" sx={{ py: 1.5, fontWeight: 700, fontSize: '1.1rem' }}>
                {t('pos.changeDue', 'Change to give back')}: {MoneyUtil.formatCurrency(changeDue)} IRR
              </Alert>
            )}
            {/* Financial Summary Box */}
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'background.neutral' }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {t('orders.totalAmount', 'Total Amount')}:
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                  {MoneyUtil.formatCurrency(order.total_amount)} IRR
                </Typography>
              </Stack>
              <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {t('orders.paidAmount', 'Paid Amount')}:
                </Typography>
                <Typography variant="body2" color="success.main" sx={{ fontWeight: 'bold' }}>
                  {MoneyUtil.formatCurrency(order.paid_amount)} IRR
                </Typography>
              </Stack>
              <Divider sx={{ my: 1 }} />
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('orders.dueAmount', 'Remaining Due')}:
                </Typography>
                <Typography
                  variant="h5"
                  sx={{ fontWeight: 'bold', color: isFullyPaid ? 'success.main' : 'error.main' }}
                >
                  {MoneyUtil.formatCurrency(order.due_amount)} IRR
                </Typography>
              </Stack>
            </Paper>

            {isFullyPaid ? (
              <Alert severity="success" sx={{ py: 1.5, fontWeight: 700 }}>
                {t('pos.orderSettled', 'Order is fully settled!')}
              </Alert>
            ) : (
              <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                {/* Hero action: the card terminal is the default tender here. */}
                <Typography variant="caption" sx={{ fontWeight: 800, color: 'primary.main', display: 'block', mb: 1, letterSpacing: 0.5 }}>
                  {t('pos.posSettlementLabel', 'One-click POS terminal settlement')}
                </Typography>

                <Button
                  fullWidth
                  variant="contained"
                  color="primary"
                  size="large"
                  disabled={terminalProcessing || loading}
                  startIcon={terminalProcessing ? <CircularProgress size={22} color="inherit" /> : <PointOfSaleIcon sx={{ fontSize: 26 }} />}
                  onClick={() => handleFastTender('CARD')}
                  sx={{
                    py: 1.5,
                    fontSize: '1.05rem',
                    fontWeight: 800,
                    borderRadius: 1.5,
                    boxShadow: (theme) => theme.customShadows?.primary || 3,
                    mb: 1.5,
                  }}
                >
                  {terminalProcessing
                    ? 'ارسال به کارتخوان و ثبت تراکنش...'
                    : `پرداخت با کارتخوان بانکی (PC-POS) — ${MoneyUtil.formatCurrency(order.due_amount)} IRR`}
                </Button>

                {/* Secondary Fast Cash */}
                <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                  <Button
                    fullWidth
                    variant="outlined"
                    color="success"
                    startIcon={<FlashOnIcon />}
                    onClick={() => handleFastTender('CASH')}
                    sx={{ fontWeight: 700, py: 0.75 }}
                  >
                    تسویه نقدی دقیق
                  </Button>
                  <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<DialpadIcon />}
                    onClick={() => setShowNumpad((prev) => !prev)}
                    sx={{ fontWeight: 600, py: 0.75, flexShrink: 0 }}
                  >
                    {showNumpad ? 'مخفی‌سازی کیپد' : 'کیپد لمسی'}
                  </Button>
                </Stack>

                <Divider sx={{ my: 1.5 }}>
                  <Chip label="پرداخت ترکیبی یا مبالغ دلخواه (Split / Custom)" size="small" />
                </Divider>

                <Box component="form" onSubmit={handleAddPayment}>
                  <Grid container spacing={2} sx={{ mb: 1.5 }}>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <FormControl fullWidth size="small">
                        <InputLabel>{t('payments.instrument', 'Payment Instrument')}</InputLabel>
                        <Select
                          value={selectedMethodId}
                          label={t('payments.instrument', 'Payment Instrument')}
                          onChange={(e) => setSelectedMethodId(e.target.value)}
                        >
                          {paymentMethods.map((m) => (
                            <MenuItem key={m.id} value={m.id}>
                              {m.name} ({m.kind || m.code})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>

                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        size="small"
                        label={t('payments.amount', 'Amount (IRR)')}
                        type="number"
                        required
                        fullWidth
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                      />
                    </Grid>
                  </Grid>

                  {/* On-Screen Touch Numpad */}
                  {showNumpad && (
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        mb: 2,
                        borderRadius: 2,
                        bgcolor: 'background.paper',
                        border: '1px dashed',
                        borderColor: 'primary.light',
                      }}
                    >
                      <Grid container spacing={1}>
                        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                          <Grid size={{ xs: 4 }} key={digit}>
                            <Button
                              fullWidth
                              variant="outlined"
                              size="medium"
                              sx={{ fontWeight: 800, fontSize: '1.1rem', py: 0.75 }}
                              onClick={() => handleNumpadDigit(digit)}
                            >
                              {digit}
                            </Button>
                          </Grid>
                        ))}
                        <Grid size={{ xs: 4 }}>
                          <Button
                            fullWidth
                            variant="outlined"
                            size="medium"
                            sx={{ fontWeight: 800, fontSize: '0.95rem', py: 0.75 }}
                            onClick={() => handleNumpadDigit('000')}
                          >
                            000
                          </Button>
                        </Grid>
                        <Grid size={{ xs: 4 }}>
                          <Button
                            fullWidth
                            variant="outlined"
                            size="medium"
                            sx={{ fontWeight: 800, fontSize: '1.1rem', py: 0.75 }}
                            onClick={() => handleNumpadDigit('0')}
                          >
                            0
                          </Button>
                        </Grid>
                        <Grid size={{ xs: 4 }}>
                          <Button
                            fullWidth
                            variant="outlined"
                            color="error"
                            size="medium"
                            sx={{ py: 0.75 }}
                            onClick={handleNumpadBackspace}
                          >
                            <BackspaceIcon fontSize="small" />
                          </Button>
                        </Grid>
                        <Grid size={{ xs: 6 }}>
                          <Button
                            fullWidth
                            variant="text"
                            color="warning"
                            size="small"
                            sx={{ fontWeight: 700 }}
                            onClick={handleNumpadClear}
                          >
                            پاک‌کردن (Clear)
                          </Button>
                        </Grid>
                        <Grid size={{ xs: 6 }}>
                          <Button
                            fullWidth
                            variant="text"
                            color="primary"
                            size="small"
                            sx={{ fontWeight: 700 }}
                            onClick={() => setPayAmount(wholeRials(order.due_amount))}
                          >
                            تسویه کل مانده
                          </Button>
                        </Grid>
                      </Grid>
                    </Paper>
                  )}

                  <Button
                    type="submit"
                    variant="contained"
                    fullWidth
                    disabled={loading || !payAmount}
                    sx={{ fontWeight: 'bold', py: 1 }}
                  >
                    {loading ? <CircularProgress size={20} /> : `ثبت پرداخت بخش انتخابی (${MoneyUtil.formatCurrency(payAmount || '0')} IRR)`}
                  </Button>
                </Box>
              </Box>
            )}

            {/* Payments History Table */}
            {payments.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                  {t('payments.title', 'Recorded Payments')} ({payments.length})
                </Typography>
                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, maxHeight: 160 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('common.time', 'Time')}</TableCell>
                        <TableCell align="right">{t('payments.amount', 'Amount')}</TableCell>
                        <TableCell>{t('payments.reference', 'Ref / POS')}</TableCell>
                        <TableCell>{t('common.status', 'Status')}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {payments.map((p) => {
                        const isVoidable = p.status === 'PENDING' || p.status === 'FAILED';
                        const unconfirmed = p.status === 'PROCESSING' && !!p.needs_terminal_check;
                        const statusColor =
                          p.status === 'SUCCEEDED'
                            ? 'success'
                            : p.status === 'FAILED' || p.status === 'CANCELLED'
                              ? 'error'
                              : 'warning';
                        return (
                          <TableRow key={p.id}>
                            <TableCell>{fTime(p.recorded_at)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold', color: statusColor === 'success' ? 'success.main' : 'text.secondary' }}>
                              {MoneyUtil.formatCurrency(p.amount)} IRR
                            </TableCell>
                            <TableCell>{p.reference_number || p.reference || '—'}</TableCell>
                            <TableCell>
                              <Chip
                                label={unconfirmed ? t('payments.unconfirmed.status', 'Check terminal') : p.status}
                                color={unconfirmed ? 'error' : statusColor}
                                size="small"
                              />
                            </TableCell>
                            <TableCell align="right">
                              {unconfirmed && <UnconfirmedChargeActions payment={p} onChanged={loadData} />}
                              {isVoidable && (
                                <Button size="small" color="error" onClick={() => handleVoidPayment(p.id)} disabled={loading}>
                                  {t('payments.void', 'Cancel')}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {isFullyPaid && (
          <PosFeatureGate off={!pos.features.receipt}>
            <Button
              variant="contained"
              color="primary"
              startIcon={<PrintIcon />}
              onClick={handlePrintReceipt}
              disabled={!pos.features.receipt}
              sx={{ fontWeight: 'bold' }}
            >
              {t('pos.printReceipt', 'Print Receipt')}
            </Button>
          </PosFeatureGate>
        )}
        <Button onClick={onClose}>{t('common.close', 'Close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
