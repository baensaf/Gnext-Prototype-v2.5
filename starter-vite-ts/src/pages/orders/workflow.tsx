import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Stack,
  Chip,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import CancelIcon from '@mui/icons-material/Cancel';

import { orderApi, OrderHeader } from 'src/api/orderApi';
import { settingsApi, ReasonCode } from 'src/api/settingsApi';

export function OrdersWorkflowPage() {
  const { t } = useTranslation();

  const [orders, setOrders] = useState<OrderHeader[]>([]);
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cancellation Dialog
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OrderHeader | null>(null);
  const [reasonCodeId, setReasonCodeId] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const oList = await orderApi.getOrders();
      setOrders(oList);
      const rList = await settingsApi.getReasonCodes();
      setReasonCodes(rList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load active orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleUpdateStatus = async (orderId: string, nextStatus: string) => {
    try {
      await orderApi.updateOrderStatus(orderId, nextStatus);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to update order status');
    }
  };

  const handleOpenCancelDialog = (order: OrderHeader) => {
    setSelectedOrder(order);
    setReasonCodeId('');
    setCancelDialogOpen(true);
  };

  const handleConfirmCancel = async () => {
    if (!selectedOrder || !reasonCodeId) {
      setError('Please select a cancellation reason code');
      return;
    }
    try {
      await orderApi.updateOrderStatus(selectedOrder.id, 'CANCELLED', reasonCodeId);
      setCancelDialogOpen(false);
      setSelectedOrder(null);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to cancel order');
    }
  };

  const getOrdersByStatus = (status: string) =>
    orders.filter((o) => o.status === status);

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Active Orders & KDS Workflow
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Real-time kitchen display system (KDS) and status transition state machine board
          </Typography>
        </Box>
        <Button variant="outlined" onClick={loadData} sx={{ fontWeight: 'bold' }}>
          Refresh Board
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2}>
        {/* Columns: SUBMITTED, KITCHEN_PREPARING, READY, COMPLETED */}
        {[
          { key: 'SUBMITTED', title: 'Submitted Orders', color: 'info.main' },
          { key: 'KITCHEN_PREPARING', title: 'Kitchen Preparing', color: 'warning.main' },
          { key: 'READY', title: 'Ready for Pickup', color: 'success.main' },
          { key: 'COMPLETED', title: 'Completed', color: 'text.secondary' },
        ].map((col) => (
          <Grid size={{ xs: 12, sm: 6, md: 3 }} key={col.key}>
            <Card sx={{ borderRadius: 3, boxShadow: 2, bgcolor: 'background.neutral', minHeight: 600 }}>
              <CardContent sx={{ p: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 2, color: col.color }}>
                  {col.title} ({getOrdersByStatus(col.key).length})
                </Typography>

                <Stack spacing={2}>
                  {getOrdersByStatus(col.key).map((order) => (
                    <Card key={order.id} sx={{ borderRadius: 2, boxShadow: 1, p: 2 }}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                          <code>{order.order_number}</code>
                        </Typography>
                        <Chip label={order.order_type} size="small" variant="outlined" />
                      </Stack>

                      {order.table_number && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                          Table: <strong>{order.table_number}</strong>
                        </Typography>
                      )}

                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                        Placed: {new Date(order.placed_at).toLocaleTimeString()}
                      </Typography>

                      <Box sx={{ mb: 1.5, p: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
                        {order.items?.map((item) => (
                          <Box key={item.id} sx={{ mb: 0.5 }}>
                            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                              {Number(item.quantity).toFixed(0)}x {item.product_name}
                            </Typography>
                            {item.options?.map((opt) => (
                              <Typography key={opt.id} variant="caption" color="text.secondary" sx={{ display: 'block', pl: 1 }}>
                                + {opt.option_item_name}
                              </Typography>
                            ))}
                          </Box>
                        ))}
                      </Box>

                      <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1.5, color: 'primary.main' }}>
                        Total: {Number(order.total_amount).toLocaleString()} IRR
                      </Typography>

                      {/* State Machine Transition Actions */}
                      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                        {order.status === 'SUBMITTED' && (
                          <Button
                            size="small"
                            variant="contained"
                            color="warning"
                            startIcon={<PlayArrowIcon />}
                            onClick={() => handleUpdateStatus(order.id, 'KITCHEN_PREPARING')}
                            fullWidth
                            sx={{ fontWeight: 'bold' }}
                          >
                            Start Preparing
                          </Button>
                        )}

                        {order.status === 'KITCHEN_PREPARING' && (
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            startIcon={<CheckCircleIcon />}
                            onClick={() => handleUpdateStatus(order.id, 'READY')}
                            fullWidth
                            sx={{ fontWeight: 'bold' }}
                          >
                            Mark Ready
                          </Button>
                        )}

                        {order.status === 'READY' && (
                          <Button
                            size="small"
                            variant="contained"
                            color="primary"
                            startIcon={<DoneAllIcon />}
                            onClick={() => handleUpdateStatus(order.id, 'COMPLETED')}
                            fullWidth
                            sx={{ fontWeight: 'bold' }}
                          >
                            Complete Order
                          </Button>
                        )}

                        {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            startIcon={<CancelIcon />}
                            onClick={() => handleOpenCancelDialog(order)}
                            fullWidth
                            sx={{ mt: 0.5 }}
                          >
                            Cancel
                          </Button>
                        )}
                      </Stack>
                    </Card>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Cancellation Reason Dialog */}
      <Dialog open={cancelDialogOpen} onClose={() => setCancelDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          Cancel Order {selectedOrder?.order_number}
        </DialogTitle>
        <DialogContent sx={{ minWidth: 360, pt: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Per operational specification, a mandatory reason code is required when cancelling an active order.
          </Typography>

          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Cancellation Reason Code</InputLabel>
            <Select
              value={reasonCodeId}
              label="Cancellation Reason Code"
              onChange={(e) => setReasonCodeId(e.target.value)}
            >
              {reasonCodes.map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.name} ({r.code})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelDialogOpen(false)}>Keep Order</Button>
          <Button variant="contained" color="error" onClick={handleConfirmCancel} sx={{ fontWeight: 'bold' }}>
            Confirm Cancellation
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
