import type { OrderHeader } from 'src/api/orderApi';
import type { Customer } from 'src/api/customerApi';
import type { ReceiptData } from 'src/api/paymentApi';
import type { ReasonCode } from 'src/api/settingsApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import CodeIcon from '@mui/icons-material/Code';
import CloseIcon from '@mui/icons-material/Close';
import CancelIcon from '@mui/icons-material/Cancel';
import PersonIcon from '@mui/icons-material/Person';
import SearchIcon from '@mui/icons-material/Search';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import ReceiptIcon from '@mui/icons-material/Receipt';
import RefreshIcon from '@mui/icons-material/Refresh';
import HistoryIcon from '@mui/icons-material/History';
import SecurityIcon from '@mui/icons-material/Security';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
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
  Drawer,
  Divider,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  InputLabel,
  IconButton,
  CardContent,
  DialogTitle,
  FormControl,
  ToggleButton,
  DialogContent,
  DialogActions,
  TableContainer,
  InputAdornment,
  CircularProgress,
  ToggleButtonGroup,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';

import { orderApi } from 'src/api/orderApi';
import { paymentApi } from 'src/api/paymentApi';
import { customerApi } from 'src/api/customerApi';
import { settingsApi } from 'src/api/settingsApi';
import { httpClient as axios } from 'src/api/httpClient';


