import type { Customer } from 'src/api/customerApi';
import type { ReceiptData } from 'src/api/paymentApi';
import type { ReasonCode } from 'src/api/settingsApi';
import type { OrderHeader, DeclineReason } from 'src/api/orderApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import CodeIcon from '@mui/icons-material/Code';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import PrintIcon from '@mui/icons-material/Print';
import CancelIcon from '@mui/icons-material/Cancel';
import PersonIcon from '@mui/icons-material/Person';
import SearchIcon from '@mui/icons-material/Search';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import ReceiptIcon from '@mui/icons-material/Receipt';
import RefreshIcon from '@mui/icons-material/Refresh';
import HistoryIcon from '@mui/icons-material/History';
import PaymentIcon from '@mui/icons-material/Payment';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SecurityIcon from '@mui/icons-material/Security';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import VisibilityIcon from '@mui/icons-material/Visibility';
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
import { fTime, fDateTime } from 'src/utils/format-time';
import {
  promisedBy,
  isSnappfoodOrder,
  reportMinutesLeft,
  SNAPPFOOD_DELAY_REASON_ID,
} from 'src/utils/snappfood-order';

import { kdsApi } from 'src/api/kdsApi';
import { orderApi } from 'src/api/orderApi';
import { paymentApi } from 'src/api/paymentApi';
import { customerApi } from 'src/api/customerApi';
import { settingsApi } from 'src/api/settingsApi';
import { httpClient as axios } from 'src/api/httpClient';
import { useBranchContext, useScopedBranchId } from 'src/contexts/branch-context';

import { CheckoutModal } from 'src/components/CheckoutModal';
import { ApprovalModal } from 'src/components/approval/ApprovalModal';
import { OrderEditDialog } from 'src/components/orders/OrderEditDialog';

// An order is waiting, open, completed or cancelled. How far the kitchen or the courier has
// got is shown beside that rather than as a stage of its own: most branches print tickets and
// have no screen that would ever move an order to "preparing" or "ready".
const OPEN_STATUSES = ['SUBMITTED', 'CONFIRMED', 'PREPARING', 'KITCHEN_PREPARING', 'READY', 'OUT_FOR_DELIVERY'];

type Lifecycle = 'WAITING' | 'OPEN' | 'COMPLETED' | 'CANCELLED' | 'OTHER';

const lifecycleOf = (status: string): Lifecycle => {
  if (status === 'PENDING_ACCEPTANCE') return 'WAITING';
  if (OPEN_STATUSES.includes(status)) return 'OPEN';
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'CANCELLED' || status === 'REJECTED') return 'CANCELLED';
  return 'OTHER';
};

/** The `orders.progress` key for an open order's kitchen or delivery progress. */
const progressKeyOf = (status: string): string | null => {
  switch (status) {
    case 'SUBMITTED':
    case 'CONFIRMED':
      return 'sentToKitchen';
    case 'PREPARING':
    case 'KITCHEN_PREPARING':
      return 'preparing';
    case 'READY':
      return 'ready';
    case 'OUT_FOR_DELIVERY':
      return 'outForDelivery';
    default:
      return null;
  }
};

