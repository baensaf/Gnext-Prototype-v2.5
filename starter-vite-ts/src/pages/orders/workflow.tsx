import type { OrderHeader } from 'src/api/orderApi';
import type { Customer } from 'src/api/customerApi';
import type { ReceiptData } from 'src/api/paymentApi';
import type { ReasonCode } from 'src/api/settingsApi';

import React, { useState, useEffect } from 'react';

import CancelIcon from '@mui/icons-material/Cancel';
import PersonIcon from '@mui/icons-material/Person';
import SearchIcon from '@mui/icons-material/Search';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import ReceiptIcon from '@mui/icons-material/Receipt';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import {
  Box,
  Tab,
  Card,
  Chip,
  Grid,
  Tabs,
  Stack,
  Alert,
  Paper,
  Table,
  Button,
  Dialog,
  Select,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  InputLabel,
  CardContent,
  DialogTitle,
  FormControl,
  ToggleButton,
  DialogContent,
  DialogActions,
  TableContainer,
  InputAdornment,
  ToggleButtonGroup,
} from '@mui/material';

import { orderApi } from 'src/api/orderApi';
import { paymentApi } from 'src/api/paymentApi';
import { customerApi } from 'src/api/customerApi';
import { settingsApi } from 'src/api/settingsApi';

export function OrdersWorkflowPage() {
  const [orders, setOrders] = useState<OrderHeader[]>([]);
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);
  const [customersMap, setCustomersMap] = useState<Map<string, Customer>>(new Map());
  const [error, setError] = useState<string | null>(null);

  // View state: 'table' vs 'kanban'
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Cancellation Dialog
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OrderHeader | null>(null);
  const [reasonCodeId, setReasonCodeId] = useState('');

  // Receipt Modal State
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

  const loadData = async () => {
    try {
      const [oList, rList, cList] = await Promise.all([
        orderApi.getOrders(),
        settingsApi.getReasonCodes(),
        customerApi.getCustomers(),
      ]);
      setOrders(oList);
      setReasonCodes(rList);

      const cMap = new Map<string, Customer>();
      cList.forEach((c) => cMap.set(c.id, c));
      setCustomersMap(cMap);

      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load active orders');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getCustomerDisplayName = (order: OrderHeader) => {
    if (order.customer_name) return order.customer_name;
    if (order.customer_id && customersMap.has(order.customer_id)) {
      const c = customersMap.get(order.customer_id)!;
      return `${c.first_name} ${c.last_name}`;
    }
    return 'Walk-in Customer';
  };

  const getCustomerMobile = (order: OrderHeader) => {
    if (order.customer_mobile) return order.customer_mobile;
    if (order.customer_id && customersMap.has(order.customer_id)) {
      return customersMap.get(order.customer_id)!.mobile;
    }
    return null;
  };

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

  const handleViewReceipt = async (orderId: string) => {
    try {
      const data = await paymentApi.getReceipt(orderId);
      setReceiptData(data);
      setReceiptModalOpen(true);
    } catch (err: any) {
      setError(err.detail || 'Failed to load receipt details');
    }
  };

  const getStatusChipColor = (status: string) => {
    switch (status) {
      case 'SUBMITTED': return 'info';
      case 'KITCHEN_PREPARING': return 'warning';
      case 'READY': return 'success';
      case 'COMPLETED': return 'default';
      case 'CANCELLED': return 'error';
      case 'REFUNDED': return 'secondary';
      default: return 'default';
    }
  };

  // Filtered orders list
  const filteredOrders = orders.filter((o) => {
    const matchesStatus = statusFilter === 'ALL' || o.status === statusFilter;
    const q = searchQuery.toLowerCase().trim();
    const custName = getCustomerDisplayName(o).toLowerCase();
    const custMobile = (getCustomerMobile(o) || '').toLowerCase();
    const matchesSearch =
      !q ||
      o.order_number.toLowerCase().includes(q) ||
      custName.includes(q) ||
      custMobile.includes(q) ||
      (o.table_number && o.table_number.toLowerCase().includes(q)) ||
      (o.notes && o.notes.toLowerCase().includes(q)) ||
      o.items.some((it) => it.product_name.toLowerCase().includes(q));
    return matchesStatus && matchesSearch;
  });

  const getOrdersByStatus = (status: string) =>
    orders.filter((o) => o.status === status);

  return (
    <Box sx={{ pb: 6 }}>
      {/* Header Banner */}
      <Stack
        direction={{ md: 'row', xs: 'column' }}
        spacing={3}
        sx={{ alignItems: { md: 'center', xs: 'flex-start' }, justifyContent: 'space-between', mb: 3 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Order Management & Dispatch
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Real-time order registry, interactive state machine controls, and KDS workflow status board
          </Typography>
        </Box>

        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <ToggleButtonGroup
            color="primary"
            exclusive
            onChange={(_, nextView) => {
              if (nextView) setViewMode(nextView);
            }}
            size="small"
            value={viewMode}
          >
            <ToggleButton value="table">
              <TableChartIcon sx={{ mr: 0.5 }} /> Table View
            </ToggleButton>
            <ToggleButton value="kanban">
              <ViewKanbanIcon sx={{ mr: 0.5 }} /> Kanban Board
            </ToggleButton>
          </ToggleButtonGroup>

          <Button onClick={loadData} startIcon={<RefreshIcon />} variant="outlined">
            Refresh
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert onClose={() => setError(null)} severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Filters Bar */}
      <Card sx={{ borderRadius: 3, boxShadow: 2, mb: 3 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Stack
            direction={{ md: 'row', xs: 'column' }}
            spacing={2}
            sx={{ alignItems: { md: 'center', xs: 'flex-start' }, justifyContent: 'space-between' }}
          >
            <Tabs
              onChange={(_, val) => setStatusFilter(val)}
              sx={{ minHeight: 40 }}
              value={statusFilter}
              variant="scrollable"
            >
              <Tab label={`All (${orders.length})`} value="ALL" />
              <Tab label={`Submitted (${getOrdersByStatus('SUBMITTED').length})`} value="SUBMITTED" />
              <Tab label={`Preparing (${getOrdersByStatus('KITCHEN_PREPARING').length})`} value="KITCHEN_PREPARING" />
              <Tab label={`Ready (${getOrdersByStatus('READY').length})`} value="READY" />
              <Tab label={`Completed (${getOrdersByStatus('COMPLETED').length})`} value="COMPLETED" />
              <Tab label={`Cancelled (${getOrdersByStatus('CANCELLED').length})`} value="CANCELLED" />
            </Tabs>

            <TextField
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by order #, customer name, table..."
              size="small"
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon color="action" fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ width: { md: 320, xs: '100%' } }}
              value={searchQuery}
            />
          </Stack>
        </CardContent>
      </Card>

      {/* VIEW 1: DATA TABLE VIEW */}
      {viewMode === 'table' && (
        <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: (t) => (t.palette.mode === 'dark' ? 'grey.800' : 'grey.100') }}>
                  <TableCell sx={{ fontWeight: 700 }}>Order Number</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Customer Name</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Table / Notes</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Items Summary</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Total Amount</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Paid / Due</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700 }}>Placed At</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredOrders.length === 0 ? (
                  <TableRow>
                    <TableCell align="center" colSpan={10} sx={{ py: 6 }}>
                      <Typography color="text.secondary" variant="body1">
                        No orders found matching your filter criteria.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredOrders.map((order) => {
                    const custName = getCustomerDisplayName(order);
                    const custMobile = getCustomerMobile(order);

                    return (
                      <TableRow key={order.id} hover>
                        <TableCell>
                          <Chip
                            label={order.order_number}
                            size="small"
                            sx={{ fontFamily: 'monospace', fontWeight: 700 }}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                            <PersonIcon color="action" fontSize="small" />
                            <Box>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                {custName}
                              </Typography>
                              {custMobile && (
                                <Typography color="text.secondary" variant="caption" sx={{ display: 'block' }}>
                                  {custMobile}
                                </Typography>
                              )}
                            </Box>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Chip
                            color={order.order_type === 'DINE_IN' ? 'primary' : 'info'}
                            label={order.order_type}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          {order.table_number ? (
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              Table {order.table_number}
                            </Typography>
                          ) : (
                            <Typography color="text.secondary" variant="caption">
                              {order.notes || 'Counter / Takeaway'}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Stack spacing={0.5}>
                            {order.items.map((it) => (
                              <Typography key={it.id} variant="caption" sx={{ display: 'block' }}>
                                <strong>{Number(it.quantity).toFixed(0)}x</strong> {it.product_name}
                                {it.options && it.options.length > 0 && (
                                  <span style={{ opacity: 0.75 }}> ({it.options.map(o => o.option_item_name).join(', ')})</span>
                                )}
                              </Typography>
                            ))}
                          </Stack>
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'primary.main', fontWeight: 700 }}>
                          {Number(order.total_amount).toLocaleString()} IRR
                        </TableCell>
                        <TableCell align="right">
                          <Typography color="success.main" sx={{ display: 'block', fontWeight: 600 }} variant="caption">
                            Paid: {Number(order.paid_amount).toLocaleString()}
                          </Typography>
                          {Number(order.due_amount) > 0 ? (
                            <Typography color="error.main" sx={{ fontWeight: 700 }} variant="caption">
                              Due: {Number(order.due_amount).toLocaleString()}
                            </Typography>
                          ) : (
                            <Chip color="success" label="FULLY PAID" size="small" sx={{ fontSize: 9, height: 18 }} />
                          )}
                        </TableCell>
                        <TableCell align="center">
                          <Typography variant="caption">
                            {new Date(order.placed_at).toLocaleTimeString()}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Chip
                            color={getStatusChipColor(order.status) as any}
                            label={order.status}
                            size="small"
                            sx={{ fontWeight: 700 }}
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Stack direction="row" spacing={1} sx={{ justifyContent: 'center' }}>
                            <Button
                              onClick={() => handleViewReceipt(order.id)}
                              size="small"
                              startIcon={<ReceiptIcon />}
                              variant="outlined"
                            >
                              Receipt
                            </Button>

                            {order.status === 'SUBMITTED' && (
                              <Button
                                color="warning"
                                onClick={() => handleUpdateStatus(order.id, 'KITCHEN_PREPARING')}
                                size="small"
                                startIcon={<PlayArrowIcon />}
                                variant="contained"
                              >
                                Prep
                              </Button>
                            )}

                            {order.status === 'KITCHEN_PREPARING' && (
                              <Button
                                color="success"
                                onClick={() => handleUpdateStatus(order.id, 'READY')}
                                size="small"
                                startIcon={<CheckCircleIcon />}
                                variant="contained"
                              >
                                Ready
                              </Button>
                            )}

                            {order.status === 'READY' && (
                              <Button
                                color="primary"
                                onClick={() => handleUpdateStatus(order.id, 'COMPLETED')}
                                size="small"
                                startIcon={<DoneAllIcon />}
                                variant="contained"
                              >
                                Complete
                              </Button>
                            )}

                            {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
                              <Button
                                color="error"
                                onClick={() => handleOpenCancelDialog(order)}
                                size="small"
                                startIcon={<CancelIcon />}
                                variant="outlined"
                              >
                                Cancel
                              </Button>
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      {/* VIEW 2: KANBAN BOARD VIEW */}
      {viewMode === 'kanban' && (
        <Grid container spacing={2}>
          {[
            { color: 'info.main', key: 'SUBMITTED', title: 'Submitted Orders' },
            { color: 'warning.main', key: 'KITCHEN_PREPARING', title: 'Kitchen Preparing' },
            { color: 'success.main', key: 'READY', title: 'Ready for Pickup' },
            { color: 'text.secondary', key: 'COMPLETED', title: 'Completed' },
          ].map((col) => (
            <Grid key={col.key} size={{ md: 3, sm: 6, xs: 12 }}>
              <Card sx={{ bgcolor: 'background.neutral', borderRadius: 3, boxShadow: 2, minHeight: 600 }}>
                <CardContent sx={{ p: 2 }}>
                  <Typography sx={{ color: col.color, fontWeight: 'bold', mb: 2 }} variant="subtitle1">
                    {col.title} ({getOrdersByStatus(col.key).length})
                  </Typography>

                  <Stack spacing={2}>
                    {getOrdersByStatus(col.key).map((order) => {
                      const custName = getCustomerDisplayName(order);

                      return (
                        <Card key={order.id} sx={{ borderRadius: 2, boxShadow: 1, p: 2 }}>
                          <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}>
                            <Typography sx={{ fontWeight: 'bold' }} variant="subtitle2">
                              <code>{order.order_number}</code>
                            </Typography>
                            <Chip label={order.order_type} size="small" variant="outlined" />
                          </Stack>

                          <Typography color="text.primary" sx={{ fontWeight: 700, mb: 0.5 }} variant="body2">
                            👤 {custName}
                          </Typography>

                          {order.table_number && (
                            <Typography color="text.secondary" sx={{ display: 'block', mb: 1 }} variant="caption">
                              Table: <strong>{order.table_number}</strong>
                            </Typography>
                          )}

                          <Typography color="text.secondary" sx={{ display: 'block', mb: 1.5 }} variant="caption">
                            Placed: {new Date(order.placed_at).toLocaleTimeString()}
                          </Typography>

                          <Box sx={{ bgcolor: 'background.paper', borderRadius: 1, mb: 1.5, p: 1 }}>
                            {order.items?.map((item) => (
                              <Box key={item.id} sx={{ mb: 0.5 }}>
                                <Typography sx={{ fontWeight: 'bold' }} variant="body2">
                                  {Number(item.quantity).toFixed(0)}x {item.product_name}
                                </Typography>
                                {item.options?.map((opt) => (
                                  <Typography key={opt.id} color="text.secondary" sx={{ display: 'block', pl: 1 }} variant="caption">
                                    + {opt.option_item_name}
                                  </Typography>
                                ))}
                              </Box>
                            ))}
                          </Box>

                          <Typography color="primary.main" sx={{ fontWeight: 'bold', mb: 1.5 }} variant="subtitle2">
                            Total: {Number(order.total_amount).toLocaleString()} IRR
                          </Typography>

                          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                            {order.status === 'SUBMITTED' && (
                              <Button
                                color="warning"
                                fullWidth
                                onClick={() => handleUpdateStatus(order.id, 'KITCHEN_PREPARING')}
                                size="small"
                                startIcon={<PlayArrowIcon />}
                                sx={{ fontWeight: 'bold' }}
                                variant="contained"
                              >
                                Start Preparing
                              </Button>
                            )}

                            {order.status === 'KITCHEN_PREPARING' && (
                              <Button
                                color="success"
                                fullWidth
                                onClick={() => handleUpdateStatus(order.id, 'READY')}
                                size="small"
                                startIcon={<CheckCircleIcon />}
                                sx={{ fontWeight: 'bold' }}
                                variant="contained"
                              >
                                Mark Ready
                              </Button>
                            )}

                            {order.status === 'READY' && (
                              <Button
                                color="primary"
                                fullWidth
                                onClick={() => handleUpdateStatus(order.id, 'COMPLETED')}
                                size="small"
                                startIcon={<DoneAllIcon />}
                                sx={{ fontWeight: 'bold' }}
                                variant="contained"
                              >
                                Complete Order
                              </Button>
                            )}

                            {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
                              <Button
                                color="error"
                                fullWidth
                                onClick={() => handleOpenCancelDialog(order)}
                                size="small"
                                startIcon={<CancelIcon />}
                                sx={{ mt: 0.5 }}
                                variant="outlined"
                              >
                                Cancel
                              </Button>
                            )}
                          </Stack>
                        </Card>
                      );
                    })}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Cancellation Reason Dialog */}
      <Dialog onClose={() => setCancelDialogOpen(false)} open={cancelDialogOpen}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          Cancel Order {selectedOrder?.order_number}
        </DialogTitle>
        <DialogContent sx={{ minWidth: 360, pt: 2 }}>
          <Typography color="text.secondary" sx={{ mb: 2 }} variant="body2">
            Per operational specification, a mandatory reason code is required when cancelling an active order.
          </Typography>

          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Cancellation Reason Code</InputLabel>
            <Select
              label="Cancellation Reason Code"
              onChange={(e) => setReasonCodeId(e.target.value)}
              value={reasonCodeId}
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
          <Button color="error" onClick={handleConfirmCancel} sx={{ fontWeight: 'bold' }} variant="contained">
            Confirm Cancellation
          </Button>
        </DialogActions>
      </Dialog>

      {/* Receipt Modal */}
      <Dialog maxWidth="xs" onClose={() => setReceiptModalOpen(false)} open={receiptModalOpen} fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 'bold' }}>
          <ReceiptIcon color="primary" />
          Receipt #{receiptData?.receipt_header.order_number}
        </DialogTitle>
        <DialogContent>
          {receiptData && (
            <Paper
              variant="outlined"
              sx={{
                bgcolor: '#fafafa',
                fontFamily: 'monospace',
                fontSize: 12,
                p: 2,
              }}
            >
              <Typography align="center" sx={{ fontWeight: 800 }} variant="subtitle2">
                {receiptData.receipt_header.tenant_name}
              </Typography>
              <Typography align="center" color="text.secondary" sx={{ display: 'block', mb: 1 }} variant="caption">
                {receiptData.receipt_header.branch_name} • {receiptData.receipt_header.branch_phone}
              </Typography>
              <Typography align="center" color="text.secondary" sx={{ display: 'block', mb: 1.5 }} variant="caption">
                {new Date(receiptData.receipt_header.placed_at).toLocaleString()}
              </Typography>

              <Typography sx={{ borderBottom: 1, borderColor: 'divider', display: 'block', fontWeight: 700, mb: 1, pb: 0.5 }} variant="caption">
                ITEMS:
              </Typography>
              {receiptData.items.map((it, idx) => (
                <Stack key={idx} direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="caption">
                    {it.quantity}x {it.product_name}
                  </Typography>
                  <Typography sx={{ fontWeight: 700 }} variant="caption">
                    {Number(it.total_amount).toLocaleString()}
                  </Typography>
                </Stack>
              ))}

              <Typography sx={{ borderTop: 1, borderColor: 'divider', display: 'block', fontWeight: 700, mt: 1.5, pt: 1 }} variant="caption">
                TOTAL: {Number(receiptData.totals.total_amount).toLocaleString()} IRR
              </Typography>
              <Typography color="success.main" sx={{ display: 'block', fontWeight: 700 }} variant="caption">
                PAID: {Number(receiptData.totals.paid_amount).toLocaleString()} IRR
              </Typography>

              <Typography align="center" color="text.secondary" sx={{ display: 'block', mt: 2 }} variant="caption">
                {receiptData.receipt_footer.bilingual_note_en}
              </Typography>
            </Paper>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReceiptModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
