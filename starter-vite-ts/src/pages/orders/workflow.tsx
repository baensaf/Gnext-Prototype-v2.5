import type { GridColDef, GridSortModel } from '@mui/x-data-grid';
import type { RefundRecord } from 'src/api/refundApi';
import type { ReasonCode } from 'src/api/settingsApi';
import type { ReceiptData, PaymentRecord } from 'src/api/paymentApi';
import type { OrderHeader, OrderListRow, DeclineReason, OrderLifecycle, OrderListQuery } from 'src/api/orderApi';

import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';

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
import DownloadIcon from '@mui/icons-material/Download';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SecurityIcon from '@mui/icons-material/Security';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import {
  Box,
  Tab,
  Card,
  Chip,
  Grid,
  Tabs,
  Menu,
  Stack,
  Alert,
  Paper,
  Table,
  Button,
  Dialog,
  Select,
  Drawer,
  Divider,
  Tooltip,
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
  ListItemIcon,
  ListItemText,
  DialogContent,
  DialogActions,
  TableContainer,
  InputAdornment,
  CircularProgress,
} from '@mui/material';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { MoneyUtil } from 'src/utils/money.util';
import { fTime, fDateTime } from 'src/utils/format-time';
import { useLiveRefresh } from 'src/utils/use-live-refresh';
import {
  businessDate,
  businessToday,
  formatCalendarTime,
  formatCalendarDateTime,
} from 'src/utils/calendar';
import {
  promisedBy,
  isSnappfoodOrder,
  reportMinutesLeft,
  SNAPPFOOD_DELAY_REASON_ID,
} from 'src/utils/snappfood-order';

import { kdsApi } from 'src/api/kdsApi';
import { orderApi } from 'src/api/orderApi';
import { refundApi } from 'src/api/refundApi';
import { paymentApi } from 'src/api/paymentApi';
import { settingsApi } from 'src/api/settingsApi';
import { httpClient as axios } from 'src/api/httpClient';
import { useBranchContext, useScopedBranchId } from 'src/contexts/branch-context';

import { CheckoutModal } from 'src/components/CheckoutModal';
import { ServerDataGrid } from 'src/components/server-data-grid';
import { ApprovalModal } from 'src/components/approval/ApprovalModal';
import { OrderEditDialog } from 'src/components/orders/OrderEditDialog';
import { CalendarDateField } from 'src/components/calendar-date-field/calendar-date-field';

// An order is waiting, open, held, completed, refunded or cancelled. How far the kitchen or
// the courier has got is shown beside that rather than as a stage of its own: most branches
// print tickets and have no screen that would ever move an order to "preparing" or "ready".
// The server files every order under one of these (see `order-list.ts`), so the tab counts
// add up to All.
const OPEN_STATUSES = ['SUBMITTED', 'CONFIRMED', 'PREPARING', 'KITCHEN_PREPARING', 'READY', 'OUT_FOR_DELIVERY'];

type Lifecycle = OrderLifecycle;
type TabKey = Lifecycle | 'ALL';
type RangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'all' | 'custom';

type ReprintDocumentType = 'CUSTOMER_RECEIPT' | 'KITCHEN_TICKET' | 'GUEST_BILL' | 'COURIER_SLIP';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'OPEN', label: 'open' },
  { key: 'WAITING', label: 'waiting' },
  { key: 'HELD', label: 'held' },
  { key: 'COMPLETED', label: 'completed' },
  { key: 'REFUNDED', label: 'refunded' },
  { key: 'CANCELLED', label: 'cancelled' },
  { key: 'ALL', label: 'all' },
];

const RANGES: RangeKey[] = ['today', 'yesterday', '7d', '30d', 'all', 'custom'];
const ORDER_TYPES = ['DINE_IN', 'TAKEAWAY', 'PICKUP', 'DELIVERY', 'AGGREGATOR'];
const CHANNELS = ['POS', 'KIOSK', 'ONLINE', 'AGGREGATOR'];
const PAGE_SIZES = [25, 50, 100];
const SORTABLE = ['placed_at', 'grand_total', 'outstanding_total', 'order_number'] as const;

// Defaults are left out of the address bar, so a plain /app/orders is today's open orders.
const DEFAULTS = { tab: 'OPEN', range: 'today', page: '0', size: '25', sort: 'placed_at', dir: 'desc' };

