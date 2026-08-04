import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Stack,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Divider,
} from '@mui/material';
import PaymentIcon from '@mui/icons-material/Payment';
import PrintIcon from '@mui/icons-material/Print';

import { orderApi, OrderHeader } from 'src/api/orderApi';
import { paymentApi, Payment } from 'src/api/paymentApi';
import { settingsApi, PaymentMethod } from 'src/api/settingsApi';

interface CheckoutModalProps {
  open: boolean;
  orderId: string | null;
  onClose: () => void;
  onPaymentComplete?: () => void;
}

export function CheckoutModal({ open, orderId, onClose, onPaymentComplete }: CheckoutModalProps) {
  const navigate = useNavigate();

  const [order, setOrder] = useState<OrderHeader | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [refNumber, setRefNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const o = await orderApi.getOrderById(orderId);
      setOrder(o);
      setPayAmount(o.due_amount);

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
  };

  useEffect(() => {
    if (open && orderId) {
      loadData();
    }
  }, [open, orderId]);

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

      if (Number(res.order.due_amount) === 0 && onPaymentComplete) {
        onPaymentComplete();
      }
    } catch (err: any) {
      setError(err.detail || 'Payment failed');
    }
  };

  const isFullyPaid = order ? Number(order.due_amount) === 0 : false;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
        <PaymentIcon color="primary" />
        Order Settlement & Checkout — {order?.order_number}
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
                <Typography variant="body2" color="text.secondary">Total Amount:</Typography>
                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                  {Number(order.total_amount).toLocaleString()} IRR
                </Typography>
              </Stack>
              <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary">Paid Amount:</Typography>
                <Typography variant="body2" color="success.main" sx={{ fontWeight: 'bold' }}>
                  {Number(order.paid_amount).toLocaleString()} IRR
                </Typography>
              </Stack>
              <Divider sx={{ my: 1 }} />
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Remaining Due:</Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', color: isFullyPaid ? 'success.main' : 'error.main' }}>
                  {Number(order.due_amount).toLocaleString()} IRR
                </Typography>
              </Stack>
            </Paper>

            {isFullyPaid ? (
              <Alert severity="success" sx={{ py: 1 }}>
                <strong>Order Fully Settled!</strong> No remaining due balance.
              </Alert>
            ) : (
              <Box component="form" onSubmit={handleAddPayment} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 2 }}>
                  Add Payment Tender (Split Allowed)
                </Typography>
                <Stack spacing={2}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Payment Method</InputLabel>
                    <Select
                      value={selectedMethodId}
                      label="Payment Method"
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
                    label="Tender Amount (IRR)"
                    type="number"
                    required
                    fullWidth
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                  />

                  <TextField
                    size="small"
                    label="Reference # / POS Terminal Tx"
                    placeholder="e.g. POS-998822"
                    fullWidth
                    value={refNumber}
                    onChange={(e) => setRefNumber(e.target.value)}
                  />

                  <Button type="submit" variant="contained" fullWidth sx={{ fontWeight: 'bold' }}>
                    Post Payment Tender
                  </Button>
                </Stack>
              </Box>
            )}

            {/* Payments Table */}
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mt: 2 }}>
              Posted Payment Tenders
            </Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, maxHeight: 180 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Time</TableCell>
                    <TableCell align="right">Amount (IRR)</TableCell>
                    <TableCell>Ref #</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{new Date(p.recorded_at).toLocaleTimeString()}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                        {Number(p.amount).toLocaleString()} IRR
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
            Print Thermal Receipt
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