export function OrdersWorkflowPage() {
  const { t } = useTranslation();

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

  // Order Details & Audit Drawer State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedDrawerOrder, setSelectedDrawerOrder] = useState<any | null>(null);
  const [orderAuditLogs, setOrderAuditLogs] = useState<any[]>([]);
  const [loadingDrawerDetails, setLoadingDrawerDetails] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'details' | 'audit'>('details');
  const [inspectingJson, setInspectingJson] = useState<any>(null);

  const getOrderTypeLabel = (orderType: string) => {
    switch (orderType) {
      case 'DINE_IN':
        return t('orders.types.dineIn');
      case 'TAKEAWAY':
        return t('orders.types.takeaway');
      case 'DELIVERY':
        return t('orders.types.delivery');
      default:
        return orderType;
    }
  };

  const getOrderStatusLabel = (status: string) => {
    switch (status) {
      case 'SUBMITTED':
        return t('orders.statuses.submitted');
      case 'KITCHEN_PREPARING':
        return t('orders.statuses.kitchenPreparing');
      case 'READY':
        return t('orders.statuses.ready');
      case 'COMPLETED':
        return t('orders.statuses.completed');
      case 'CANCELLED':
        return t('orders.statuses.cancelled');
      case 'REFUNDED':
        return t('orders.statuses.refunded');
      default:
        return status;
    }
  };

  const handleOpenOrderDrawer = async (order: OrderHeader) => {
    setSelectedOrder(order);
    setSelectedDrawerOrder(order);
    setDrawerOpen(true);
    setLoadingDrawerDetails(true);
    try {
      const [detailRes, auditRes] = await Promise.all([
        axios.get(`/api/v1/orders/${order.id}`).catch(() => ({ data: order })),
        axios.get('/api/v1/reports/audit', { params: { entityId: order.id } }).catch(() => ({ data: [] })),
      ]);
      setSelectedDrawerOrder(detailRes.data);
      const auditList = Array.isArray(auditRes.data) ? auditRes.data : (auditRes.data?.data || []);
      setOrderAuditLogs(auditList);
    } catch (err) {
      console.error('Failed to load order drawer details:', err);
    } finally {
      setLoadingDrawerDetails(false);
    }
  };

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
      setError(err.detail || t('orders.errors.loadFailed'));
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
    return t('orders.table.walkInCustomer');
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
      setError(err.detail || t('orders.errors.updateStatusFailed'));
    }
  };

  const handleOpenCancelDialog = (order: OrderHeader) => {
    setSelectedOrder(order);
    setReasonCodeId('');
    setCancelDialogOpen(true);
  };

  const handleConfirmCancel = async () => {
    if (!selectedOrder || !reasonCodeId) {
      setError(t('orders.cancelDialog.reasonRequired'));
      return;
    }
    try {
      await orderApi.updateOrderStatus(selectedOrder.id, 'CANCELLED', reasonCodeId);
      setCancelDialogOpen(false);
      setSelectedOrder(null);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('orders.errors.cancelFailed'));
    }
  };

  const handleViewReceipt = async (orderId: string) => {
    try {
      const data = await paymentApi.getReceipt(orderId);
      setReceiptData(data);
      setReceiptModalOpen(true);
    } catch (err: any) {
      setError(err.detail || t('orders.errors.receiptFailed'));
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
            {t('orders.title')}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            {t('orders.subtitle')}
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
              <TableChartIcon sx={{ mr: 0.5 }} /> {t('orders.tableView')}
            </ToggleButton>
            <ToggleButton value="kanban">
              <ViewKanbanIcon sx={{ mr: 0.5 }} /> {t('orders.kanbanBoard')}
            </ToggleButton>
          </ToggleButtonGroup>

          <Button onClick={loadData} startIcon={<RefreshIcon />} variant="outlined">
            {t('orders.refresh')}
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
              <Tab label={t('orders.tabs.all', { count: orders.length })} value="ALL" />
              <Tab label={t('orders.tabs.submitted', { count: getOrdersByStatus('SUBMITTED').length })} value="SUBMITTED" />
              <Tab label={t('orders.tabs.preparing', { count: getOrdersByStatus('KITCHEN_PREPARING').length })} value="KITCHEN_PREPARING" />
              <Tab label={t('orders.tabs.ready', { count: getOrdersByStatus('READY').length })} value="READY" />
              <Tab label={t('orders.tabs.completed', { count: getOrdersByStatus('COMPLETED').length })} value="COMPLETED" />
              <Tab label={t('orders.tabs.cancelled', { count: getOrdersByStatus('CANCELLED').length })} value="CANCELLED" />
            </Tabs>

            <TextField
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('orders.searchPlaceholder')}
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
                <TableRow sx={{ bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.800' : 'grey.100') }}>
                  <TableCell sx={{ fontWeight: 700 }}>{t('orders.table.orderNumber')}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>{t('orders.table.customerName')}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>{t('orders.table.type')}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>{t('orders.table.tableNotes')}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>{t('orders.table.itemsSummary')}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{t('orders.table.totalAmount')}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{t('orders.table.paidDue')}</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700 }}>{t('orders.table.placedAt')}</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700 }}>{t('orders.table.status')}</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700 }}>{t('orders.table.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredOrders.length === 0 ? (
                  <TableRow>
                    <TableCell align="center" colSpan={10} sx={{ py: 6 }}>
                      <Typography color="text.secondary" variant="body1">
                        {t('orders.table.empty')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredOrders.map((order) => {
                    const custName = getCustomerDisplayName(order);
                    const custMobile = getCustomerMobile(order);

                    return (
                      <TableRow
                        key={order.id}
                        hover
                        onClick={() => handleOpenOrderDrawer(order)}
                        sx={{
                          cursor: 'pointer',
                          transition: 'background-color 0.15s',
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                      >
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
                            label={getOrderTypeLabel(order.order_type)}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          {order.table_number ? (
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {t('orders.table.tableNumber', { number: order.table_number })}
                            </Typography>
                          ) : (
                            <Typography color="text.secondary" variant="caption">
                              {order.notes || t('orders.table.counterTakeaway')}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Stack spacing={0.5}>
                            {order.items.map((it) => (
                              <Typography key={it.id} variant="caption" sx={{ display: 'block' }}>
                                <strong>{MoneyUtil.format(it.quantity, 0)}x</strong> {it.product_name}
                                {it.options && it.options.length > 0 && (
                                  <span style={{ opacity: 0.75 }}> ({it.options.map(o => o.option_item_name).join(', ')})</span>
                                )}
                              </Typography>
                            ))}
                          </Stack>
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'primary.main', fontWeight: 700 }}>
                          <span dir="ltr">{MoneyUtil.formatCurrency(order.total_amount)} IRR</span>
                        </TableCell>
                        <TableCell align="right">
                          <Typography color="success.main" sx={{ display: 'block', fontWeight: 600 }} variant="caption">
                            <span dir="ltr">{t('orders.table.paid', { amount: MoneyUtil.formatCurrency(order.paid_amount) })} IRR</span>
                          </Typography>
                          {MoneyUtil.greaterThan(order.due_amount, '0') ? (
                            <Typography color="error.main" sx={{ fontWeight: 700 }} variant="caption">
                              <span dir="ltr">{t('orders.table.due', { amount: MoneyUtil.formatCurrency(order.due_amount) })} IRR</span>
                            </Typography>
                          ) : (
                            <Chip color="success" label={t('orders.table.fullyPaid')} size="small" sx={{ fontSize: 9, height: 18 }} />
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
                            label={getOrderStatusLabel(order.status)}
                            size="small"
                            sx={{ fontWeight: 700 }}
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Stack direction="row" spacing={1} sx={{ justifyContent: 'center' }}>
                            <Button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenOrderDrawer(order);
                              }}
                              size="small"
                              startIcon={<VisibilityIcon />}
                              variant="outlined"
                              color="primary"
                            >
                              {t('orders.actions.details')}
                            </Button>

                            <Button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewReceipt(order.id);
                              }}
                              size="small"
                              startIcon={<ReceiptIcon />}
                              variant="outlined"
                            >
                              {t('orders.actions.receipt')}
                            </Button>

                            {order.status === 'SUBMITTED' && (
                              <Button
                                color="warning"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUpdateStatus(order.id, 'KITCHEN_PREPARING');
                                }}
                                size="small"
                                startIcon={<PlayArrowIcon />}
                                variant="contained"
                              >
                                {t('orders.actions.prep')}
                              </Button>
                            )}

                            {order.status === 'KITCHEN_PREPARING' && (
                              <Button
                                color="success"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUpdateStatus(order.id, 'READY');
                                }}
                                size="small"
                                startIcon={<CheckCircleIcon />}
                                variant="contained"
                              >
                                {t('orders.actions.ready')}
                              </Button>
                            )}

                            {order.status === 'READY' && (
                              <Button
                                color="primary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUpdateStatus(order.id, 'COMPLETED');
                                }}
                                size="small"
                                startIcon={<DoneAllIcon />}
                                variant="contained"
                              >
                                {t('orders.actions.complete')}
                              </Button>
                            )}

                            {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
                              <Button
                                color="error"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenCancelDialog(order);
                                }}
                                size="small"
                                startIcon={<CancelIcon />}
                                variant="outlined"
                              >
                                {t('orders.actions.cancel')}
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
            { color: 'info.main', key: 'SUBMITTED', title: t('orders.kanban.submitted') },
            { color: 'warning.main', key: 'KITCHEN_PREPARING', title: t('orders.kanban.preparing') },
            { color: 'success.main', key: 'READY', title: t('orders.kanban.ready') },
            { color: 'text.secondary', key: 'COMPLETED', title: t('orders.kanban.completed') },
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
                        <Card
                          key={order.id}
                          onClick={() => handleOpenOrderDrawer(order)}
                          sx={{
                            borderRadius: 2,
                            boxShadow: 1,
                            p: 2,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            '&:hover': {
                              borderColor: 'primary.main',
                              boxShadow: 3,
                              transform: 'translateY(-2px)',
                            },
                          }}
                        >
                          <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}>
                            <Typography sx={{ fontWeight: 'bold' }} variant="subtitle2">
                              <code>{order.order_number}</code>
                            </Typography>
                            <Chip label={getOrderTypeLabel(order.order_type)} size="small" variant="outlined" />
                          </Stack>

                          <Typography color="text.primary" sx={{ fontWeight: 700, mb: 0.5 }} variant="body2">
                            👤 {custName}
                          </Typography>

                          {order.table_number && (
                            <Typography color="text.secondary" sx={{ display: 'block', mb: 1 }} variant="caption">
                              {t('orders.kanban.table', { number: order.table_number })}
                            </Typography>
                          )}

                          <Typography color="text.secondary" sx={{ display: 'block', mb: 1.5 }} variant="caption">
                            {t('orders.kanban.placed', { time: new Date(order.placed_at).toLocaleTimeString() })}
                          </Typography>

                          <Box sx={{ bgcolor: 'background.paper', borderRadius: 1, mb: 1.5, p: 1 }}>
                            {order.items?.map((item) => (
                              <Box key={item.id} sx={{ mb: 0.5 }}>
                                <Typography sx={{ fontWeight: 'bold' }} variant="body2">
                                  {MoneyUtil.format(item.quantity, 0)}x {item.product_name}
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
                            <span dir="ltr">{t('orders.kanban.total', { amount: MoneyUtil.formatCurrency(order.total_amount) })}</span>
                          </Typography>

                          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                            <Button
                              color="inherit"
                              fullWidth
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenOrderDrawer(order);
                              }}
                              size="small"
                              startIcon={<HistoryIcon />}
                              variant="outlined"
                              sx={{ mb: 0.5 }}
                            >
                              {t('orders.actions.detailsAudit')}
                            </Button>

                            {order.status === 'SUBMITTED' && (
                              <Button
                                color="warning"
                                fullWidth
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUpdateStatus(order.id, 'KITCHEN_PREPARING');
                                }}
                                size="small"
                                startIcon={<PlayArrowIcon />}
                                sx={{ fontWeight: 'bold' }}
                                variant="contained"
                              >
                                {t('orders.actions.startPrep')}
                              </Button>
                            )}

                            {order.status === 'KITCHEN_PREPARING' && (
                              <Button
                                color="success"
                                fullWidth
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUpdateStatus(order.id, 'READY');
                                }}
                                size="small"
                                startIcon={<CheckCircleIcon />}
                                sx={{ fontWeight: 'bold' }}
                                variant="contained"
                              >
                                {t('orders.actions.markReady')}
                              </Button>
                            )}

                            {order.status === 'READY' && (
                              <Button
                                color="primary"
                                fullWidth
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUpdateStatus(order.id, 'COMPLETED');
                                }}
                                size="small"
                                startIcon={<DoneAllIcon />}
                                sx={{ fontWeight: 'bold' }}
                                variant="contained"
                              >
                                {t('orders.actions.completeOrder')}
                              </Button>
                            )}

                            {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
                              <Button
                                color="error"
                                fullWidth
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenCancelDialog(order);
                                }}
                                size="small"
                                startIcon={<CancelIcon />}
                                sx={{ mt: 0.5 }}
                                variant="outlined"
                              >
                                {t('orders.actions.cancel')}
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
          {t('orders.cancelDialog.title', { orderNumber: selectedOrder?.order_number })}
        </DialogTitle>
        <DialogContent sx={{ minWidth: 360, pt: 2 }}>
          <Typography color="text.secondary" sx={{ mb: 2 }} variant="body2">
            {t('orders.cancelDialog.description')}
          </Typography>

          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>{t('orders.cancelDialog.reasonLabel')}</InputLabel>
            <Select
              label={t('orders.cancelDialog.reasonLabel')}
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
          <Button onClick={() => setCancelDialogOpen(false)}>{t('orders.cancelDialog.keepOrder')}</Button>
          <Button color="error" onClick={handleConfirmCancel} sx={{ fontWeight: 'bold' }} variant="contained">
            {t('orders.cancelDialog.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Receipt Modal */}
      <Dialog maxWidth="xs" onClose={() => setReceiptModalOpen(false)} open={receiptModalOpen} fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 'bold' }}>
          <ReceiptIcon color="primary" />
          {t('orders.receiptModal.title', { orderNumber: receiptData?.receipt_header.order_number })}
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
                {t('orders.receiptModal.items')}
              </Typography>
              {receiptData.items.map((it, idx) => (
                <Stack key={idx} direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="caption">
                    {MoneyUtil.format(it.quantity, 0)}x {it.product_name}
                  </Typography>
                  <Typography sx={{ fontWeight: 700 }} variant="caption">
                    <span dir="ltr">{MoneyUtil.formatCurrency(it.total_amount)} IRR</span>
                  </Typography>
                </Stack>
              ))}

              <Typography sx={{ borderTop: 1, borderColor: 'divider', display: 'block', fontWeight: 700, mt: 1.5, pt: 1 }} variant="caption">
                <span dir="ltr">{t('orders.receiptModal.total')} {MoneyUtil.formatCurrency(receiptData.totals.total_amount)} IRR</span>
              </Typography>
              <Typography color="success.main" sx={{ display: 'block', fontWeight: 700 }} variant="caption">
                <span dir="ltr">{t('orders.receiptModal.paid')} {MoneyUtil.formatCurrency(receiptData.totals.paid_amount)} IRR</span>
              </Typography>

              <Typography align="center" color="text.secondary" sx={{ display: 'block', mt: 2 }} variant="caption">
                {receiptData.receipt_footer.bilingual_note_en}
              </Typography>
            </Paper>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReceiptModalOpen(false)}>{t('orders.receiptModal.close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Order Details & Audit Trail Drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        slotProps={{
          paper: {
            sx: {
              width: { xs: '100%', sm: 540, md: 620 },
              p: 0,
              display: 'flex',
              flexDirection: 'column',
            },
          },
        }}
      >
        {selectedDrawerOrder && (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <Box sx={{ p: 2.5, pb: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.neutral' }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 800 }}>
                    {selectedDrawerOrder.order_number}
                  </Typography>
                  <Chip
                    label={getOrderStatusLabel(selectedDrawerOrder.status)}
                    color={getStatusChipColor(selectedDrawerOrder.status) as any}
                    size="small"
                    sx={{ fontWeight: 700 }}
                  />
                  <Chip
                    label={getOrderTypeLabel(selectedDrawerOrder.order_type)}
                    size="small"
                    variant="outlined"
                    color={selectedDrawerOrder.order_type === 'DINE_IN' ? 'primary' : 'default'}
                  />
                </Stack>
                <IconButton onClick={() => setDrawerOpen(false)} size="small">
                  <CloseIcon />
                </IconButton>
              </Stack>

              <Typography variant="caption" color="text.secondary">
                {t('orders.drawer.placedOn', { date: selectedDrawerOrder.placed_at ? new Date(selectedDrawerOrder.placed_at).toLocaleString() : t('orders.drawer.justNow') })}
                {selectedDrawerOrder.table_number && ` • ${t('orders.drawer.table', { number: selectedDrawerOrder.table_number })}`}
                {selectedDrawerOrder.notes && ` • ${t('orders.drawer.note', { note: selectedDrawerOrder.notes })}`}
              </Typography>

              {/* Tabs */}
              <Tabs
                value={drawerTab}
                onChange={(_, val) => setDrawerTab(val)}
                sx={{ mt: 2, minHeight: 38 }}
              >
                <Tab
                  value="details"
                  label={t('orders.drawer.tabs.summary')}
                  icon={<ReceiptLongIcon sx={{ fontSize: 18 }} />}
                  iconPosition="start"
                  sx={{ minHeight: 38, py: 0.5, fontWeight: 700 }}
                />
                <Tab
                  value="audit"
                  label={t('orders.drawer.tabs.audit', { count: (orderAuditLogs.length + (selectedDrawerOrder.stateEvents?.length || 0)) || 1 })}
                  icon={<HistoryIcon sx={{ fontSize: 18 }} />}
                  iconPosition="start"
                  sx={{ minHeight: 38, py: 0.5, fontWeight: 700 }}
                />
              </Tabs>
            </Box>

            {/* Body */}
            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
              {loadingDrawerDetails ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                  <CircularProgress />
                </Box>
              ) : drawerTab === 'details' ? (
                <Stack spacing={3}>
                  {/* Customer Info Card */}
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <PersonIcon fontSize="small" color="primary" /> {t('orders.drawer.customerContext')}
                    </Typography>
                    <Grid container spacing={1.5}>
                      <Grid size={{ xs: 6 }}>
                        <Typography variant="caption" color="text.secondary">{t('orders.drawer.customerName')}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{getCustomerDisplayName(selectedDrawerOrder)}</Typography>
                      </Grid>
                      <Grid size={{ xs: 6 }}>
                        <Typography variant="caption" color="text.secondary">{t('orders.drawer.contactPhone')}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{getCustomerMobile(selectedDrawerOrder) || t('orders.drawer.walkIn')}</Typography>
                      </Grid>
                      {selectedDrawerOrder.table_number && (
                        <Grid size={{ xs: 6 }}>
                          <Typography variant="caption" color="text.secondary">{t('orders.drawer.dineInTable')}</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('orders.drawer.table', { number: selectedDrawerOrder.table_number })}</Typography>
                        </Grid>
                      )}
                      {selectedDrawerOrder.notes && (
                        <Grid size={{ xs: 12 }}>
                          <Typography variant="caption" color="text.secondary">{t('orders.drawer.specialInstructions')}</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 500, bgcolor: 'background.neutral', p: 1, borderRadius: 1 }}>
                            {selectedDrawerOrder.notes}
                          </Typography>
                        </Grid>
                      )}
                    </Grid>
                  </Paper>

                  {/* Items List */}
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                      {t('orders.drawer.orderedItems', { count: (selectedDrawerOrder.items || []).length })}
                    </Typography>
                    <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                      <Table size="small">
                        <TableHead sx={{ bgcolor: 'background.neutral' }}>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 700 }}>{t('orders.drawer.item')}</TableCell>
                            <TableCell align="center" sx={{ fontWeight: 700 }}>{t('orders.drawer.qty')}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700 }}>{t('orders.drawer.unitPrice')}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700 }}>{t('orders.drawer.total')}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(selectedDrawerOrder.items || []).map((item: any) => (
                            <TableRow key={item.id}>
                              <TableCell>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                  {item.product_name}
                                </Typography>
                                {item.options && item.options.length > 0 && (
                                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', mt: 0.5 }}>
                                    {item.options.map((opt: any) => (
                                      <Chip
                                        key={opt.id}
                                        label={`+ ${opt.option_item_name}`}
                                        size="small"
                                        sx={{ fontSize: '0.7rem', height: 20 }}
                                      />
                                    ))}
                                  </Stack>
                                )}
                              </TableCell>
                              <TableCell align="center" sx={{ fontWeight: 600 }}>
                                {MoneyUtil.format(item.quantity, 0)}
                              </TableCell>
                              <TableCell align="right">
                                <span dir="ltr">{MoneyUtil.formatCurrency(item.unit_price)}</span>
                              </TableCell>
                              <TableCell align="right" sx={{ fontWeight: 700 }}>
                                <span dir="ltr">{MoneyUtil.formatCurrency(item.total_amount || MoneyUtil.multiply(item.quantity, item.unit_price, 2))} IRR</span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>

                  {/* Financial Breakdown */}
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'background.neutral' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                      {t('orders.drawer.financialBreakdown')}
                    </Typography>
                    <Stack spacing={1}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                        <Typography variant="body2" color="text.secondary">{t('orders.drawer.grossSubtotal')}</Typography>
                        <Typography variant="body2" dir="ltr">{MoneyUtil.formatCurrency(selectedDrawerOrder.subtotal_amount || selectedDrawerOrder.total_amount)} IRR</Typography>
                      </Stack>
                      {MoneyUtil.greaterThan(selectedDrawerOrder.discount_amount || '0', '0') && (
                        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="success.main">{t('orders.drawer.discountApplied')}</Typography>
                          <Typography variant="body2" color="success.main" dir="ltr">-{MoneyUtil.formatCurrency(selectedDrawerOrder.discount_amount)} IRR</Typography>
                        </Stack>
                      )}
                      {MoneyUtil.greaterThan(selectedDrawerOrder.tax_amount || '0', '0') && (
                        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="text.secondary">{t('orders.drawer.vat')}</Typography>
                          <Typography variant="body2" dir="ltr">+{MoneyUtil.formatCurrency(selectedDrawerOrder.tax_amount)} IRR</Typography>
                        </Stack>
                      )}
                      <Divider sx={{ my: 0.5 }} />
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{t('orders.drawer.grandTotal')}</Typography>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800, color: 'primary.main' }} dir="ltr">
                          {MoneyUtil.formatCurrency(selectedDrawerOrder.total_amount)} IRR
                        </Typography>
                      </Stack>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">{t('orders.drawer.paidAmount')}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: 'success.main' }} dir="ltr">
                          {MoneyUtil.formatCurrency(selectedDrawerOrder.paid_amount || '0')} IRR
                        </Typography>
                      </Stack>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">{t('orders.drawer.outstandingBalance')}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700, color: MoneyUtil.greaterThan(selectedDrawerOrder.due_amount || '0', '0') ? 'error.main' : 'success.main' }} dir="ltr">
                          {MoneyUtil.formatCurrency(selectedDrawerOrder.due_amount || '0')} IRR
                        </Typography>
                      </Stack>
                    </Stack>
                  </Paper>
                </Stack>
              ) : (
                /* TAB 2: AUDIT TRAIL & TIMELINE */
                <Stack spacing={2.5}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <SecurityIcon color="primary" fontSize="small" /> {t('orders.drawer.auditLogTitle')}
                    </Typography>
                    <Chip label={t('orders.drawer.appendOnly')} color="success" size="small" variant="outlined" />
                  </Box>

                  {/* Unified Chronological Event Timeline */}
                  {orderAuditLogs.length === 0 && (!selectedDrawerOrder.stateEvents || selectedDrawerOrder.stateEvents.length === 0) ? (
                    <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: 2 }}>
                      <HistoryIcon color="disabled" sx={{ fontSize: 40, mb: 1 }} />
                      <Typography variant="body2" color="text.secondary">
                        {t('orders.drawer.noEvents', { status: getOrderStatusLabel(selectedDrawerOrder.status) })}
                      </Typography>
                    </Paper>
                  ) : (
                    <Stack spacing={2} sx={{ position: 'relative', pl: 2, '&::before': { content: '""', position: 'absolute', top: 12, bottom: 12, left: 19, width: 2, bgcolor: 'divider' } }}>
                      {/* State Events from Order Aggregate */}
                      {selectedDrawerOrder.stateEvents?.map((evt: any, idx: number) => (
                        <Paper
                          key={evt.id || idx}
                          variant="outlined"
                          sx={{
                            p: 2,
                            borderRadius: 2,
                            position: 'relative',
                            bgcolor: 'background.paper',
                            borderColor: evt.to_state === 'CANCELLED' ? 'error.light' : 'divider',
                          }}
                        >
                          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                              <Chip
                                label={getOrderStatusLabel(evt.to_state)}
                                color={getStatusChipColor(evt.to_state) as any}
                                size="small"
                                sx={{ fontWeight: 700 }}
                              />
                              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                                {evt.from_state ? `${getOrderStatusLabel(evt.from_state)} → ${getOrderStatusLabel(evt.to_state)}` : getOrderStatusLabel(evt.to_state)}
                              </Typography>
                            </Stack>
                            <Typography variant="caption" color="text.secondary">
                              {evt.occurred_at ? new Date(evt.occurred_at).toLocaleTimeString() : t('orders.drawer.justNow')}
                            </Typography>
                          </Stack>

                          <Typography variant="body2" sx={{ mb: 0.5 }}>
                            <strong>{t('orders.drawer.actor')}</strong> {evt.actor_user_id ? t('orders.drawer.authenticatedUser') : t('orders.drawer.systemPos')}
                          </Typography>
                          {evt.reason && (
                            <Typography variant="body2" color="error.main" sx={{ fontWeight: 600 }}>
                              <strong>{t('orders.drawer.reasonCode')}</strong> {evt.reason}
                            </Typography>
                          )}
                          {evt.notes && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {t('orders.drawer.noteLabel')} {evt.notes}
                            </Typography>
                          )}
                        </Paper>
                      ))}

                      {/* System Audit Events from audit_event table */}
                      {orderAuditLogs.map((log: any) => (
                        <Paper
                          key={log.id}
                          variant="outlined"
                          sx={{
                            p: 2,
                            borderRadius: 2,
                            position: 'relative',
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                          }}
                        >
                          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                              <Chip
                                label={log.action}
                                color="primary"
                                size="small"
                                sx={{ fontWeight: 700 }}
                              />
                              <Chip
                                label={log.actor_type || 'SYSTEM'}
                                size="small"
                                variant="outlined"
                                sx={{ fontSize: '0.7rem', height: 20 }}
                              />
                            </Stack>
                            <Typography variant="caption" color="text.secondary">
                              {new Date(log.occurred_at).toLocaleString()}
                            </Typography>
                          </Stack>

                          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                              {t('orders.drawer.corr')} {log.correlation_id ? log.correlation_id.substring(0, 8) + '...' : '-'}
                            </Typography>
                            <Button
                              size="small"
                              startIcon={<CodeIcon />}
                              onClick={() => setInspectingJson(log)}
                              sx={{ textTransform: 'none', py: 0.25, fontSize: '0.75rem' }}
                            >
                              {t('orders.drawer.inspectSnapshot')}
                            </Button>
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  )}
                </Stack>
              )}
            </Box>

            {/* Footer Quick Actions */}
            <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', bgcolor: 'background.neutral' }}>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Button
                  startIcon={<ReceiptIcon />}
                  variant="outlined"
                  onClick={() => {
                    handleViewReceipt(selectedDrawerOrder.id);
                  }}
                >
                  {t('orders.actions.receipt')}
                </Button>
                {selectedDrawerOrder.status === 'SUBMITTED' && (
                  <Button
                    color="warning"
                    variant="contained"
                    startIcon={<PlayArrowIcon />}
                    onClick={async () => {
                      await handleUpdateStatus(selectedDrawerOrder.id, 'KITCHEN_PREPARING');
                      handleOpenOrderDrawer({ ...selectedDrawerOrder, status: 'KITCHEN_PREPARING' });
                    }}
                  >
                    {t('orders.actions.startPrep')}
                  </Button>
                )}
                {selectedDrawerOrder.status === 'KITCHEN_PREPARING' && (
                  <Button
                    color="success"
                    variant="contained"
                    startIcon={<CheckCircleIcon />}
                    onClick={async () => {
                      await handleUpdateStatus(selectedDrawerOrder.id, 'READY');
                      handleOpenOrderDrawer({ ...selectedDrawerOrder, status: 'READY' });
                    }}
                  >
                    {t('orders.actions.markReady')}
                  </Button>
                )}
                {selectedDrawerOrder.status === 'READY' && (
                  <Button
                    color="primary"
                    variant="contained"
                    startIcon={<DoneAllIcon />}
                    onClick={async () => {
                      await handleUpdateStatus(selectedDrawerOrder.id, 'COMPLETED');
                      handleOpenOrderDrawer({ ...selectedDrawerOrder, status: 'COMPLETED' });
                    }}
                  >
                    {t('orders.actions.completeOrder')}
                  </Button>
                )}
                {selectedDrawerOrder.status !== 'COMPLETED' && selectedDrawerOrder.status !== 'CANCELLED' && (
                  <Button
                    color="error"
                    variant="outlined"
                    startIcon={<CancelIcon />}
                    onClick={() => {
                      setDrawerOpen(false);
                      handleOpenCancelDialog(selectedDrawerOrder);
                    }}
                  >
                    {t('orders.actions.cancelOrder')}
                  </Button>
                )}
              </Stack>
            </Box>
          </Box>
        )}
      </Drawer>

      {/* JSON Snapshot Inspection Modal */}
      <Dialog
        open={Boolean(inspectingJson)}
        onClose={() => setInspectingJson(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
          <CodeIcon color="primary" />
          {t('orders.drawer.inspectTitle', { action: inspectingJson?.action })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {t('orders.drawer.timestamp')} {inspectingJson && new Date(inspectingJson.occurred_at).toLocaleString()} • {t('orders.drawer.actor')} {inspectingJson?.actor_type}
          </Typography>
          <Box
            component="pre"
            sx={{
              p: 2,
              borderRadius: 1.5,
              bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
              fontFamily: 'monospace',
              fontSize: 12,
              overflowX: 'auto',
              maxHeight: 400,
            }}
          >
            {JSON.stringify(
              {
                action: inspectingJson?.action,
                actor_type: inspectingJson?.actor_type,
                correlation_id: inspectingJson?.correlation_id,
                before_data: inspectingJson?.before_data,
                after_data: inspectingJson?.after_data,
                details: inspectingJson?.details,
              },
              null,
              2
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspectingJson(null)}>{t('orders.drawer.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