const lifecycleOf = (order: { status: string; refunded_total?: string | null }): Lifecycle => {
  const { status } = order;
  if (status === 'PENDING_ACCEPTANCE') return 'WAITING';
  if (OPEN_STATUSES.includes(status)) return 'OPEN';
  if (status === 'DRAFT') return 'HELD';
  if (status === 'REFUNDED' || (status === 'COMPLETED' && MoneyUtil.greaterThan(order.refunded_total || '0', '0'))) {
    return 'REFUNDED';
  }
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

/** The `delivery.states` key for a delivery's state. */
const deliveryStateKeyOf = (state: string | null | undefined): string | null => {
  switch (state) {
    case 'PENDING':
    case 'UNASSIGNED':
      return 'unassigned';
    case 'ASSIGNED':
      return 'assigned';
    case 'PICKED_UP':
      return 'pickedUp';
    case 'EN_ROUTE':
      return 'enRoute';
    case 'DELIVERED':
      return 'delivered';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return null;
  }
};

/** A business day (YYYY-MM-DD) moved by `days`, on the restaurants' clock. */
const shiftDay = (day: string, days: number) =>
  businessDate(new Date(new Date(`${day}T12:00:00+03:30`).getTime() + days * 86_400_000));

/** Midnight at the start of a business day in Tehran, which keeps no daylight saving. */
const startOfDay = (day: string) => `${day}T00:00:00+03:30`;

/** The placed-at window a date choice stands for; `to` is exclusive. */
const rangeBounds = (range: RangeKey, from: string, to: string): { from?: string; to?: string } => {
  const today = businessToday();
  switch (range) {
    case 'today':
      return { from: startOfDay(today), to: startOfDay(shiftDay(today, 1)) };
    case 'yesterday':
      return { from: startOfDay(shiftDay(today, -1)), to: startOfDay(today) };
    case '7d':
      return { from: startOfDay(shiftDay(today, -6)), to: startOfDay(shiftDay(today, 1)) };
    case '30d':
      return { from: startOfDay(shiftDay(today, -29)), to: startOfDay(shiftDay(today, 1)) };
    case 'custom':
      return {
        from: from ? startOfDay(from) : undefined,
        to: to ? startOfDay(shiftDay(to, 1)) : undefined,
      };
    default:
      return {};
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

  // Every filter lives in the address bar, so a reload, the back button or a shared link
  // brings back the same list, and ?order= reopens the same order.
  const [searchParams, setSearchParams] = useSearchParams();
  const param = (key: keyof typeof DEFAULTS | string, fallback = '') =>
    searchParams.get(key) || (DEFAULTS as Record<string, string>)[key] || fallback;
  const tab = param('tab') as TabKey;
  const range = (RANGES.includes(param('range') as RangeKey) ? param('range') : 'today') as RangeKey;
  const customFrom = param('from');
  const customTo = param('to');
  const typeFilter = param('type');
  const channelFilter = param('channel');
  const query = param('q');
  const page = Math.max(0, Number(param('page', '0')) || 0);
  const pageSize = PAGE_SIZES.includes(Number(param('size'))) ? Number(param('size')) : 25;
  const sortField = (SORTABLE as readonly string[]).includes(param('sort')) ? (param('sort') as OrderListQuery['sort']) : 'placed_at';
  const sortDir: 'asc' | 'desc' = param('dir') === 'asc' ? 'asc' : 'desc';
  const drawerOrderId = searchParams.get('order');

  const setParams = useCallback(
    (changes: Record<string, string | number | null>, keepPage = false) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, raw] of Object.entries(changes)) {
            const value = raw === null ? '' : String(raw);
            if (!value || (DEFAULTS as Record<string, string>)[key] === value) next.delete(key);
            else next.set(key, value);
          }
          // A different filter starts from the first page.
          if (!keepPage && !('page' in changes)) next.delete('page');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const [rows, setRows] = useState<OrderListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Partial<Record<TabKey, number>>>({});
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [searchText, setSearchText] = useState(query);
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // The row's "more" menu
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuOrder, setMenuOrder] = useState<OrderListRow | null>(null);

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
  const [reprintDocumentType, setReprintDocumentType] = useState<ReprintDocumentType>('CUSTOMER_RECEIPT');
  // Which station's chit to print again: '' is every station, as the order first printed.
  const [reprintStationId, setReprintStationId] = useState('');
  const [reprintStations, setReprintStations] = useState<Array<{ id: string; name: string }>>([]);
  const [reprintReason, setReprintReason] = useState('');
  const [reprintError, setReprintError] = useState<string | null>(null);
  const [reprintSubmitting, setReprintSubmitting] = useState(false);

  // Order Details & Audit Drawer State
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  // Converting an order to a different kind
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [typeOrder, setTypeOrder] = useState<OrderHeader | null>(null);
  const [typeTarget, setTypeTarget] = useState<'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'>('TAKEAWAY');
  const [typeAddressId, setTypeAddressId] = useState('');
  const [typeZoneId, setTypeZoneId] = useState('');
  const [typeTableId, setTypeTableId] = useState('');
  const [typeReason, setTypeReason] = useState('');
  const [typeError, setTypeError] = useState<string | null>(null);
  const [typeSubmitting, setTypeSubmitting] = useState(false);
  const [typeApprovalOpen, setTypeApprovalOpen] = useState(false);
  const [typeEscalation, setTypeEscalation] = useState('');
  const [cancelApprovalOpen, setCancelApprovalOpen] = useState(false);
  // Why the server escalated, so the approver reads the actual reason rather
  // than the one that used to be the only possibility.
  const [cancelEscalation, setCancelEscalation] = useState<string>('');
  const [selectedDrawerOrder, setSelectedDrawerOrder] = useState<any | null>(null);
  const [orderAuditLogs, setOrderAuditLogs] = useState<any[]>([]);
  const [orderPayments, setOrderPayments] = useState<PaymentRecord[]>([]);
  const [orderRefunds, setOrderRefunds] = useState<RefundRecord[]>([]);
  const [loadingDrawerDetails, setLoadingDrawerDetails] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'details' | 'payments' | 'audit'>('details');
  const [inspectingJson, setInspectingJson] = useState<any>(null);
  const drawerOpen = !!drawerOrderId;

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
      case 'PICKUP':
        return t('orders.types.pickup');
      case 'DELIVERY':
        return t('orders.types.delivery');
      case 'AGGREGATOR':
        return t('orders.types.aggregator');
      default:
        return orderType;
    }
  };

  const getOrderTypeColor = (orderType: string) => {
    switch (orderType) {
      case 'DINE_IN':
        return 'primary';
      case 'DELIVERY':
        return 'info';
      case 'AGGREGATOR':
        return 'warning';
      default:
        return 'secondary';
    }
  };

  const getChannelLabel = (channel?: string | null) => {
    switch (channel) {
      case 'POS':
        return t('orders.channels.pos');
      case 'KIOSK':
        return t('orders.channels.kiosk');
      case 'ONLINE':
        return t('orders.channels.online');
      case 'AGGREGATOR':
        return t('orders.channels.aggregator');
      default:
        return channel || '—';
    }
  };

  const getOrderStatusLabel = (status: string, refundedTotal?: string | null) => {
    switch (status) {
      case 'DRAFT':
        return t('orders.statuses.draft');
      case 'REJECTED':
        return t('orders.statuses.rejected');
      default:
        break;
    }
    switch (lifecycleOf({ status, refunded_total: refundedTotal })) {
      case 'WAITING':
        return t('orders.statuses.pendingAcceptance');
      case 'OPEN':
        return t('orders.statuses.open');
      case 'REFUNDED':
        return t('orders.statuses.refunded');
      case 'COMPLETED':
        return t('orders.statuses.completed');
      case 'CANCELLED':
        return t('orders.statuses.cancelled');
      default:
        return status;
    }
  };

  /** A state as the timeline names it: the kitchen or delivery step for an open order. */
  const getStateStepLabel = (status: string) => {
    const key = progressKeyOf(status);
    return key ? t(`orders.progress.${key}`) : getOrderStatusLabel(status);
  };

  const renderProgressChip = (status: string) => {
    const key = progressKeyOf(status);
    return key ? <Chip label={t(`orders.progress.${key}`)} size="small" variant="outlined" /> : null;
  };

  // An open Snappfood order shows the time the store promised, or that Snappfood support has it.
  const renderSnappfoodChips = (order: OrderHeader) => {
    if (!isSnappfoodOrder(order) || lifecycleOf(order) !== 'OPEN') return null;
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
    lifecycleOf(order) === 'OPEN' &&
    order.order_type !== 'DELIVERY' &&
    order.status !== 'OUT_FOR_DELIVERY' &&
    !MoneyUtil.greaterThan(order.due_amount || '0', '0');

  // A waiting order is answered on Incoming Orders, and a finished one is refunded, not cancelled.
  // Only Snappfood cancels one of its orders; the store reports a problem to Snappfood instead.
  const canCancel = (order: OrderHeader) =>
    !readOnly && !isSnappfoodOrder(order) && (lifecycleOf(order) === 'OPEN' || order.status === 'DRAFT');

  // Snappfood collects for its orders, so the till never takes money for one.
  const canPay = (order: OrderHeader) =>
    !readOnly && !isSnappfoodOrder(order) && order.status !== 'CANCELLED' && MoneyUtil.greaterThan(order.due_amount, '0');

  const canReport = (order: OrderHeader) => !readOnly && reportMinutesLeft(order, Date.now()) > 0;

  // A receipt is for money taken; an unpaid order has a guest bill instead.
  const hasReceipt = (order: OrderHeader) => MoneyUtil.greaterThan(order.paid_amount || order.paid_total || '0', '0');

  // Rung up as the wrong kind of order. Not a Snappfood order — that one is theirs — and not
  // once a courier has it, which the server refuses anyway; hiding the button just saves the
  // cashier a pointless error.
  const canChangeType = (order: OrderHeader) =>
    !readOnly &&
    !isSnappfoodOrder(order) &&
    order.status !== 'OUT_FOR_DELIVERY' &&
    (lifecycleOf(order) === 'OPEN' || order.status === 'DRAFT');

  const canEditLines = (order: OrderHeader) =>
    !readOnly && !isSnappfoodOrder(order) && !['COMPLETED', 'CANCELLED', 'OUT_FOR_DELIVERY'].includes(order.status);

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
        loadDrawerDetails(reported.id);
      }
    } catch (err: any) {
      setReportError(err?.detail || err?.message || t('orders.snappfood.reportFailed'));
    } finally {
      setReportSubmitting(false);
    }
  };

  const listQuery = useMemo<OrderListQuery>(
    () => ({
      branchId: branchId || undefined,
      group: tab,
      ...rangeBounds(range, customFrom, customTo),
      type: typeFilter || undefined,
      channel: channelFilter || undefined,
      q: query || undefined,
      sort: sortField,
      dir: sortDir,
    }),
    [branchId, tab, range, customFrom, customTo, typeFilter, channelFilter, query, sortField, sortDir]
  );

  // Answers can come back out of order when filters change quickly; only the latest counts.
  const requestSeq = useRef(0);

  const loadData = useCallback(
    async (silent = false) => {
      const seq = ++requestSeq.current;
      if (!silent) setLoading(true);
      try {
        const res = await orderApi.listOrders({ ...listQuery, page: page + 1, limit: pageSize, counts: true });
        if (seq !== requestSeq.current) return;
        setRows(res.data);
        setTotal(res.total);
        setCounts(res.counts || {});
        setError(null);
      } catch (err: any) {
        if (seq === requestSeq.current) setError(err.detail || t('orders.errors.loadFailed'));
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [listQuery, page, pageSize, t]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    settingsApi.getReasonCodes().then(setReasonCodes).catch(() => setReasonCodes([]));
  }, []);

  // An order placed at the till, paid, sent or finished anywhere in the branch shows up here
  // without a refresh. The list re-reads in place, keeping the page and filters.
  useLiveRefresh(['orders'], () => loadData(true), branchId);

  // The search box writes to the address bar once typing pauses.
  useEffect(() => {
    setSearchText(query);
  }, [query]);

  useEffect(() => {
    if (searchText === query) return undefined;
    const timer = setTimeout(() => setParams({ q: searchText || null }), 350);
    return () => clearTimeout(timer);
  }, [searchText, query, setParams]);

  const loadDrawerDetails = useCallback(
    async (orderId: string) => {
      setLoadingDrawerDetails(true);
      try {
        const [detail, audit, payments, refunds] = await Promise.all([
          axios.get(`/api/v1/orders/${orderId}`).then((res) => res.data),
          axios
            .get('/api/v1/reports/audit', { params: { entityId: orderId } })
            .then((res) => res.data)
            .catch(() => []),
          paymentApi.getOrderPayments(orderId).catch(() => [] as PaymentRecord[]),
          refundApi.getRefunds(orderId).catch(() => [] as RefundRecord[]),
        ]);
        setSelectedDrawerOrder(detail);
        setSelectedOrder(detail);
        setOrderAuditLogs(Array.isArray(audit) ? audit : audit?.data || []);
        setOrderPayments(payments);
        setOrderRefunds(refunds);
      } catch (err: any) {
        setError(err?.detail || t('orders.errors.detailFailed'));
      } finally {
        setLoadingDrawerDetails(false);
      }
    },
    [t]
  );

  // ?order= opens the drawer, so an order can be linked to and survives a reload.
  useEffect(() => {
    if (!drawerOrderId) return;
    setDrawerTab('details');
    setOrderAuditLogs([]);
    setOrderPayments([]);
    setOrderRefunds([]);
    loadDrawerDetails(drawerOrderId);
  }, [drawerOrderId, loadDrawerDetails]);

  const openDrawer = (order: OrderHeader) => {
    // The row is on screen already; show it while the full order loads.
    setSelectedDrawerOrder(order);
    setParams({ order: order.id }, true);
  };

  const closeDrawer = () => setParams({ order: null }, true);

  const handleExport = async () => {
    setExporting(true);
    try {
      await orderApi.exportOrders(listQuery);
    } catch (err: any) {
      setError(err?.detail || t('orders.errors.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const openMenu = (event: React.MouseEvent<HTMLElement>, order: OrderListRow) => {
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
    setMenuOrder(order);
  };

  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuOrder(null);
  };

  /** Runs a menu choice for the row the menu was opened on. */
  const fromMenu = (action: (order: OrderListRow) => void) => () => {
    const order = menuOrder;
    closeMenu();
    if (order) action(order);
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

  const handleOpenTypeDialog = (order: OrderHeader) => {
    setTypeOrder(order);
    // Offer something other than what it already is, so the dialog opens on a real choice.
    setTypeTarget(order.order_type === 'DELIVERY' ? 'TAKEAWAY' : 'DELIVERY');
    setTypeAddressId('');
    setTypeZoneId('');
    setTypeTableId('');
    setTypeReason('');
    setTypeError(null);
    setTypeDialogOpen(true);
  };

  const handleConfirmTypeChange = async (approvalRequestId?: string) => {
    if (!typeOrder) return;
    setTypeSubmitting(true);
    setTypeError(null);
    try {
      await orderApi.changeOrderType(typeOrder.id, typeTarget, {
        deliveryAddressId: typeAddressId || undefined,
        deliveryZoneId: typeZoneId || undefined,
        tableId: typeTableId || undefined,
        reason: typeReason || undefined,
        approvalRequestId,
      });
      setTypeDialogOpen(false);
      setTypeOrder(null);
      await loadData();
    } catch (err: any) {
      // Past the cashier's window, or once money has landed, the server wants a manager.
      // Same shape as the cancel flow: collect a PIN and retry the identical change.
      if (err?.code === 'APPROVAL_REQUIRED') {
        const escalation: string = err?.escalations?.[0] || '';
        setTypeEscalation(escalation.split(':')[1] || '');
        setTypeApprovalOpen(true);
        return;
      }
      setTypeError(err.detail || err.message || t('orders.errors.typeChangeFailed', 'Could not change the order type'));
    } finally {
      setTypeSubmitting(false);
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
    setReprintStationId('');
    setReprintStations([]);
    setReprintReason('');
    setReprintError(null);
    setReprintDialogOpen(true);
  };

  const handleCloseReprintDialog = () => {
    if (reprintSubmitting) return;
    setReprintDialogOpen(false);
    setReprintError(null);
  };

  /**
   * The stations this order printed to, so one lost chit can be printed again on its own.
   * Taken from the chits themselves, since routes may have changed since.
   */
  const loadReprintStations = useCallback(async (orderId: string) => {
    try {
      const res = await kdsApi.getPrintJobs({ entityId: orderId, documentType: 'KITCHEN_TICKET', limit: 50 });
      const byGroup = new Map<string, string>();
      for (const job of res.items) {
        if (!job.printer_group_id) continue;
        // "Grill (1/3)" is the same station as "Grill (2/4)" on another print.
        byGroup.set(job.printer_group_id, (job.label || '').replace(/\s*\([^)]*\)\s*$/, '') || job.printer_group_id);
      }
      setReprintStations([...byGroup].map(([id, name]) => ({ id, name })));
    } catch {
      // Without the list the dialog just offers every station, which is the old behaviour.
      setReprintStations([]);
    }
  }, []);

  useEffect(() => {
    if (reprintDialogOpen && reprintDocumentType === 'KITCHEN_TICKET' && selectedOrder) {
      loadReprintStations(selectedOrder.id);
    }
  }, [reprintDialogOpen, reprintDocumentType, selectedOrder, loadReprintStations]);

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
      const printJobs = await kdsApi.reprintOrder(
        selectedOrder.id,
        reprintDocumentType,
        reason,
        undefined,
        reprintDocumentType === 'KITCHEN_TICKET' ? reprintStationId || undefined : undefined
      );
      if (!Array.isArray(printJobs) || printJobs.length === 0) {
        throw new Error(t('orders.reprintDialog.failed'));
      }

      const documentLabel = {
        KITCHEN_TICKET: t('orders.reprintDialog.kitchenTicket'),
        CUSTOMER_RECEIPT: t('orders.reprintDialog.customerReceipt'),
        GUEST_BILL: t('orders.reprintDialog.guestBill'),
        COURIER_SLIP: t('orders.reprintDialog.courierSlip'),
      }[reprintDocumentType];
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

  const getStatusChipColor = (order: { status: string; refunded_total?: string | null }) => {
    switch (lifecycleOf(order)) {
      case 'WAITING':
        return 'warning';
      case 'OPEN':
        return 'info';
      case 'REFUNDED':
        return 'secondary';
      case 'CANCELLED':
        return 'error';
      default:
        return 'default';
    }
  };

  /** Today's orders show the time; anything older shows the date too. */
  const formatPlaced = (placedAt: string) =>
    businessDate(placedAt) === businessToday() ? formatCalendarTime(placedAt) : formatCalendarDateTime(placedAt);

  const activeItems = (order: OrderHeader) => (order.items || []).filter((it: any) => it.state !== 'VOID' && it.state !== 'REPLACED');

  /** The one thing a cashier most likely wants to do next with this order, if anything. */
  const primaryActionOf = (order: OrderListRow) => {
    if (canPay(order)) {
      return { key: 'pay', label: t('orders.actions.pay'), color: 'success' as const, icon: <PaymentIcon />, run: () => handleOpenPayment(order) };
    }
    if (canComplete(order)) {
      return {
        key: 'complete',
        label: t('orders.actions.complete'),
        color: 'primary' as const,
        icon: <DoneAllIcon />,
        run: () => handleUpdateStatus(order.id, 'COMPLETED'),
      };
    }
    if (canReport(order)) {
      return {
        key: 'report',
        label: t('orders.actions.reportToSnappfood'),
        color: 'warning' as const,
        icon: <ScheduleIcon />,
        run: () => handleOpenReport(order),
      };
    }
    return null;
  };

  /** Where the order is: its table, the counter, or where a delivery is going and who has it. */
  const renderWhere = (order: OrderListRow) => {
    if (order.table_number) {
      return (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {t('orders.table.tableNumber', { number: order.table_number })}
        </Typography>
      );
    }
    const isDelivery = order.order_type === 'DELIVERY' || !!order.delivery_state || !!order.delivery_zone_name;
    if (isDelivery) {
      const stateKey = deliveryStateKeyOf(order.delivery_state);
      // "No courier yet" only means something while the order is still on its way out.
      const progress =
        [stateKey ? t(`delivery.states.${stateKey}`) : null, order.courier_name].filter(Boolean).join(' · ') ||
        (order.lifecycle === 'OPEN' ? t('orders.table.noCourierYet') : '');
      return (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {order.delivery_zone_name || t('orders.table.delivery')}
          </Typography>
          {progress && (
            <Typography color="text.secondary" variant="caption" sx={{ display: 'block' }}>
              {progress}
            </Typography>
          )}
        </Box>
      );
    }
    if (order.order_type === 'AGGREGATOR') {
      return <Typography variant="body2">{t('orders.table.snappfoodCourier')}</Typography>;
    }
    return <Typography variant="body2">{t('orders.table.counter')}</Typography>;
  };

  const renderPayment = (order: OrderListRow) => (
    <Box>
      <Typography color="success.main" sx={{ display: 'block', fontWeight: 600 }} variant="caption">
        <span dir="ltr">{t('orders.table.paid', { amount: MoneyUtil.formatCurrency(order.paid_amount || order.paid_total || '0') })} IRR</span>
      </Typography>
      {/* Money given back outranks money taken: an order whose
          tender was reversed must not keep reading as settled. */}
      {MoneyUtil.greaterThan(order.refunded_total || '0', '0') ? (
        <Typography color="warning.main" sx={{ display: 'block', fontWeight: 700 }} variant="caption">
          <span dir="ltr">
            {t('orders.table.refunded', { amount: MoneyUtil.formatCurrency(order.refunded_total || '0') })} IRR
          </span>
        </Typography>
      ) : MoneyUtil.greaterThan(order.due_amount || '0', '0') ? (
        <Typography color="error.main" sx={{ display: 'block', fontWeight: 700 }} variant="caption">
          <span dir="ltr">{t('orders.table.due', { amount: MoneyUtil.formatCurrency(order.due_amount) })} IRR</span>
        </Typography>
      ) : (
        <Chip color="success" label={t('orders.table.fullyPaid')} size="small" sx={{ fontSize: 9, height: 18 }} />
      )}
    </Box>
  );

  const columns: GridColDef<OrderListRow>[] = [
    {
      field: 'order_number',
      headerName: t('orders.table.orderNumber'),
      width: 210,
      filterable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          {row.call_number ? <Chip label={row.call_number} size="small" color="primary" sx={{ fontWeight: 800 }} /> : null}
          <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
            {row.order_number}
          </Typography>
        </Stack>
      ),
    },
    ...(showBranchColumn
      ? [
          {
            field: 'branch_id',
            headerName: t('orders.table.branch', 'Branch'),
            width: 140,
            sortable: false,
            filterable: false,
            renderCell: ({ row }) => branchNameById.get(row.branch_id) || row.branch_id,
          } as GridColDef<OrderListRow>,
        ]
      : []),
    {
      field: 'placed_at',
      headerName: t('orders.table.placedAt'),
      width: 130,
      filterable: false,
      renderCell: ({ row }) => (
        <Typography variant="caption" dir="ltr">
          {formatPlaced(row.placed_at)}
        </Typography>
      ),
    },
    {
      field: 'channel',
      headerName: t('orders.table.channel'),
      width: 110,
      sortable: false,
      filterable: false,
      renderCell: ({ row }) => <Chip label={getChannelLabel(row.channel)} size="small" variant="outlined" />,
    },
    {
      field: 'order_type',
      headerName: t('orders.table.type'),
      width: 110,
      sortable: false,
      filterable: false,
      renderCell: ({ row }) => (
        <Chip color={getOrderTypeColor(row.order_type) as any} label={getOrderTypeLabel(row.order_type)} size="small" />
      ),
    },
    {
      field: 'where',
      headerName: t('orders.table.where'),
      minWidth: 150,
      flex: 1,
      sortable: false,
      filterable: false,
      renderCell: ({ row }) => renderWhere(row),
    },
    {
      field: 'customer_name',
      headerName: t('orders.table.customerName'),
      minWidth: 150,
      flex: 1,
      sortable: false,
      filterable: false,
      renderCell: ({ row }) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {row.customer_name || t('orders.table.walkInCustomer')}
          </Typography>
          {row.customer_mobile && (
            <Typography color="text.secondary" variant="caption" sx={{ display: 'block' }} dir="ltr">
              {row.customer_mobile}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      field: 'items',
      headerName: t('orders.table.itemsSummary'),
      minWidth: 150,
      flex: 1,
      sortable: false,
      filterable: false,
      renderCell: ({ row }) => {
        const items = activeItems(row);
        const count = items.reduce((sum, it) => sum + Number(it.quantity || 0), 0);
        return (
          <Tooltip
            title={items.map((it) => `${MoneyUtil.format(it.quantity, 0)}× ${it.product_name}`).join('، ')}
            placement="top"
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {items[0]?.product_name || '—'}
              </Typography>
              {items.length > 1 && (
                <Typography color="text.secondary" variant="caption" sx={{ display: 'block' }}>
                  {t('orders.table.itemCount', { count })}
                </Typography>
              )}
            </Box>
          </Tooltip>
        );
      },
    },
    {
      field: 'grand_total',
      headerName: t('orders.table.totalAmount'),
      width: 140,
      align: 'right',
      headerAlign: 'right',
      filterable: false,
      renderCell: ({ row }) => (
        <Typography variant="body2" sx={{ color: 'primary.main', fontWeight: 700 }}>
          <span dir="ltr">{MoneyUtil.formatCurrency(row.total_amount || row.grand_total)} IRR</span>
        </Typography>
      ),
    },
    {
      field: 'outstanding_total',
      headerName: t('orders.table.paidDue'),
      width: 150,
      align: 'right',
      headerAlign: 'right',
      filterable: false,
      renderCell: ({ row }) => renderPayment(row),
    },
    {
      field: 'status',
      headerName: t('orders.table.status'),
      width: 170,
      sortable: false,
      filterable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          <Chip
            color={getStatusChipColor(row) as any}
            label={getOrderStatusLabel(row.status, row.refunded_total)}
            size="small"
            sx={{ fontWeight: 700 }}
          />
          {renderProgressChip(row.status)}
          {renderSnappfoodChips(row)}
        </Stack>
      ),
    },
    {
      field: 'actions',
      headerName: t('orders.table.actions'),
      width: 160,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      renderCell: ({ row }) => {
        const primary = readOnly ? null : primaryActionOf(row);
        return (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'flex-end', width: 1 }}>
            {primary && (
              <Button
                color={primary.color}
                onClick={(e) => {
                  e.stopPropagation();
                  primary.run();
                }}
                size="small"
                startIcon={primary.icon}
                variant="contained"
              >
                {primary.label}
              </Button>
            )}
            <IconButton aria-label={t('orders.actions.more')} onClick={(e) => openMenu(e, row)} size="small">
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Stack>
        );
      },
    },
  ];

  const sortModel = useMemo<GridSortModel>(() => [{ field: sortField || 'placed_at', sort: sortDir }], [sortField, sortDir]);
  const menuPrimary = menuOrder && !readOnly ? primaryActionOf(menuOrder) : null;

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

        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Button
            disabled={exporting || total === 0}
            onClick={handleExport}
            startIcon={exporting ? <CircularProgress size={16} /> : <DownloadIcon />}
            variant="outlined"
          >
            {t('orders.export')}
          </Button>
          <Button onClick={() => loadData()} startIcon={<RefreshIcon />} variant="outlined">
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

      {/* Filters: which orders (tab), when, what kind, from where, and a search over all of them */}
      <Card sx={{ borderRadius: 3, boxShadow: 2, mb: 3 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Tabs
            onChange={(_, val) => setParams({ tab: val })}
            sx={{ minHeight: 40, mb: 2 }}
            value={tab}
            variant="scrollable"
          >
            {TABS.map(({ key, label }) => (
              <Tab key={key} label={t(`orders.tabs.${label}`, { count: counts[key] ?? 0 })} value={key} />
            ))}
          </Tabs>

          <Stack direction={{ md: 'row', xs: 'column' }} spacing={1.5} sx={{ alignItems: { md: 'center', xs: 'stretch' }, flexWrap: 'wrap' }}>
            <TextField
              label={t('orders.filters.date')}
              onChange={(e) => setParams({ range: e.target.value, from: null, to: null })}
              select
              size="small"
              sx={{ minWidth: 150 }}
              value={range}
            >
              {RANGES.map((key) => (
                <MenuItem key={key} value={key}>
                  {t(`orders.filters.ranges.${key}`)}
                </MenuItem>
              ))}
            </TextField>

            {range === 'custom' && (
              <>
                <CalendarDateField
                  label={t('orders.filters.from')}
                  onChange={(e) => setParams({ from: e.target.value || null })}
                  size="small"
                  sx={{ width: { md: 170, xs: '100%' } }}
                  value={customFrom}
                />
                <CalendarDateField
                  label={t('orders.filters.to')}
                  onChange={(e) => setParams({ to: e.target.value || null })}
                  size="small"
                  sx={{ width: { md: 170, xs: '100%' } }}
                  value={customTo}
                />
              </>
            )}

            <TextField
              label={t('orders.table.type')}
              onChange={(e) => setParams({ type: e.target.value || null })}
              select
              size="small"
              sx={{ minWidth: 140 }}
              value={typeFilter}
            >
              <MenuItem value="">{t('orders.filters.any')}</MenuItem>
              {ORDER_TYPES.map((type) => (
                <MenuItem key={type} value={type}>
                  {getOrderTypeLabel(type)}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label={t('orders.table.channel')}
              onChange={(e) => setParams({ channel: e.target.value || null })}
              select
              size="small"
              sx={{ minWidth: 140 }}
              value={channelFilter}
            >
              <MenuItem value="">{t('orders.filters.any')}</MenuItem>
              {CHANNELS.map((channel) => (
                <MenuItem key={channel} value={channel}>
                  {getChannelLabel(channel)}
                </MenuItem>
              ))}
            </TextField>

            <Box sx={{ flexGrow: 1 }} />

            <TextField
              onChange={(e) => setSearchText(e.target.value)}
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
              value={searchText}
            />
          </Stack>
        </CardContent>
      </Card>

      <ServerDataGrid<OrderListRow>
        columns={columns}
        density="compact"
        emptyTitle={t('orders.table.empty')}
        emptyDescription={range !== 'all' ? t('orders.table.emptyHint') : undefined}
        getRowHeight={() => 'auto'}
        height={680}
        loading={loading}
        onPaginationModelChange={(model) => {
          if (model.pageSize !== pageSize) setParams({ page: null, size: model.pageSize }, true);
          else if (model.page !== page) setParams({ page: model.page }, true);
        }}
        onRowClick={(params) => openDrawer(params.row)}
        onSortModelChange={(model) => {
          // The grid also reports the model it was given; only a real change resets the page.
          const next = model[0];
          if ((next?.field ?? 'placed_at') === sortField && (next?.sort ?? 'desc') === sortDir) return;
          setParams({ sort: next?.field ?? null, dir: next?.sort ?? null });
        }}
        pageSizeOptions={PAGE_SIZES}
        paginationModel={{ page, pageSize }}
        rowCount={total}
        rows={rows}
        showToolbar={false}
        sortModel={sortModel}
        sx={{
          borderRadius: 3,
          boxShadow: 2,
          '& .MuiDataGrid-row': { cursor: 'pointer' },
          '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center', py: 1 },
        }}
      />

      {/* A row's other actions. The row itself opens the order. */}
      <Menu anchorEl={menuAnchor} onClose={closeMenu} open={!!menuAnchor}>
        <MenuItem onClick={fromMenu(openDrawer)}>
          <ListItemIcon>
            <ReceiptLongIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('orders.actions.details')}</ListItemText>
        </MenuItem>
        {menuOrder && (
          <MenuItem component={RouterLink} href={paths.app.orders.detail(menuOrder.id)} onClick={closeMenu}>
            <ListItemIcon>
              <OpenInNewIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('orders.actions.openPage')}</ListItemText>
          </MenuItem>
        )}
        {menuOrder && hasReceipt(menuOrder) && (
          <MenuItem onClick={fromMenu((o) => handleViewReceipt(o.id))}>
            <ListItemIcon>
              <ReceiptIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('orders.actions.receipt')}</ListItemText>
          </MenuItem>
        )}
        {!readOnly && (
          <MenuItem onClick={fromMenu(handleOpenReprintDialog)}>
            <ListItemIcon>
              <PrintIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('orders.actions.reprint')}</ListItemText>
          </MenuItem>
        )}
        {menuOrder && canPay(menuOrder) && menuPrimary?.key !== 'pay' && (
          <MenuItem onClick={fromMenu(handleOpenPayment)}>
            <ListItemIcon>
              <PaymentIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('orders.actions.pay')}</ListItemText>
          </MenuItem>
        )}
        {menuOrder && canReport(menuOrder) && menuPrimary?.key !== 'report' && (
          <MenuItem onClick={fromMenu(handleOpenReport)}>
            <ListItemIcon>
              <ScheduleIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('orders.actions.reportToSnappfood')}</ListItemText>
          </MenuItem>
        )}
        {menuOrder && canChangeType(menuOrder) && (
          <MenuItem onClick={fromMenu(handleOpenTypeDialog)}>
            <ListItemIcon>
              <SwapHorizIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('orders.actions.changeType', 'Change type')}</ListItemText>
          </MenuItem>
        )}
        {menuOrder && canCancel(menuOrder) && [
          <Divider key="divider" />,
          <MenuItem key="cancel" onClick={fromMenu(handleOpenCancelDialog)} sx={{ color: 'error.main' }}>
            <ListItemIcon>
              <CancelIcon color="error" fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('orders.actions.cancelOrder')}</ListItemText>
          </MenuItem>,
        ]}
      </Menu>

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
              {reasonCodes
                .filter((r) => r.is_active !== false && (!r.applies_to?.length || r.applies_to.includes('ORDER_CANCEL')))
                .map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.name}
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
                onChange={(e) => setReprintDocumentType(e.target.value as ReprintDocumentType)}
                value={reprintDocumentType}
              >
                <MenuItem value="CUSTOMER_RECEIPT">
                  {t('orders.reprintDialog.customerReceipt')}
                </MenuItem>
                <MenuItem value="KITCHEN_TICKET">
                  {t('orders.reprintDialog.kitchenTicket')}
                </MenuItem>
                <MenuItem value="GUEST_BILL">
                  {t('orders.reprintDialog.guestBill')}
                </MenuItem>
                {selectedOrder?.order_type === 'DELIVERY' && (
                  <MenuItem value="COURIER_SLIP">
                    {t('orders.reprintDialog.courierSlip')}
                  </MenuItem>
                )}
              </Select>
            </FormControl>

            {reprintDocumentType === 'KITCHEN_TICKET' && reprintStations.length > 1 && (
              <FormControl fullWidth>
                <InputLabel>{t('orders.reprintDialog.station', 'Station')}</InputLabel>
                <Select
                  label={t('orders.reprintDialog.station', 'Station')}
                  onChange={(e) => setReprintStationId(e.target.value)}
                  value={reprintStationId}
                >
                  <MenuItem value="">{t('orders.reprintDialog.allStations', 'Every station')}</MenuItem>
                  {reprintStations.map((station) => (
                    <MenuItem key={station.id} value={station.id}>
                      {station.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

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
        onClose={closeDrawer}
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
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                  <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 800 }}>
                    {selectedDrawerOrder.order_number}
                  </Typography>
                  {selectedDrawerOrder.call_number ? (
                    <Chip label={selectedDrawerOrder.call_number} color="primary" sx={{ fontWeight: 800 }} />
                  ) : null}
                  <Chip
                    label={getOrderStatusLabel(selectedDrawerOrder.status, selectedDrawerOrder.refunded_total)}
                    color={getStatusChipColor(selectedDrawerOrder) as any}
                    size="small"
                    sx={{ fontWeight: 700 }}
                  />
                  {renderProgressChip(selectedDrawerOrder.status)}
                  {renderSnappfoodChips(selectedDrawerOrder)}
                  <Chip
                    label={getOrderTypeLabel(selectedDrawerOrder.order_type)}
                    size="small"
                    variant="outlined"
                    color={getOrderTypeColor(selectedDrawerOrder.order_type) as any}
                  />
                  <Chip label={getChannelLabel(selectedDrawerOrder.channel)} size="small" variant="outlined" />
                </Stack>
                <Stack direction="row" spacing={0.5}>
                  <Tooltip title={t('orders.actions.openPage')}>
                    <IconButton component={RouterLink} href={paths.app.orders.detail(selectedDrawerOrder.id)} size="small">
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <IconButton onClick={closeDrawer} size="small">
                    <CloseIcon />
                  </IconButton>
                </Stack>
              </Stack>

              <Typography variant="caption" color="text.secondary">
                {t('orders.drawer.placedOn', { date: selectedDrawerOrder.placed_at ? formatCalendarDateTime(selectedDrawerOrder.placed_at) : t('orders.drawer.justNow') })}
                {selectedDrawerOrder.table_number && ` • ${t('orders.drawer.table', { number: selectedDrawerOrder.table_number })}`}
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
                variant="scrollable"
              >
                <Tab
                  value="details"
                  label={t('orders.drawer.tabs.summary')}
                  icon={<ReceiptLongIcon sx={{ fontSize: 18 }} />}
                  iconPosition="start"
                  sx={{ minHeight: 38, py: 0.5, fontWeight: 700 }}
                />
                <Tab
                  value="payments"
                  label={t('orders.drawer.tabs.payments', { count: orderPayments.length + orderRefunds.length })}
                  icon={<PaymentIcon sx={{ fontSize: 18 }} />}
                  iconPosition="start"
                  sx={{ minHeight: 38, py: 0.5, fontWeight: 700 }}
                />
                <Tab
                  value="audit"
                  label={t('orders.drawer.tabs.audit', { count: orderAuditLogs.length + (selectedDrawerOrder.stateEvents?.length || 0) })}
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
                  {/* Who and where */}
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <PersonIcon fontSize="small" color="primary" /> {t('orders.drawer.customerContext')}
                    </Typography>
                    <Grid container spacing={1.5}>
                      {[
                        [t('orders.drawer.customerName'), selectedDrawerOrder.people?.customer
                          ? `${selectedDrawerOrder.people.customer.first_name || ''} ${selectedDrawerOrder.people.customer.last_name || ''}`.trim()
                          : selectedDrawerOrder.customer_name || t('orders.drawer.walkIn')],
                        [t('orders.drawer.contactPhone'), selectedDrawerOrder.context?.customer_mobile || selectedDrawerOrder.customer_mobile],
                        [t('orders.drawer.dineInTable'), selectedDrawerOrder.table_number && t('orders.drawer.table', { number: selectedDrawerOrder.table_number })],
                        [t('orders.drawer.takenBy'), selectedDrawerOrder.people?.taken_by?.display_name || selectedDrawerOrder.people?.taken_by?.username],
                        [t('orders.drawer.terminal'), selectedDrawerOrder.context?.terminal_name],
                        [t('orders.drawer.deliveryZone'), selectedDrawerOrder.context?.delivery_zone_name],
                        [t('orders.drawer.deliveryState'), deliveryStateKeyOf(selectedDrawerOrder.context?.delivery_state)
                          ? t(`delivery.states.${deliveryStateKeyOf(selectedDrawerOrder.context?.delivery_state)}`)
                          : null],
                        [t('orders.drawer.courier'), selectedDrawerOrder.people?.courier?.name],
                      ]
                        .filter(([, value]) => !!value)
                        .map(([label, value]) => (
                          <Grid key={String(label)} size={{ xs: 6 }}>
                            <Typography variant="caption" color="text.secondary">{label}</Typography>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{value}</Typography>
                          </Grid>
                        ))}
                      {selectedDrawerOrder.context?.delivery_address && (
                        <Grid size={{ xs: 12 }}>
                          <Typography variant="caption" color="text.secondary">{t('orders.drawer.deliveryAddress')}</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>{selectedDrawerOrder.context.delivery_address}</Typography>
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
                            // A voided line stays on the order for the audit trail, struck through
                            // so it does not read as something still to be paid for.
                            <TableRow
                              key={item.id}
                              sx={item.state === 'VOID' ? { opacity: 0.5, '& td': { textDecoration: 'line-through' } } : undefined}
                            >
                              <TableCell>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                  {item.product_name}
                                  {item.state === 'VOID' && (
                                    <Chip label={t('orders.drawer.voided', 'Voided')} size="small" color="error" variant="outlined" sx={{ ml: 1, height: 18, fontSize: '0.65rem' }} />
                                  )}
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
                      {MoneyUtil.greaterThan(selectedDrawerOrder.delivery_fee || '0', '0') && (
                        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="text.secondary">{t('orders.drawer.deliveryFee')}</Typography>
                          <Typography variant="body2" dir="ltr">+{MoneyUtil.formatCurrency(selectedDrawerOrder.delivery_fee)} IRR</Typography>
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
                      {MoneyUtil.greaterThan(selectedDrawerOrder.refunded_total || '0', '0') && (
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="body2" color="warning.main">{t('orders.drawer.refundedAmount')}</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: 'warning.main' }} dir="ltr">
                            -{MoneyUtil.formatCurrency(selectedDrawerOrder.refunded_total)} IRR
                          </Typography>
                        </Stack>
                      )}
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">{t('orders.drawer.outstandingBalance')}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700, color: MoneyUtil.greaterThan(selectedDrawerOrder.due_amount || '0', '0') ? 'error.main' : 'success.main' }} dir="ltr">
                          {MoneyUtil.formatCurrency(selectedDrawerOrder.due_amount || '0')} IRR
                        </Typography>
                      </Stack>
                    </Stack>
                  </Paper>
                </Stack>
              ) : drawerTab === 'payments' ? (
                /* TAB 2: PAYMENTS AND REFUNDS */
                <Stack spacing={3}>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                      {t('orders.drawer.paymentsTitle')}
                    </Typography>
                    {orderPayments.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        {isSnappfoodOrder(selectedDrawerOrder)
                          ? t('orders.drawer.paidToSnappfood')
                          : hasReceipt(selectedDrawerOrder)
                            ? t('orders.drawer.paidWithoutDetail')
                            : t('orders.drawer.noPayments')}
                      </Typography>
                    ) : (
                      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                        <Table size="small">
                          <TableHead sx={{ bgcolor: 'background.neutral' }}>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 700 }}>{t('orders.drawer.paymentMethod')}</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>{t('orders.drawer.paymentTime')}</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>{t('orders.table.status')}</TableCell>
                              <TableCell align="right" sx={{ fontWeight: 700 }}>{t('orders.drawer.total')}</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {orderPayments.map((payment) => (
                              <TableRow key={payment.id}>
                                <TableCell>
                                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    {t(`orders.drawer.methods.${payment.method_kind}`, payment.method_kind)}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                    {payment.payment_number}
                                  </Typography>
                                </TableCell>
                                <TableCell>
                                  <Typography variant="caption" dir="ltr">
                                    {formatCalendarDateTime(payment.posted_at || payment.initiated_at)}
                                  </Typography>
                                </TableCell>
                                <TableCell>
                                  <Chip
                                    color={payment.status === 'SUCCEEDED' ? 'success' : payment.status === 'FAILED' ? 'error' : 'default'}
                                    label={t(`orders.drawer.paymentStatuses.${payment.status}`, payment.status)}
                                    size="small"
                                    variant="outlined"
                                  />
                                </TableCell>
                                <TableCell align="right" sx={{ fontWeight: 700 }}>
                                  <span dir="ltr">{MoneyUtil.formatCurrency(payment.amount)} IRR</span>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </Box>

                  {orderRefunds.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                        {t('orders.drawer.refundsTitle')}
                      </Typography>
                      <Stack spacing={1}>
                        {orderRefunds.map((refund: any) => (
                          <Paper key={refund.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                              <Box>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                                  {refund.code || refund.refund_number}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" dir="ltr">
                                  {formatCalendarDateTime(refund.created_at)}
                                </Typography>
                              </Box>
                              <Stack spacing={0.5} sx={{ alignItems: 'flex-end' }}>
                                <Typography variant="body2" color="warning.main" sx={{ fontWeight: 700 }} dir="ltr">
                                  -{MoneyUtil.formatCurrency(refund.total_refund_amount || refund.amount)} IRR
                                </Typography>
                                <Chip label={t(`orders.drawer.paymentStatuses.${refund.status}`, String(refund.status))} size="small" variant="outlined" />
                              </Stack>
                            </Stack>
                            {refund.note && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                {refund.note}
                              </Typography>
                            )}
                          </Paper>
                        ))}
                      </Stack>
                    </Box>
                  )}
                </Stack>
              ) : (
                /* TAB 3: AUDIT TRAIL & TIMELINE */
                <Stack spacing={2.5}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <SecurityIcon color="primary" fontSize="small" /> {t('orders.drawer.auditLogTitle')}
                    </Typography>
                    <Chip label={t('orders.drawer.appendOnly')} color="success" size="small" variant="outlined" />
                  </Box>

                  {/* One timeline, oldest first: the order's own state changes and the audit log. */}
                  {orderAuditLogs.length === 0 && (!selectedDrawerOrder.stateEvents || selectedDrawerOrder.stateEvents.length === 0) ? (
                    <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: 2 }}>
                      <HistoryIcon color="disabled" sx={{ fontSize: 40, mb: 1 }} />
                      <Typography variant="body2" color="text.secondary">
                        {t('orders.drawer.noEvents', { status: getOrderStatusLabel(selectedDrawerOrder.status, selectedDrawerOrder.refunded_total) })}
                      </Typography>
                    </Paper>
                  ) : (
                    <Stack spacing={2} sx={{ position: 'relative', pl: 2, '&::before': { content: '""', position: 'absolute', top: 12, bottom: 12, left: 19, width: 2, bgcolor: 'divider' } }}>
                      {[
                        ...(selectedDrawerOrder.stateEvents || []).map((evt: any) => ({ kind: 'state' as const, at: evt.occurred_at, evt })),
                        ...orderAuditLogs.map((log: any) => ({ kind: 'audit' as const, at: log.occurred_at, evt: log })),
                      ]
                        .sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime())
                        .map(({ kind, evt }, idx) => {
                          const actorNames: Record<string, string> = selectedDrawerOrder.context?.actor_names || {};
                          if (kind === 'state') {
                            const actor = evt.occurred_by
                              ? actorNames[evt.occurred_by] || t('orders.drawer.authenticatedUser')
                              : t('orders.drawer.systemPos');
                            return (
                              <Paper
                                key={evt.id || `state-${idx}`}
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
                                      label={getStateStepLabel(evt.to_state)}
                                      color={getStatusChipColor({ status: evt.to_state }) as any}
                                      size="small"
                                      sx={{ fontWeight: 700 }}
                                    />
                                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                                      {evt.from_state ? `${getStateStepLabel(evt.from_state)} → ${getStateStepLabel(evt.to_state)}` : getStateStepLabel(evt.to_state)}
                                    </Typography>
                                  </Stack>
                                  <Typography variant="caption" color="text.secondary" dir="ltr">
                                    {evt.occurred_at ? formatCalendarDateTime(evt.occurred_at) : t('orders.drawer.justNow')}
                                  </Typography>
                                </Stack>

                                <Typography variant="body2" sx={{ mb: 0.5 }}>
                                  <strong>{t('orders.drawer.actor')}</strong> {actor}
                                </Typography>
                                {evt.reason_text && (
                                  <Typography variant="body2" color="error.main" sx={{ fontWeight: 600 }}>
                                    <strong>{t('orders.drawer.reasonCode')}</strong> {evt.reason_text}
                                  </Typography>
                                )}
                              </Paper>
                            );
                          }
                          const actorId = evt.actor_id || evt.user_id;
                          return (
                            <Paper
                              key={evt.id || `audit-${idx}`}
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
                                  <Chip label={evt.action} color="primary" size="small" sx={{ fontWeight: 700 }} />
                                  <Chip
                                    label={(actorId && actorNames[actorId]) || evt.actor_type || 'SYSTEM'}
                                    size="small"
                                    variant="outlined"
                                    sx={{ fontSize: '0.7rem', height: 20 }}
                                  />
                                </Stack>
                                <Typography variant="caption" color="text.secondary" dir="ltr">
                                  {formatCalendarDateTime(evt.occurred_at)}
                                </Typography>
                              </Stack>

                              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
                                <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                                  {t('orders.drawer.corr')} {evt.correlation_id ? evt.correlation_id.substring(0, 8) + '...' : '-'}
                                </Typography>
                                <Button
                                  size="small"
                                  startIcon={<CodeIcon />}
                                  onClick={() => setInspectingJson(evt)}
                                  sx={{ textTransform: 'none', py: 0.25, fontSize: '0.75rem' }}
                                >
                                  {t('orders.drawer.inspectSnapshot')}
                                </Button>
                              </Stack>
                            </Paper>
                          );
                        })}
                    </Stack>
                  )}
                </Stack>
              )}
            </Box>

            {/* Footer Quick Actions */}
            <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', bgcolor: 'background.neutral' }}>
              <Stack direction="row" sx={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1 }}>
                {hasReceipt(selectedDrawerOrder) && (
                  <Button
                    startIcon={<ReceiptIcon />}
                    variant="outlined"
                    onClick={() => {
                      handleViewReceipt(selectedDrawerOrder.id);
                    }}
                  >
                    {t('orders.actions.receipt')}
                  </Button>
                )}
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
                      closeDrawer();
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
                        loadDrawerDetails(selectedDrawerOrder.id);
                      }
                    }}
                  >
                    {t('orders.actions.completeOrder')}
                  </Button>
                )}
                {/* Snappfood's lines are Snappfood's: it has no call for a store to change them. */}
                {canEditLines(selectedDrawerOrder) && (
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
                {canChangeType(selectedDrawerOrder) && (
                  <Button
                    color="info"
                    variant="outlined"
                    startIcon={<SwapHorizIcon />}
                    onClick={() => {
                      closeDrawer();
                      handleOpenTypeDialog(selectedDrawerOrder);
                    }}
                  >
                    {t('orders.actions.changeType', 'Change type')}
                  </Button>
                )}
                {canCancel(selectedDrawerOrder) && (
                  <Button
                    color="error"
                    variant="outlined"
                    startIcon={<CancelIcon />}
                    onClick={() => {
                      closeDrawer();
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
          if (selectedDrawerOrder) await loadDrawerDetails(selectedDrawerOrder.id);
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

      {/* Convert the order to a different kind */}
      <Dialog
        open={typeDialogOpen}
        onClose={() => !typeSubmitting && setTypeDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('orders.typeDialog.title', 'Change order type')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t(
              'orders.typeDialog.help',
              'The delivery fee follows the order type, so this changes the total. A manager is asked for once money has been taken.'
            )}
          </Typography>

          {typeError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setTypeError(null)}>
              {typeError}
            </Alert>
          )}

          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>{t('orders.typeDialog.newType', 'New type')}</InputLabel>
            <Select
              value={typeTarget}
              label={t('orders.typeDialog.newType', 'New type')}
              onChange={(e) => setTypeTarget(e.target.value as typeof typeTarget)}
            >
              {(['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const)
                .filter((option) => option !== typeOrder?.order_type)
                .map((option) => (
                  <MenuItem key={option} value={option}>
                    {getOrderTypeLabel(option)}
                  </MenuItem>
                ))}
            </Select>
          </FormControl>

          {/* Becoming a delivery needs somewhere to deliver to. The server refuses without
              them and names the missing piece; these fields are how the cashier supplies it. */}
          {typeTarget === 'DELIVERY' && (
            <>
              <TextField
                fullWidth
                sx={{ mb: 2 }}
                label={t('orders.typeDialog.addressId', 'Delivery address')}
                placeholder={t('orders.typeDialog.addressPlaceholder', "Leave blank to keep the order's address")}
                value={typeAddressId}
                onChange={(e) => setTypeAddressId(e.target.value)}
              />
              <TextField
                fullWidth
                sx={{ mb: 2 }}
                label={t('orders.typeDialog.zoneId', 'Delivery zone')}
                placeholder={t('orders.typeDialog.zonePlaceholder', "Leave blank to keep the order's zone")}
                value={typeZoneId}
                onChange={(e) => setTypeZoneId(e.target.value)}
              />
            </>
          )}

          {typeTarget === 'DINE_IN' && (
            <TextField
              fullWidth
              sx={{ mb: 2 }}
              label={t('orders.typeDialog.tableId', 'Table')}
              placeholder={t('orders.typeDialog.tablePlaceholder', 'Optional — can be seated later')}
              value={typeTableId}
              onChange={(e) => setTypeTableId(e.target.value)}
            />
          )}

          <TextField
            fullWidth
            multiline
            rows={2}
            label={t('orders.typeDialog.reason', 'Reason')}
            placeholder={t('orders.typeDialog.reasonPlaceholder', 'e.g. guest will collect')}
            value={typeReason}
            onChange={(e) => setTypeReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button disabled={typeSubmitting} onClick={() => setTypeDialogOpen(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="contained" disabled={typeSubmitting} onClick={() => handleConfirmTypeChange()}>
            {t('orders.typeDialog.confirm', 'Change type')}
          </Button>
        </DialogActions>
      </Dialog>

      <ApprovalModal
        open={typeApprovalOpen}
        onClose={() => setTypeApprovalOpen(false)}
        onSuccess={(_pin, requestId) => {
          setTypeApprovalOpen(false);
          handleConfirmTypeChange(requestId);
        }}
        actionName="EDIT_ORDER"
        entityType="ORDER"
        entityId={typeOrder?.id}
        detailsText={
          typeEscalation === 'TYPE_CHANGE_AGAINST_PAID_ORDER'
            ? t('orders.typeDialog.approvalDetailsPaid', 'Changing the type of an order that has been paid')
            : t('orders.typeDialog.approvalDetails', 'Order type change outside the cashier window')
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