export function OrdersWorkflowPage() {
  const { t } = useTranslation();
  const [branchId] = useScopedBranchId();
  const { branches, isHeadOffice } = useBranchContext();
  // Head office looks orders up — a complaint, a courier dispute, a Snappfood query — but the
  // order is the branch's to move, take payment on, print or cancel. So here it is a list to
  // read: details and receipts, and none of the buttons that change an order.
  const readOnly = isHeadOffice;
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));
  // Only head office ever sees more than one, and only there does the column mean anything.
  const showBranchColumn = !branchId && branches.length > 1;

  const [orders, setOrders] = useState<OrderHeader[]>([]);
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);
  const [customersMap, setCustomersMap] = useState<Map<string, Customer>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

  // Pay Existing Order (Checkout) State
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payOrderId, setPayOrderId] = useState<string | null>(null);

  // Prototype reprint workflow
  const [reprintDialogOpen, setReprintDialogOpen] = useState(false);
  const [reprintDocumentType, setReprintDocumentType] = useState<'CUSTOMER_RECEIPT' | 'KITCHEN_TICKET'>('CUSTOMER_RECEIPT');
  const [reprintReason, setReprintReason] = useState('');
  const [reprintError, setReprintError] = useState<string | null>(null);
  const [reprintSubmitting, setReprintSubmitting] = useState(false);

  // Order Details & Audit Drawer State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [cancelApprovalOpen, setCancelApprovalOpen] = useState(false);
  // Why the server escalated, so the approver reads the actual reason rather
  // than the one that used to be the only possibility.
  const [cancelEscalation, setCancelEscalation] = useState<string>('');
  const [selectedDrawerOrder, setSelectedDrawerOrder] = useState<any | null>(null);
  const [orderAuditLogs, setOrderAuditLogs] = useState<any[]>([]);
  const [loadingDrawerDetails, setLoadingDrawerDetails] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'details' | 'audit'>('details');
  const [inspectingJson, setInspectingJson] = useState<any>(null);

  // Report an accepted Snappfood order to Snappfood support: more time, or it cannot be made.
  const [reportOrder, setReportOrder] = useState<OrderHeader | null>(null);
  const [declineReasons, setDeclineReasons] = useState<DeclineReason[]>([]);
  const [reportReasonId, setReportReasonId] = useState<number>(SNAPPFOOD_DELAY_REASON_ID);
  const [reportExtraMinutes, setReportExtraMinutes] = useState(15);
  const [reportComment, setReportComment] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);

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
      case 'DRAFT':
        return t('orders.statuses.draft');
      case 'REJECTED':
        return t('orders.statuses.rejected');
      case 'REFUNDED':
        return t('orders.statuses.refunded');
      default:
        break;
    }
    switch (lifecycleOf(status)) {
      case 'WAITING':
        return t('orders.statuses.pendingAcceptance');
      case 'OPEN':
        return t('orders.statuses.open');
      case 'COMPLETED':
        return t('orders.statuses.completed');
      case 'CANCELLED':
        return t('orders.statuses.cancelled');
      default:
        return status;
    }
  };

  const renderProgressChip = (status: string) => {
    const key = progressKeyOf(status);
    return key ? <Chip label={t(`orders.progress.${key}`)} size="small" variant="outlined" /> : null;
  };

  // An open Snappfood order shows the time the store promised, or that Snappfood support has it.
  const renderSnappfoodChips = (order: OrderHeader) => {
    if (!isSnappfoodOrder(order) || lifecycleOf(order.status) !== 'OPEN') return null;
    if (order.aggregator_issue_at) {
      return <Chip color="warning" label={t('orders.snappfood.withSupport')} size="small" />;
    }
    const by = promisedBy(order);
    return by ? (
      <Chip
        label={t('orders.snappfood.promisedBy', {
          time: fTime(by),
        })}
        size="small"
        variant="outlined"
      />
    ) : null;
  };

  // Completing closes the check, so nothing may be left to pay. Delivery orders are finished
  // on the delivery screen, where the courier's cash is counted in.
  const canComplete = (order: OrderHeader) =>
    !readOnly &&
    lifecycleOf(order.status) === 'OPEN' &&
    order.order_type !== 'DELIVERY' &&
    order.status !== 'OUT_FOR_DELIVERY' &&
    !MoneyUtil.greaterThan(order.due_amount || '0', '0');

  // A waiting order is answered on Incoming Orders, and a finished one is refunded, not cancelled.
  // Only Snappfood cancels one of its orders; the store reports a problem to Snappfood instead.
  const canCancel = (order: OrderHeader) =>
    !readOnly && !isSnappfoodOrder(order) && (lifecycleOf(order.status) === 'OPEN' || order.status === 'DRAFT');

  // Snappfood collects for its orders, so the till never takes money for one.
  const canPay = (order: OrderHeader) =>
    !readOnly && !isSnappfoodOrder(order) && order.status !== 'CANCELLED' && MoneyUtil.greaterThan(order.due_amount, '0');

  const canReport = (order: OrderHeader) => !readOnly && reportMinutesLeft(order, Date.now()) > 0;

  const handleOpenReport = (order: OrderHeader) => {
    setReportOrder(order);
    setReportReasonId(SNAPPFOOD_DELAY_REASON_ID);
    setReportExtraMinutes(15);
    setReportComment('');
    setReportError(null);
    if (declineReasons.length === 0) {
      orderApi.getDeclineReasons().then(setDeclineReasons).catch(() => setDeclineReasons([]));
    }
  };

  const handleSendReport = async () => {
    if (!reportOrder) return;
    try {
      setReportSubmitting(true);
      setReportError(null);
      const reported = await orderApi.reportToSnappfood(reportOrder.id, {
        reasonId: reportReasonId,
        extraMinutes: reportReasonId === SNAPPFOOD_DELAY_REASON_ID ? reportExtraMinutes : undefined,
        comment: reportComment.trim(),
      });
      setSuccess(t('orders.snappfood.reported', { orderNumber: reportOrder.order_number }));
      setReportOrder(null);
      loadData();
      if (drawerOpen && selectedDrawerOrder?.id === reported.id) {
        handleOpenOrderDrawer(reported);
      }
    } catch (err: any) {
      setReportError(err?.detail || err?.message || t('orders.snappfood.reportFailed'));
    } finally {
      setReportSubmitting(false);
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
        // Unfiltered, this listed the whole chain: a cashier at one shop could open
        // another shop's order and had nothing on screen to tell them whose it was.
        orderApi.getOrders(branchId || undefined),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

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
      return true;
    } catch (err: any) {
      setError(err.detail || t('orders.errors.updateStatusFailed'));
      return false;
    }
  };

  const handleOpenPayment = (order: OrderHeader) => {
    setPayOrderId(order.id);
    setPayModalOpen(true);
  };

  const handleOpenCancelDialog = (order: OrderHeader) => {
    setSelectedOrder(order);
    setReasonCodeId('');
    setCancelDialogOpen(true);
  };

  const handleConfirmCancel = async (approvalRequestId?: string) => {
    if (!selectedOrder || !reasonCodeId) {
      setError(t('orders.cancelDialog.reasonRequired'));
      return;
    }
    try {
      await orderApi.cancelOrder(selectedOrder.id, reasonCodeId, undefined, approvalRequestId);
      setCancelDialogOpen(false);
      setSelectedOrder(null);
      loadData();
    } catch (err: any) {
      // Past the cancel window, once preparation has started, or against money
      // already collected, the server demands a manager. Collect one and retry
      // the same cancellation.
      if (err?.code === 'APPROVAL_REQUIRED') {
        const escalation: string = err?.escalations?.[0] || '';
        setCancelEscalation(escalation.split(':')[1] || '');
        setCancelApprovalOpen(true);
        return;
      }
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

  const handleOpenReprintDialog = (order: OrderHeader) => {
    setSelectedOrder(order);
    setReprintDocumentType('CUSTOMER_RECEIPT');
    setReprintReason('');
    setReprintError(null);
    setReprintDialogOpen(true);
  };

  const handleCloseReprintDialog = () => {
    if (reprintSubmitting) return;
    setReprintDialogOpen(false);
    setReprintError(null);
  };

  const handleConfirmReprint = async () => {
    const reason = reprintReason.trim();
    if (!selectedOrder || !reason) {
      setReprintError(t('orders.reprintDialog.reasonRequired'));
      return;
    }

    try {
      setReprintSubmitting(true);
      setReprintError(null);
      // One job per printer: a kitchen ticket comes back as a job for each station.
      const printJobs = await kdsApi.reprintOrder(selectedOrder.id, reprintDocumentType, reason);
      if (!Array.isArray(printJobs) || printJobs.length === 0) {
        throw new Error(t('orders.reprintDialog.failed'));
      }

      const documentLabel = reprintDocumentType === 'KITCHEN_TICKET'
        ? t('orders.reprintDialog.kitchenTicket')
        : t('orders.reprintDialog.customerReceipt');
      setSuccess(t('orders.reprintDialog.success', {
        document: documentLabel,
        orderNumber: selectedOrder.order_number,
      }));
      setReprintDialogOpen(false);
      setSelectedOrder(null);
    } catch (err: any) {
      setReprintError(err.detail || err.message || t('orders.reprintDialog.failed'));
    } finally {
      setReprintSubmitting(false);
    }
  };

  const getStatusChipColor = (status: string) => {
    if (status === 'REFUNDED') return 'secondary';
    switch (lifecycleOf(status)) {
      case 'WAITING': return 'warning';
      case 'OPEN': return 'info';
      case 'CANCELLED': return 'error';
      default: return 'default';
    }
  };

  // Filtered orders list
  const filteredOrders = orders.filter((o) => {
    const matchesStatus = statusFilter === 'ALL' || lifecycleOf(o.status) === statusFilter;
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

  const getOrdersByLifecycle = (lifecycle: string) =>
    orders.filter((o) => lifecycleOf(o.status) === lifecycle);

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

      {success && (
        <Alert onClose={() => setSuccess(null)} severity="success" sx={{ mb: 3 }}>
          {success}
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
              <Tab label={t('orders.tabs.waiting', { count: getOrdersByLifecycle('WAITING').length })} value="WAITING" />
              <Tab label={t('orders.tabs.open', { count: getOrdersByLifecycle('OPEN').length })} value="OPEN" />
              <Tab label={t('orders.tabs.completed', { count: getOrdersByLifecycle('COMPLETED').length })} value="COMPLETED" />
              <Tab label={t('orders.tabs.cancelled', { count: getOrdersByLifecycle('CANCELLED').length })} value="CANCELLED" />
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
                  {showBranchColumn && (
                    <TableCell sx={{ fontWeight: 700 }}>{t('orders.table.branch', 'Branch')}</TableCell>
                  )}
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
                    <TableCell align="center" colSpan={showBranchColumn ? 11 : 10} sx={{ py: 6 }}>
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
                        {showBranchColumn && (
                          <TableCell>
                            <Typography variant="body2">
                              {branchNameById.get(order.branch_id) || order.branch_id}
                            </Typography>
                          </TableCell>
                        )}
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
                          {/* Money given back outranks money taken: an order whose
                              tender was reversed must not keep reading as settled. */}
                          {MoneyUtil.greaterThan(order.refunded_total || '0', '0') ? (
                            <Typography color="warning.main" sx={{ fontWeight: 700 }} variant="caption">
                              <span dir="ltr">
                                {t('orders.table.refunded', {
                                  amount: MoneyUtil.formatCurrency(order.refunded_total || '0'),
                                })}{' '}
                                IRR
                              </span>
                            </Typography>
                          ) : MoneyUtil.greaterThan(order.due_amount, '0') ? (
                            <Typography color="error.main" sx={{ fontWeight: 700 }} variant="caption">
                              <span dir="ltr">{t('orders.table.due', { amount: MoneyUtil.formatCurrency(order.due_amount) })} IRR</span>
                            </Typography>
                          ) : (
                            <Chip color="success" label={t('orders.table.fullyPaid')} size="small" sx={{ fontSize: 9, height: 18 }} />
                          )}
                        </TableCell>
                        <TableCell align="center">
                          <Typography variant="caption">
                            {fTime(order.placed_at)}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Stack spacing={0.5} sx={{ alignItems: 'center' }}>
                            <Chip
                              color={getStatusChipColor(order.status) as any}
                              label={getOrderStatusLabel(order.status)}
                              size="small"
                              sx={{ fontWeight: 700 }}
                            />
                            {renderProgressChip(order.status)}
                            {renderSnappfoodChips(order)}
                          </Stack>
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

                            {!readOnly && (
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenReprintDialog(order);
                                }}
                                size="small"
                                startIcon={<PrintIcon />}
                                variant="outlined"
                              >
                                {t('orders.actions.reprint')}
                              </Button>
                            )}

                            {canPay(order) && (
                              <Button
                                color="success"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenPayment(order);
                                }}
                                size="small"
                                startIcon={<PaymentIcon />}
                                variant="contained"
                              >
                                {t('orders.actions.pay')}
                              </Button>
                            )}

                            {canComplete(order) && (
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

                            {canReport(order) && (
                              <Button
                                color="warning"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenReport(order);
                                }}
                                size="small"
                                startIcon={<ScheduleIcon />}
                                variant="outlined"
                              >
                                {t('orders.actions.reportToSnappfood')}
                              </Button>
                            )}

                            {canCancel(order) && (
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
            { color: 'warning.main', key: 'WAITING', title: t('orders.kanban.waiting') },
            { color: 'info.main', key: 'OPEN', title: t('orders.kanban.open') },
            { color: 'text.secondary', key: 'COMPLETED', title: t('orders.kanban.completed') },
          ].map((col) => (
            <Grid key={col.key} size={{ md: 4, xs: 12 }}>
              <Card sx={{ bgcolor: 'background.neutral', borderRadius: 3, boxShadow: 2, minHeight: 600 }}>
                <CardContent sx={{ p: 2 }}>
                  <Typography sx={{ color: col.color, fontWeight: 'bold', mb: 2 }} variant="subtitle1">
                    {col.title} ({getOrdersByLifecycle(col.key).length})
                  </Typography>

                  <Stack spacing={2}>
                    {getOrdersByLifecycle(col.key).map((order) => {
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
                            <Stack direction="row" spacing={0.5}>
                              {renderProgressChip(order.status)}
                              <Chip label={getOrderTypeLabel(order.order_type)} size="small" variant="outlined" />
                            </Stack>
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
                            {t('orders.kanban.placed', { time: fTime(order.placed_at) })}
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

                            {!readOnly && (
                              <Button
                                color="inherit"
                                fullWidth
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenReprintDialog(order);
                                }}
                                size="small"
                                startIcon={<PrintIcon />}
                                variant="outlined"
                              >
                                {t('orders.actions.reprint')}
                              </Button>
                            )}

                            {canPay(order) && (
                              <Button
                                color="success"
                                fullWidth
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenPayment(order);
                                }}
                                size="small"
                                startIcon={<PaymentIcon />}
                                sx={{ fontWeight: 'bold' }}
                                variant="contained"
                              >
                                {t('orders.actions.pay')}
                              </Button>
                            )}

                            {canComplete(order) && (
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

                            {canCancel(order) && (
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
          <Button color="error" onClick={() => handleConfirmCancel()} sx={{ fontWeight: 'bold' }} variant="contained">
            {t('orders.cancelDialog.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Report an accepted Snappfood order to Snappfood support */}
      <Dialog fullWidth maxWidth="xs" onClose={() => !reportSubmitting && setReportOrder(null)} open={!!reportOrder}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 'bold' }}>
          <ScheduleIcon color="warning" />
          {t('orders.snappfood.reportTitle', { orderNumber: reportOrder?.order_number })}
        </DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 2 }} variant="body2">
            {t('orders.snappfood.reportDescription', {
              count: reportOrder ? reportMinutesLeft(reportOrder, Date.now()) : 0,
            })}
          </Typography>

          <Stack spacing={2}>
            <FormControl fullWidth>
              <InputLabel>{t('orders.snappfood.reason')}</InputLabel>
              <Select
                label={t('orders.snappfood.reason')}
                onChange={(e) => setReportReasonId(Number(e.target.value))}
                value={declineReasons.length ? reportReasonId : ''}
              >
                {declineReasons.map((reason) => (
                  <MenuItem key={reason.id} value={reason.id}>
                    {reason.title}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {reportReasonId === SNAPPFOOD_DELAY_REASON_ID && (
              <TextField
                fullWidth
                label={t('orders.snappfood.extraMinutes')}
                onChange={(e) => setReportExtraMinutes(Math.min(120, Math.max(1, Math.round(Number(e.target.value) || 0))))}
                slotProps={{ htmlInput: { min: 1, max: 120 } }}
                type="number"
                value={reportExtraMinutes}
              />
            )}

            <TextField
              fullWidth
              label={t('orders.snappfood.comment')}
              onChange={(e) => setReportComment(e.target.value)}
              value={reportComment}
            />

            {reportError && <Alert severity="error">{reportError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={reportSubmitting} onClick={() => setReportOrder(null)}>
            {t('orders.snappfood.close')}
          </Button>
          <Button
            color="warning"
            disabled={reportSubmitting || declineReasons.length === 0}
            onClick={handleSendReport}
            startIcon={reportSubmitting ? <CircularProgress size={16} /> : <ScheduleIcon />}
            variant="contained"
          >
            {t('orders.snappfood.send')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Customer / kitchen reprint dialog */}
      <Dialog fullWidth maxWidth="xs" onClose={handleCloseReprintDialog} open={reprintDialogOpen}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 'bold' }}>
          <PrintIcon color="primary" />
          {t('orders.reprintDialog.title', { orderNumber: selectedOrder?.order_number })}
        </DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 2 }} variant="body2">
            {t('orders.reprintDialog.description')}
          </Typography>

          <Stack spacing={2}>
            <FormControl fullWidth>
              <InputLabel>{t('orders.reprintDialog.documentType')}</InputLabel>
              <Select
                label={t('orders.reprintDialog.documentType')}
                onChange={(e) => setReprintDocumentType(e.target.value as 'CUSTOMER_RECEIPT' | 'KITCHEN_TICKET')}
                value={reprintDocumentType}
              >
                <MenuItem value="CUSTOMER_RECEIPT">
                  {t('orders.reprintDialog.customerReceipt')}
                </MenuItem>
                <MenuItem value="KITCHEN_TICKET">
                  {t('orders.reprintDialog.kitchenTicket')}
                </MenuItem>
              </Select>
            </FormControl>

            <TextField
              autoFocus
              fullWidth
              label={t('orders.reprintDialog.reason')}
              minRows={2}
              multiline
              onChange={(e) => setReprintReason(e.target.value)}
              placeholder={t('orders.reprintDialog.reasonPlaceholder')}
              value={reprintReason}
            />

            {reprintError && <Alert severity="error">{reprintError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={reprintSubmitting} onClick={handleCloseReprintDialog}>
            {t('orders.reprintDialog.cancel')}
          </Button>
          <Button
            disabled={reprintSubmitting || !reprintReason.trim()}
            onClick={handleConfirmReprint}
            startIcon={reprintSubmitting ? <CircularProgress size={16} /> : <PrintIcon />}
            variant="contained"
          >
            {t('orders.reprintDialog.confirm')}
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
                {fDateTime(receiptData.receipt_header.placed_at)}
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
                  {renderProgressChip(selectedDrawerOrder.status)}
                  {renderSnappfoodChips(selectedDrawerOrder)}
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
                {t('orders.drawer.placedOn', { date: selectedDrawerOrder.placed_at ? fDateTime(selectedDrawerOrder.placed_at) : t('orders.drawer.justNow') })}
                {selectedDrawerOrder.table_number && ` • ${t('orders.drawer.table', { number: selectedDrawerOrder.table_number })}`}
                {selectedDrawerOrder.notes && ` • ${t('orders.drawer.note', { note: selectedDrawerOrder.notes })}`}
              </Typography>
              {selectedDrawerOrder.aggregator_issue && (
                <Typography variant="caption" color="warning.main" sx={{ display: 'block', fontWeight: 600 }}>
                  {t('orders.snappfood.issue', { issue: selectedDrawerOrder.aggregator_issue })}
                </Typography>
              )}

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
                              {evt.occurred_at ? fTime(evt.occurred_at) : t('orders.drawer.justNow')}
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
                              {fDateTime(log.occurred_at)}
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
                {!readOnly && (
                  <Button
                    startIcon={<PrintIcon />}
                    variant="outlined"
                    onClick={() => handleOpenReprintDialog(selectedDrawerOrder)}
                  >
                    {t('orders.actions.reprint')}
                  </Button>
                )}
                {canPay(selectedDrawerOrder) && (
                  <Button
                    color="success"
                    variant="contained"
                    startIcon={<PaymentIcon />}
                    onClick={() => {
                      setDrawerOpen(false);
                      handleOpenPayment(selectedDrawerOrder);
                    }}
                  >
                    {t('orders.actions.pay')}
                  </Button>
                )}
                {canComplete(selectedDrawerOrder) && (
                  <Button
                    color="primary"
                    variant="contained"
                    startIcon={<DoneAllIcon />}
                    onClick={async () => {
                      if (await handleUpdateStatus(selectedDrawerOrder.id, 'COMPLETED')) {
                        handleOpenOrderDrawer({ ...selectedDrawerOrder, status: 'COMPLETED' });
                      }
                    }}
                  >
                    {t('orders.actions.completeOrder')}
                  </Button>
                )}
                {/* Snappfood's lines are Snappfood's: it has no call for a store to change them. */}
                {!readOnly &&
                  !isSnappfoodOrder(selectedDrawerOrder) &&
                  !['COMPLETED', 'CANCELLED', 'OUT_FOR_DELIVERY'].includes(selectedDrawerOrder.status) && (
                  <Button
                    color="inherit"
                    variant="outlined"
                    startIcon={<EditIcon />}
                    onClick={() => setEditDialogOpen(true)}
                  >
                    {t('orders.actions.editOrder', 'Edit lines')}
                  </Button>
                )}
                {canReport(selectedDrawerOrder) && (
                  <Button
                    color="warning"
                    variant="outlined"
                    startIcon={<ScheduleIcon />}
                    onClick={() => handleOpenReport(selectedDrawerOrder)}
                  >
                    {t('orders.actions.reportToSnappfood')}
                  </Button>
                )}
                {canCancel(selectedDrawerOrder) && (
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

      <OrderEditDialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        order={selectedDrawerOrder}
        reasonCodes={reasonCodes}
        onSaved={async () => {
          await loadData();
          if (selectedDrawerOrder) await handleOpenOrderDrawer(selectedDrawerOrder);
        }}
      />

      <ApprovalModal
        open={cancelApprovalOpen}
        onClose={() => setCancelApprovalOpen(false)}
        onSuccess={(_pin, requestId) => {
          setCancelApprovalOpen(false);
          handleConfirmCancel(requestId);
        }}
        actionName="CANCEL_ORDER"
        entityType="ORDER"
        entityId={selectedOrder?.id}
        detailsText={
          cancelEscalation === 'CANCEL_AGAINST_PAID_ORDER'
            ? t('orders.cancelDialog.approvalDetailsPaid')
            : t('orders.cancelDialog.approvalDetails', 'Cancellation outside the cashier window')
        }
        createRequest
      />

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
            {t('orders.drawer.timestamp')} {inspectingJson && fDateTime(inspectingJson.occurred_at)} • {t('orders.drawer.actor')} {inspectingJson?.actor_type}
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

      <CheckoutModal
        open={payModalOpen}
        orderId={payOrderId}
        onClose={() => setPayModalOpen(false)}
        onPaymentComplete={() => {
          setPayModalOpen(false);
          loadData();
        }}
      />
    </Box>
  );
}
