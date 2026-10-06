import type { GridColDef, GridSortModel, GridFilterModel, GridColumnVisibilityModel } from '@mui/x-data-grid-premium';
import type { RefundRecord } from 'src/api/refundApi';
import type { ReasonCode } from 'src/api/settingsApi';
import type { LabelColor } from 'src/components/label';
import type { ReceiptData, PaymentRecord } from 'src/api/paymentApi';
import type { OrderHeader, OrderListRow, DeclineReason, OrderLifecycle, OrderListQuery } from 'src/api/orderApi';

import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';

import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import PrintIcon from '@mui/icons-material/Print';
import CancelIcon from '@mui/icons-material/Cancel';
import PersonIcon from '@mui/icons-material/Person';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import ReceiptIcon from '@mui/icons-material/Receipt';
import HistoryIcon from '@mui/icons-material/History';
import PaymentIcon from '@mui/icons-material/Payment';
import DownloadIcon from '@mui/icons-material/Download';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ScheduleIcon from '@mui/icons-material/Schedule';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import TakeoutDiningIcon from '@mui/icons-material/TakeoutDining';
import DeliveryDiningIcon from '@mui/icons-material/DeliveryDining';
import DirectionsWalkIcon from '@mui/icons-material/DirectionsWalk';
import {
  Box,
  Tab,
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
  Avatar,
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
  DialogTitle,
  FormControl,
  ListItemIcon,
  ListItemText,
  DialogContent,
  DialogActions,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { paths } from 'src/routes/paths';

import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyLabel } from 'src/utils/currency';
import { fTime, fDateTime } from 'src/utils/format-time';
import { useLiveRefresh } from 'src/utils/use-live-refresh';
import { orderRefOf, useShowsOrderCode } from 'src/utils/order-ref';
import {
  businessDate,
  businessToday,
  formatCalendarTime,
  formatCalendarDateTime,
} from 'src/utils/calendar';
import {
  promisedBy,
  storeDeliversIt,
  isSnappfoodOrder,
  reportMinutesLeft,
  SNAPPFOOD_DELAY_REASON_ID,
} from 'src/utils/snappfood-order';

import { kdsApi } from 'src/api/kdsApi';
import { CONFIG } from 'src/global-config';
import { orderApi } from 'src/api/orderApi';
import { refundApi } from 'src/api/refundApi';
import { paymentApi } from 'src/api/paymentApi';
import { settingsApi } from 'src/api/settingsApi';
import { useAuthStore } from 'src/store/useAuthStore';
import { httpClient as axios } from 'src/api/httpClient';
import { isManagerOrAbove } from 'src/config/role-access';
import { useBranchContext, useScopedBranchId } from 'src/contexts/branch-context';

import { Label } from 'src/components/label';
import { VersionTag } from 'src/components/version-tag';
import { CheckoutModal } from 'src/components/CheckoutModal';
import { ServerDataGrid } from 'src/components/server-data-grid';
import { ApprovalModal } from 'src/components/approval/ApprovalModal';
import { OrderEditDialog } from 'src/components/orders/OrderEditDialog';

import {
  textFilters,
  numberFilters,
  selectFilters,
  toServerFilters,
  placedAtFilters,
  decodeFilterModel,
  encodeFilterModel,
  legacyFilterModel,
  DEFAULT_FILTER_MODEL,
} from './order-grid-filters';

// An order is waiting, open, held, completed, refunded or cancelled. How far the kitchen or
// the courier has got is shown beside that rather than as a stage of its own: most branches
// print tickets and have no screen that would ever move an order to "preparing" or "ready".
// The server files every order under one of these (see `order-list.ts`), so the tab counts
// add up to All.
const OPEN_STATUSES = ['SUBMITTED', 'CONFIRMED', 'PREPARING', 'KITCHEN_PREPARING', 'READY', 'OUT_FOR_DELIVERY'];

type Lifecycle = OrderLifecycle;
type TabKey = Lifecycle | 'ALL';

type ReprintDocumentType = 'CUSTOMER_RECEIPT' | 'KITCHEN_TICKET' | 'GUEST_BILL' | 'COURIER_SLIP';

// No Waiting tab: a waiting order is answered on Incoming Orders, and nothing here can answer
// it. A line above the tabs points there while one waits. No Held tab either: a held order is
// picked up from the till's own held list, or from All, where it says Held and offers Resume.
// Both still count in All. All comes first and is where the page opens: the whole day.
// Each tab's count sits in a label coloured like the orders' own status chips.
const TABS: Array<{ key: TabKey; label: string; color: LabelColor }> = [
  { key: 'ALL', label: 'all', color: 'default' },
  { key: 'OPEN', label: 'open', color: 'info' },
  { key: 'COMPLETED', label: 'completed', color: 'success' },
  { key: 'CANCELLED', label: 'cancelled', color: 'error' },
  { key: 'REFUNDED', label: 'refunded', color: 'secondary' },
];

const ORDER_TYPES = ['DINE_IN', 'TAKEAWAY', 'PICKUP', 'DELIVERY', 'AGGREGATOR'];
const CHANNELS = ['POS', 'KIOSK', 'ONLINE', 'AGGREGATOR'];
// A busy branch takes about 300 orders a day, so a page holds 100 by default.
const PAGE_SIZES = [25, 50, 100];
const SORTABLE = ['placed_at', 'grand_total', 'outstanding_total', 'order_number'] as const;

// Audit actions that only repeat one of the order's own state changes.
const STATE_AUDIT_ACTIONS = new Set([
  'ORDER_CREATED',
  'ORDER_SUBMITTED',
  'ORDER_ACCEPT',
  'ORDER_REJECT',
  'ORDER_START_PREPARATION',
  'ORDER_MARK_READY',
  'ORDER_DISPATCH',
  'ORDER_COMPLETE',
  'ORDER_CANCEL',
  'ORDER_CANCELLED',
]);
// The other order changes the timeline names; anything else reads as "Order changed".
const AUDIT_EVENT_KEYS = [
  'ORDER_EDITED',
  'ORDER_UPDATED',
  'ORDER_TYPE_CHANGED',
  'DINING_TABLE_MOVED',
  'DINING_ORDERS_MERGED',
  'ORDER_SPLIT',
  'ORDER_DELIVERY_FAILED',
];

// Which columns each role starts without. Every column stays in the grid's Columns picker.
type ColumnRole = 'cashier' | 'manager' | 'headOffice';
const DEFAULT_HIDDEN_COLUMNS: Record<ColumnRole, GridColumnVisibilityModel> = {
  // Nearly every order comes from the till in opening hours; Amount already shows what is due.
  cashier: { channel: false, after_hours: false, outstanding_total: false },
  manager: { outstanding_total: false },
  // Head office compares branches and looks orders up; it seldom needs the lines.
  headOffice: { items: false, outstanding_total: false },
};
// The order number is held at the start, and Status and the actions at the end, so a narrow
// till screen scrolls the middle and never loses the state or the Pay button.
const PINNED_COLUMNS = { left: ['order_number'], right: ['status', 'actions'] };
const columnChoiceKey = (role: ColumnRole) => `gnext_orders_columns_${role}`;
const readColumnChoice = (role: ColumnRole): GridColumnVisibilityModel => {
  try {
    return JSON.parse(localStorage.getItem(columnChoiceKey(role)) || '{}');
  } catch {
    return {};
  }
};
const saveColumnChoice = (role: ColumnRole, model: GridColumnVisibilityModel) => {
  try {
    localStorage.setItem(columnChoiceKey(role), JSON.stringify(model));
  } catch {
    // Private windows may refuse storage; the choice then lasts until the page reloads.
  }
};

// Defaults are left out of the address bar, so a plain /app/orders is today's orders, all of
// them, with anything still open from an earlier day.
const DEFAULTS = {
  tab: 'ALL',
  f: encodeFilterModel(DEFAULT_FILTER_MODEL),
  page: '0',
  size: '100',
  sort: 'placed_at',
  dir: 'desc',
};
// What the address bar held before the grid's own filters; dropped once the filters change.
const LEGACY_FILTER_PARAMS = { range: null, from: null, to: null, type: null, channel: null };

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

export function OrdersWorkflowPage() {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();
  const [branchId] = useScopedBranchId();
  const { branches, isHeadOffice } = useBranchContext();
  // Head office looks orders up — a complaint, a courier dispute, a Snappfood query — but the
  // order is the branch's to move, take payment on, print or cancel. So here it is a list to
  // read: details and receipts, and none of the buttons that change an order.
  const readOnly = isHeadOffice;
  // The whole order book, customers' mobiles included, is a manager's to download.
  const userRole = useAuthStore((state) => state.user?.role);
  const canExport = isManagerOrAbove(userRole);
  // A cashier knows an order by its call number; the ORD- code is for managers and head office.
  const showOrderCode = useShowsOrderCode();
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));
  // Only head office ever sees more than one, and only there does the column mean anything.
  const showBranchColumn = !branchId && branches.length > 1;

  // Every filter lives in the address bar, so a reload, the back button or a shared link
  // brings back the same list, and ?order= reopens the same order.
  const [searchParams, setSearchParams] = useSearchParams();
  const param = (key: keyof typeof DEFAULTS | string, fallback = '') =>
    searchParams.get(key) || (DEFAULTS as Record<string, string>)[key] || fallback;
  const tab = param('tab') as TabKey;
  const navigate = useNavigate();
  // The grid's column filters, under `f`. A link from before them still opens its filters.
  const filterParam = searchParams.get('f');
  const legacyParams = Object.keys(LEGACY_FILTER_PARAMS)
    .map((key) => `${key}=${encodeURIComponent(searchParams.get(key) || '')}`)
    .join('&');
  const filterModel = useMemo<GridFilterModel>(
    () => decodeFilterModel(filterParam) ?? legacyFilterModel(new URLSearchParams(legacyParams)) ?? DEFAULT_FILTER_MODEL,
    [filterParam, legacyParams]
  );
  const query = param('q');
  const page = Math.max(0, Number(param('page', '0')) || 0);
  const pageSize = PAGE_SIZES.includes(Number(param('size'))) ? Number(param('size')) : 100;
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
  const [drawerMenuAnchor, setDrawerMenuAnchor] = useState<HTMLElement | null>(null);
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

  // Colour on this page means the order's state (open, completed, cancelled...). The kind of
  // order is told apart by an icon on a neutral chip, so a blue Delivery never reads as Open.
  // Snappfood shows its own logo, which a cashier knows at a glance.
  const typeChipMark = (orderType: string) => {
    switch (orderType) {
      case 'DINE_IN':
        return { icon: <RestaurantIcon /> };
      case 'DELIVERY':
        return { icon: <DeliveryDiningIcon /> };
      case 'AGGREGATOR':
        return { avatar: <Avatar alt="Snappfood" src={`${CONFIG.assetsDir}/logo/snappfood.png`} /> };
      case 'PICKUP':
        return { icon: <DirectionsWalkIcon /> };
      default:
        return { icon: <TakeoutDiningIcon /> };
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
    return key ? (
      <>
        <Chip label={t(`orders.progress.${key}`)} size="small" variant="outlined" />
        {/* Only a kitchen screen moves an order to preparing or ready. */}
        {(key === 'preparing' || key === 'ready') && <VersionTag feature="orders.kitchenProgress" />}
      </>
    ) : null;
  };

  // An open Snappfood order shows the time the store promised, or that Snappfood support has it.
  const renderSnappfoodChips = (order: OrderHeader) => {
    if (!isSnappfoodOrder(order) || lifecycleOf(order) !== 'OPEN') return null;
    if (order.aggregator_issue_at) {
      return (
        <>
          <Chip color="warning" label={t('orders.snappfood.withSupport')} size="small" />
          <VersionTag feature="orders.snappfood" />
        </>
      );
    }
    const by = promisedBy(order);
    return by ? (
      <>
        <Chip
          label={t('orders.snappfood.promisedBy', {
            time: fTime(by),
          })}
          size="small"
          variant="outlined"
        />
        <VersionTag feature="orders.snappfood" />
      </>
    ) : null;
  };

  // Completing closes the check, so nothing may be left to pay. Delivery orders, and Snappfood
  // orders our own couriers take, are finished on the delivery screen, where the courier's cash
  // is counted in.
  const canComplete = (order: OrderHeader) =>
    !readOnly &&
    lifecycleOf(order) === 'OPEN' &&
    order.order_type !== 'DELIVERY' &&
    !storeDeliversIt(order) &&
    order.status !== 'OUT_FOR_DELIVERY' &&
    !MoneyUtil.greaterThan(order.due_amount || '0', '0');

  // A waiting order is answered on Incoming Orders, and a finished one is refunded, not cancelled.
  // Only Snappfood cancels one of its orders; the store reports a problem to Snappfood instead.
  // Nor once a courier has it: it comes back as a failed delivery, on the delivery hub.
  const canCancel = (order: OrderHeader) =>
    !readOnly &&
    !isSnappfoodOrder(order) &&
    order.status !== 'OUT_FOR_DELIVERY' &&
    (lifecycleOf(order) === 'OPEN' || order.status === 'DRAFT');

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
      setSuccess(t('orders.snappfood.reported', { orderNumber: orderRefOf(reportOrder, showOrderCode) }));
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

  // A filter still waiting for its value changes the model but not what the server is asked.
  const serverFilters = JSON.stringify(toServerFilters(filterModel) ?? null);

  const listQuery = useMemo<OrderListQuery>(
    () => ({
      branchId: branchId || undefined,
      group: tab,
      filters: JSON.parse(serverFilters) ?? undefined,
      q: query || undefined,
      sort: sortField,
      dir: sortDir,
    }),
    [branchId, tab, serverFilters, query, sortField, sortDir]
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
   * Taken from the chits themselves, since the stations may have changed since.
   */
  const loadReprintStations = useCallback(async (orderId: string) => {
    try {
      const res = await kdsApi.getPrintJobs({ entityId: orderId, documentType: 'KITCHEN_TICKET', limit: 50 });
      const byStation = new Map<string, string>();
      for (const job of res.items) {
        if (!job.station_id) continue;
        // "Grill (1/3)" is the same station as "Grill (2/4)" on another print.
        byStation.set(job.station_id, (job.label || '').replace(/\s*\([^)]*\)\s*$/, '') || job.station_id);
      }
      setReprintStations([...byStation].map(([id, name]) => ({ id, name })));
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
        orderNumber: orderRefOf(selectedOrder, showOrderCode),
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
      case 'COMPLETED':
        return 'success';
      default:
        return 'default';
    }
  };

  /** Today's orders show the time; anything older shows the date too. */
  const formatPlaced = (placedAt: string) =>
    businessDate(placedAt) === businessToday() ? formatCalendarTime(placedAt) : formatCalendarDateTime(placedAt);

  // A Snappfood order's notes carry the whole order as Snappfood sent it (customer, phone,
  // address, payment), all shown above already; only the guest's own words are worth reading.
  const guestNoteOf = (order: OrderHeader): string | null => {
    const notes = order.notes?.trim();
    if (!notes || !isSnappfoodOrder(order) || !notes.startsWith('Snappfood order')) return notes || null;
    const note = notes.split('\n').find((line) => line.startsWith('Note: '));
    return note ? note.slice('Note: '.length).trim() || null : null;
  };

  const activeItems = (order: OrderHeader) => (order.items || []).filter((it: any) => it.state !== 'VOID' && it.state !== 'REPLACED');

  // A held order is picked up again at the till, where its lines can be changed and sent.
  const canResume = (order: OrderHeader) => !readOnly && order.status === 'DRAFT';
  const resumeAtTill = (order: OrderHeader) => navigate(`${paths.app.pos}?resume=${order.id}`);

  /** A held order is not priced until it is placed, so its value is what its lines add up to. */
  const displayTotalOf = (order: OrderHeader) => {
    const priced = order.total_amount || order.grand_total || '0';
    if (order.status !== 'DRAFT' || MoneyUtil.greaterThan(priced, '0')) return priced;
    return activeItems(order).reduce(
      (sum, it: any) => MoneyUtil.add(sum, it.total_amount || it.line_total || MoneyUtil.multiply(it.unit_price, it.quantity, 2), 2),
      '0'
    );
  };

  /** The one thing a cashier most likely wants to do next with this order, if anything. */
  const primaryActionOf = (order: OrderListRow) => {
    if (canResume(order)) {
      return {
        key: 'resume',
        // Short enough for the row; the drawer says it in full.
        label: t('orders.actions.resume'),
        color: 'primary' as const,
        icon: <PointOfSaleIcon />,
        run: () => resumeAtTill(order),
      };
    }
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

  /**
   * What kind of order it is and where it is: the table, the counter, or where a delivery is
   * going and who has it. How far the courier has got is the Status column's to say.
   */
  const renderWhere = (order: OrderListRow) => {
    const isDelivery = order.order_type === 'DELIVERY' || !!order.delivery_state || !!order.delivery_zone_name;
    let place: React.ReactNode = null;
    if (order.table_number) {
      place = (
        <>
          {t('orders.table.tableNumber', { number: order.table_number })}
          <VersionTag feature="orders.table" sx={{ ml: 0.5 }} />
        </>
      );
    } else if (isDelivery) {
      // "No courier yet" only means something while the order is still on its way out.
      place =
        [order.delivery_zone_name, order.courier_name].filter(Boolean).join(' · ') ||
        (order.lifecycle === 'OPEN' ? t('orders.table.noCourierYet') : '');
    } else if (order.order_type === 'AGGREGATOR') {
      place = t('orders.table.snappfoodCourier');
    }
    // The till is where nearly every order comes from, so only another channel is named.
    const channel = order.channel === 'KIOSK' || order.channel === 'ONLINE' ? getChannelLabel(order.channel) : null;
    return (
      <Box sx={{ minWidth: 0 }}>
        <Chip
          {...typeChipMark(order.order_type)}
          label={getOrderTypeLabel(order.order_type)}
          size="small"
          variant="outlined"
        />
        {(place || channel) && (
          <Typography color="text.secondary" variant="caption" sx={{ display: 'block', mt: 0.25 }} noWrap>
            {place}
            {place && channel ? ' · ' : null}
            {channel}
          </Typography>
        )}
      </Box>
    );
  };

  /** The order's total, and beneath it what is still owed, given back, or that it is settled. */
  const renderAmount = (order: OrderListRow) => {
    const paidNothing = !MoneyUtil.greaterThan(order.paid_amount || order.paid_total || '0', '0');
    // A cancelled order owes nothing, whatever its total; with nothing taken it was never charged.
    const cancelled = order.status === 'CANCELLED' || order.status === 'REJECTED';
    let below: React.ReactNode;
    // Money given back outranks money taken: an order whose tender was reversed must not keep
    // reading as settled.
    if (MoneyUtil.greaterThan(order.refunded_total || '0', '0')) {
      below = (
        <Typography color="warning.main" sx={{ display: 'block', fontWeight: 700 }} variant="caption">
          <span dir="ltr">
            {t('orders.table.refunded', { amount: MoneyUtil.formatCurrency(order.refunded_total || '0') })}
          </span>
        </Typography>
      );
    } else if (isSnappfoodOrder(order) && !cancelled) {
      // Snappfood collects for its orders, so nothing is owed to the till.
      below = (
        <Typography color="text.secondary" sx={{ display: 'block' }} variant="caption">
          {t('orders.table.paidToSnappfood')}
        </Typography>
      );
    } else if (!cancelled && MoneyUtil.greaterThan(order.due_amount || '0', '0')) {
      below = (
        <Typography color="error.main" sx={{ display: 'block', fontWeight: 700 }} variant="caption">
          {/* The total above names the currency. */}
          <span dir="ltr">{t('orders.table.due', { amount: MoneyUtil.formatCurrency(order.due_amount) })}</span>
        </Typography>
      );
    } else if (paidNothing) {
      // Nothing owed and nothing taken (a cancelled order, or one discounted to zero) was
      // never paid, so it does not read as settled.
      below = <Chip label={t('orders.table.notCharged')} size="small" sx={{ fontSize: 9, height: 18 }} variant="outlined" />;
    } else {
      below = <Chip color="success" label={t('orders.table.fullyPaid')} size="small" sx={{ fontSize: 9, height: 18 }} />;
    }
    return (
      <Box sx={{ textAlign: 'right' }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          <span dir="ltr">{MoneyUtil.formatCurrency(displayTotalOf(order))} {currency}</span>
        </Typography>
        {below}
      </Box>
    );
  };

  const columns: GridColDef<OrderListRow>[] = [
    {
      // Guests are called by the call number, so it leads; the order code is for looking up.
      field: 'order_number',
      headerName: t('orders.table.orderNumber'),
      width: 150,
      filterOperators: textFilters('order_number'),
      renderCell: ({ row }) => (
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            {/* With no call number (a held order, an old Snappfood one) the code alone names it. */}
            {row.call_number ? (
              <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                {row.call_number}
              </Typography>
            ) : null}
            {row.source === 'AGENT_OFFLINE' ? (
              <Tooltip title={t('orders.table.takenOffline', 'Taken while the branch was offline')}>
                <CloudOffIcon fontSize="small" color="action" />
              </Tooltip>
            ) : null}
            {row.source === 'AGENT_OFFLINE' ? <VersionTag feature="orders.takenOffline" /> : null}
          </Stack>
          {(showOrderCode || !row.call_number) && (
            <Typography color="text.secondary" variant="caption" noWrap sx={{ display: 'block', fontFamily: 'monospace' }}>
              <bdi dir="ltr">{row.order_number}</bdi>
            </Typography>
          )}
        </Box>
      ),
    },
    ...(showBranchColumn
      ? [
          {
            field: 'branch_id',
            headerName: t('orders.table.branch', 'Branch'),
            renderHeader: () => (
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <span>{t('orders.table.branch', 'Branch')}</span>
                <VersionTag feature="orders.headOfficeView" />
              </Stack>
            ),
            width: 150,
            sortable: false,
            type: 'singleSelect',
            valueOptions: branches.map((b) => ({ value: b.id, label: b.name })),
            filterOperators: selectFilters('branch_id'),
            renderCell: ({ row }) => branchNameById.get(row.branch_id) || row.branch_id,
          } as GridColDef<OrderListRow>,
        ]
      : []),
    {
      field: 'placed_at',
      headerName: t('orders.table.placedAt'),
      width: 110,
      filterOperators: placedAtFilters(t),
      renderCell: ({ row }) => (
        <Typography variant="caption" dir="ltr">
          {formatPlaced(row.placed_at)}
        </Typography>
      ),
    },
    {
      field: 'order_type',
      headerName: t('orders.table.typeWhere'),
      minWidth: 115,
      flex: 1,
      sortable: false,
      type: 'singleSelect',
      valueOptions: ORDER_TYPES.map((type) => ({ value: type, label: getOrderTypeLabel(type) })),
      filterOperators: selectFilters('order_type'),
      renderCell: ({ row }) => renderWhere(row),
    },
    {
      field: 'customer_name',
      headerName: t('orders.table.customerName'),
      minWidth: 90,
      flex: 1,
      sortable: false,
      // Name or mobile; "is empty" is a walk-in.
      filterOperators: textFilters('customer_name'),
      renderCell: ({ row }) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
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
      minWidth: 90,
      flex: 1,
      sortable: false,
      filterOperators: textFilters('items'),
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
      headerName: t('orders.table.amount'),
      width: 140,
      align: 'right',
      headerAlign: 'right',
      type: 'number',
      filterOperators: numberFilters('grand_total'),
      renderCell: ({ row }) => renderAmount(row),
    },
    {
      // Hidden by default: Amount shows what is due. Kept for sorting and filtering by it.
      field: 'outstanding_total',
      headerName: t('orders.table.dueColumn'),
      width: 130,
      align: 'right',
      headerAlign: 'right',
      type: 'number',
      filterOperators: numberFilters('outstanding_total'),
      renderCell: ({ row }) =>
        MoneyUtil.greaterThan(row.due_amount || '0', '0') ? (
          <Typography variant="body2" color="error.main" sx={{ fontWeight: 700 }}>
            <span dir="ltr">{MoneyUtil.formatCurrency(row.due_amount)} {currency}</span>
          </Typography>
        ) : null,
    },
    {
      field: 'channel',
      headerName: t('orders.table.channel'),
      width: 110,
      sortable: false,
      type: 'singleSelect',
      valueOptions: CHANNELS.map((channel) => ({ value: channel, label: getChannelLabel(channel) })),
      filterOperators: selectFilters('channel'),
      renderCell: ({ row }) => <Chip label={getChannelLabel(row.channel)} size="small" variant="outlined" />,
    },
    {
      // Sent while the branch was closed by its hours. It still sold; this only marks it.
      field: 'after_hours',
      headerName: t('branchMgmt.orders.afterHours', 'After hours'),
      width: 120,
      sortable: false,
      type: 'singleSelect',
      valueGetter: (_value, row) => (row.after_hours ? 'yes' : 'no'),
      valueOptions: [
        { value: 'yes', label: t('branchMgmt.orders.afterHoursYes', 'After hours') },
        { value: 'no', label: t('branchMgmt.orders.afterHoursNo', 'In hours') },
      ],
      filterOperators: selectFilters('after_hours'),
      renderCell: ({ row }) =>
        row.after_hours ? (
          <Chip size="small" variant="outlined" label={t('branchMgmt.orders.afterHours', 'After hours')} />
        ) : null,
    } as GridColDef<OrderListRow>,
    {
      field: 'status',
      headerName: t('orders.table.status'),
      width: 120,
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
      width: readOnly ? 60 : 110,
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

  // Each role starts from the columns it works with; anyone can show or hide the rest, and
  // this device remembers that per role.
  const columnRole: ColumnRole = isHeadOffice ? 'headOffice' : isManagerOrAbove(userRole) ? 'manager' : 'cashier';
  const [columnChoices, setColumnChoices] = useState<Partial<Record<ColumnRole, GridColumnVisibilityModel>>>({});
  const columnVisibilityModel = useMemo<GridColumnVisibilityModel>(
    () => ({ ...DEFAULT_HIDDEN_COLUMNS[columnRole], ...(columnChoices[columnRole] ?? readColumnChoice(columnRole)) }),
    [columnRole, columnChoices]
  );
  const handleColumnVisibilityChange = (model: GridColumnVisibilityModel) => {
    setColumnChoices((prev) => ({ ...prev, [columnRole]: model }));
    saveColumnChoice(columnRole, model);
  };

  /**
   * The order's history, oldest first: its state changes, and the changes that are not a
   * state of their own (lines edited, type changed, table moved). The audit log records each
   * state change again, so those entries are left to the state events.
   */
  const timelineOf = (order: any) => {
    const actorNames: Record<string, string> = order.context?.actor_names || {};
    const nameOf = (id?: string | null) =>
      id ? actorNames[id] || t('orders.drawer.authenticatedUser') : t('orders.drawer.systemPos');
    const steps = [
      ...(order.stateEvents || []).map((evt: any, idx: number) => ({
        key: evt.id || `state-${idx}`,
        at: evt.occurred_at as string | undefined,
        label: evt.from_state ? getStateStepLabel(evt.to_state) : t('orders.drawer.orderTaken'),
        color: evt.from_state ? getStatusChipColor({ status: evt.to_state }) : 'default',
        actor: nameOf(evt.occurred_by),
        detail: null as string | null,
        reason: (evt.reason_text as string | null) || null,
        cancelled: evt.to_state === 'CANCELLED',
      })),
      ...orderAuditLogs
        .filter((log: any) => !STATE_AUDIT_ACTIONS.has(log.action))
        .map((log: any, idx: number) => ({
          key: log.id || `audit-${idx}`,
          at: log.occurred_at as string | undefined,
          label: AUDIT_EVENT_KEYS.includes(log.action)
            ? t(`orders.drawer.events.${log.action}`)
            : t('orders.drawer.events.other'),
          color: 'default',
          actor: nameOf(log.actor_id || log.user_id),
          detail:
            log.action === 'ORDER_TYPE_CHANGED' && log.details?.from && log.details?.to
              ? `${getOrderTypeLabel(log.details.from)} → ${getOrderTypeLabel(log.details.to)}`
              : null,
          reason: (log.details?.reason as string | null) || null,
          cancelled: false,
        })),
    ];
    return steps.sort((x, y) => new Date(x.at || 0).getTime() - new Date(y.at || 0).getTime());
  };
  const drawerTimeline = selectedDrawerOrder ? timelineOf(selectedDrawerOrder) : [];

  // The toolbar's search box is the `q` search, over order and call numbers, customers, notes and items.
  const gridFilterModel = useMemo<GridFilterModel>(
    () => ({ ...filterModel, quickFilterValues: query ? [query] : [] }),
    [filterModel, query]
  );
  const sortModel = useMemo<GridSortModel>(() => [{ field: sortField || 'placed_at', sort: sortDir }], [sortField, sortDir]);
  const menuPrimary = menuOrder && !readOnly ? primaryActionOf(menuOrder) : null;

  // Which orders: the tabs, on the grid's toolbar line beside the columns, filters and search.
  const tabsBar = (
    <Tabs
      onChange={(_, val) => setParams({ tab: val })}
      sx={{ minHeight: 48, minWidth: 0 }}
      value={TABS.some((x) => x.key === tab) ? tab : false}
      variant="scrollable"
      scrollButtons={false}
    >
      {TABS.map(({ key, label, color }) => (
        <Tab
          key={key}
          value={key}
          iconPosition="end"
          label={t(`orders.tabs.${label}`)}
          icon={
            <Label variant={key === tab ? 'filled' : 'soft'} color={key === 'ALL' && key === tab ? 'default' : color}>
              {counts[key] ?? 0}
            </Label>
          }
          sx={{ minHeight: 48 }}
        />
      ))}
    </Tabs>
  );

  return (
    <Box sx={{ pb: 6 }}>
      {/* Header Banner */}
      <Stack
        direction={{ md: 'row', xs: 'column' }}
        spacing={3}
        sx={{ alignItems: { md: 'center', xs: 'flex-start' }, justifyContent: 'space-between', mb: 3 }}
      >
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          {t('orders.title')}
        </Typography>

        {/* No refresh button: the list follows the branch live (useLiveRefresh below). */}
        {canExport && (
          <Button
            disabled={exporting || total === 0}
            onClick={handleExport}
            startIcon={exporting ? <CircularProgress size={16} /> : <DownloadIcon />}
            variant="outlined"
          >
            {t('orders.export')}
          </Button>
        )}
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

      {/* Orders waiting to be accepted are answered on Incoming Orders, not here. */}
      {!readOnly && (counts.WAITING ?? 0) > 0 && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => navigate(paths.app.orders.incoming)} sx={{ fontWeight: 700 }}>
              {t('orders.waiting.answer')}
            </Button>
          }
        >
          {t('orders.waiting.line', { count: counts.WAITING })}
        </Alert>
      )}

      <ServerDataGrid<OrderListRow>
        columns={columns}
        toolbarStart={tabsBar}
        columnVisibilityModel={columnVisibilityModel}
        onColumnVisibilityModelChange={handleColumnVisibilityChange}
        pinnedColumns={PINNED_COLUMNS}
        density="compact"
        emptyTitle={t('orders.table.empty')}
        emptyDescription={filterModel.items.length ? t('orders.table.emptyHint') : undefined}
        filterModel={gridFilterModel}
        onFilterModelChange={(model) => {
          // The grid also reports the model it was given; only a real change resets the page.
          const next = encodeFilterModel(model);
          const nextQuery = (model.quickFilterValues ?? []).join(' ').trim();
          const changes: Record<string, string | null> = {};
          if (next !== encodeFilterModel(filterModel)) Object.assign(changes, { f: next }, LEGACY_FILTER_PARAMS);
          if (nextQuery !== query) changes.q = nextQuery || null;
          if (Object.keys(changes).length) setParams(changes);
        }}
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
        quickFilterPlaceholder={t('orders.searchPlaceholder')}
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
        {menuOrder && hasReceipt(menuOrder) && (
          <MenuItem onClick={fromMenu((o) => handleViewReceipt(o.id))}>
            <ListItemIcon>
              <ReceiptIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('orders.actions.receipt')}</ListItemText>
          </MenuItem>
        )}
        {/* A held order has printed nothing yet. */}
        {!readOnly && menuOrder?.status !== 'DRAFT' && (
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
            <VersionTag feature="orders.snappfood" sx={{ ml: 1 }} />
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
          {t('orders.cancelDialog.title', { orderNumber: orderRefOf(selectedOrder, showOrderCode) })}
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
          {t('orders.snappfood.reportTitle', { orderNumber: orderRefOf(reportOrder, showOrderCode) })}
          <VersionTag feature="orders.snappfood" />
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
          {t('orders.reprintDialog.title', { orderNumber: orderRefOf(selectedOrder, showOrderCode) })}
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
                    <span dir="ltr">{MoneyUtil.formatCurrency(it.total_amount)} {currency}</span>
                  </Typography>
                </Stack>
              ))}

              <Typography sx={{ borderTop: 1, borderColor: 'divider', display: 'block', fontWeight: 700, mt: 1.5, pt: 1 }} variant="caption">
                <span dir="ltr">{t('orders.receiptModal.total')} {MoneyUtil.formatCurrency(receiptData.totals.total_amount)} {currency}</span>
              </Typography>
              <Typography color="success.main" sx={{ display: 'block', fontWeight: 700 }} variant="caption">
                <span dir="ltr">{t('orders.receiptModal.paid')} {MoneyUtil.formatCurrency(receiptData.totals.paid_amount)} {currency}</span>
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
              <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
                {/* The call number is what the guest hears; the order code is for looking it up. */}
                <Box sx={{ flexShrink: 0 }}>
                  <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
                    {selectedDrawerOrder.call_number || <bdi dir="ltr">{selectedDrawerOrder.order_number}</bdi>}
                  </Typography>
                  {selectedDrawerOrder.call_number && showOrderCode ? (
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                      <bdi dir="ltr">{selectedDrawerOrder.order_number}</bdi>
                    </Typography>
                  ) : null}
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, flexGrow: 1, pt: 0.5 }}>
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
                    {...typeChipMark(selectedDrawerOrder.order_type)}
                  />
                  {/* The till and Snappfood go without saying; the type chip already names Snappfood. */}
                  {(selectedDrawerOrder.channel === 'KIOSK' || selectedDrawerOrder.channel === 'ONLINE') && (
                    <Chip label={getChannelLabel(selectedDrawerOrder.channel)} size="small" variant="outlined" />
                  )}
                </Stack>
                <IconButton onClick={closeDrawer} size="small">
                  <CloseIcon />
                </IconButton>
              </Stack>

              <Typography variant="caption" color="text.secondary">
                {t('orders.drawer.placedOn', { date: selectedDrawerOrder.placed_at ? formatCalendarDateTime(selectedDrawerOrder.placed_at) : t('orders.drawer.justNow') })}
                {selectedDrawerOrder.table_number && ` • ${t('orders.drawer.table', { number: selectedDrawerOrder.table_number })}`}
              </Typography>
              {selectedDrawerOrder.table_number && <VersionTag feature="orders.table" sx={{ ml: 0.5 }} />}
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
                  label={t('orders.drawer.tabs.audit', { count: drawerTimeline.length })}
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
                      {guestNoteOf(selectedDrawerOrder) && (
                        <Grid size={{ xs: 12 }}>
                          <Typography variant="caption" color="text.secondary">{t('orders.drawer.specialInstructions')}</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 500, bgcolor: 'background.neutral', p: 1, borderRadius: 1, whiteSpace: 'pre-line' }}>
                            {guestNoteOf(selectedDrawerOrder)}
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
                                <span dir="ltr">{MoneyUtil.formatCurrency(item.total_amount || MoneyUtil.multiply(item.quantity, item.unit_price, 2))} {currency}</span>
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
                        <Typography variant="body2" dir="ltr">{MoneyUtil.formatCurrency(selectedDrawerOrder.status === 'DRAFT' ? displayTotalOf(selectedDrawerOrder) : selectedDrawerOrder.subtotal_amount || selectedDrawerOrder.total_amount)} {currency}</Typography>
                      </Stack>
                      {MoneyUtil.greaterThan(selectedDrawerOrder.discount_amount || '0', '0') && (
                        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="success.main">{t('orders.drawer.discountApplied')}</Typography>
                          <Typography variant="body2" color="success.main" dir="ltr">-{MoneyUtil.formatCurrency(selectedDrawerOrder.discount_amount)} {currency}</Typography>
                        </Stack>
                      )}
                      {MoneyUtil.greaterThan(selectedDrawerOrder.delivery_fee || '0', '0') && (
                        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="text.secondary">{t('orders.drawer.deliveryFee')}</Typography>
                          <Typography variant="body2" dir="ltr">+{MoneyUtil.formatCurrency(selectedDrawerOrder.delivery_fee)} {currency}</Typography>
                        </Stack>
                      )}
                      {MoneyUtil.greaterThan(selectedDrawerOrder.tax_amount || '0', '0') && (
                        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="text.secondary">{t('orders.drawer.vat')}</Typography>
                          <Typography variant="body2" dir="ltr">+{MoneyUtil.formatCurrency(selectedDrawerOrder.tax_amount)} {currency}</Typography>
                        </Stack>
                      )}
                      <Divider sx={{ my: 0.5 }} />
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{t('orders.drawer.grandTotal')}</Typography>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800, color: 'primary.main' }} dir="ltr">
                          {MoneyUtil.formatCurrency(displayTotalOf(selectedDrawerOrder))} {currency}
                        </Typography>
                      </Stack>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">{t('orders.drawer.paidAmount')}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: 'success.main' }} dir="ltr">
                          {MoneyUtil.formatCurrency(selectedDrawerOrder.paid_amount || '0')} {currency}
                        </Typography>
                      </Stack>
                      {MoneyUtil.greaterThan(selectedDrawerOrder.refunded_total || '0', '0') && (
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="body2" color="warning.main">{t('orders.drawer.refundedAmount')}</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: 'warning.main' }} dir="ltr">
                            -{MoneyUtil.formatCurrency(selectedDrawerOrder.refunded_total)} {currency}
                          </Typography>
                        </Stack>
                      )}
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">{t('orders.drawer.outstandingBalance')}</Typography>
                        {isSnappfoodOrder(selectedDrawerOrder) && selectedDrawerOrder.status !== 'CANCELLED' ? (
                          // Snappfood collects for its orders, so nothing is owed to the till.
                          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                            {t('orders.table.paidToSnappfood')}
                          </Typography>
                        ) : (
                          <Typography variant="body2" sx={{ fontWeight: 700, color: MoneyUtil.greaterThan(selectedDrawerOrder.due_amount || '0', '0') ? 'error.main' : 'success.main' }} dir="ltr">
                            {MoneyUtil.formatCurrency(selectedDrawerOrder.due_amount || '0')} {currency}
                          </Typography>
                        )}
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
                                  <span dir="ltr">{MoneyUtil.formatCurrency(payment.amount)} {currency}</span>
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
                                  -{MoneyUtil.formatCurrency(refund.total_refund_amount || refund.amount)} {currency}
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
                /* TAB 3: TIMELINE, one card per step: what happened, who did it, when and why. */
                drawerTimeline.length === 0 ? (
                  <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: 2 }}>
                    <HistoryIcon color="disabled" sx={{ fontSize: 40, mb: 1 }} />
                    <Typography variant="body2" color="text.secondary">
                      {t('orders.drawer.noEvents', { status: getOrderStatusLabel(selectedDrawerOrder.status, selectedDrawerOrder.refunded_total) })}
                    </Typography>
                  </Paper>
                ) : (
                  <Stack spacing={1.5}>
                    {drawerTimeline.map((step) => (
                      <Paper
                        key={step.key}
                        variant="outlined"
                        sx={{ p: 1.5, borderRadius: 2, borderColor: step.cancelled ? 'error.light' : 'divider' }}
                      >
                        <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                          <Chip label={step.label} color={step.color as any} size="small" sx={{ fontWeight: 700 }} />
                          <Typography variant="caption" color="text.secondary" dir="ltr">
                            {step.at ? formatCalendarDateTime(step.at) : t('orders.drawer.justNow')}
                          </Typography>
                        </Stack>
                        <Typography variant="body2" sx={{ mt: 1 }}>
                          {step.actor}
                          {step.detail ? <Box component="span" sx={{ color: 'text.secondary' }}> · {step.detail}</Box> : null}
                        </Typography>
                        {step.reason && (
                          <Typography
                            variant="body2"
                            color={step.cancelled ? 'error.main' : 'text.secondary'}
                            sx={{ fontWeight: 600, mt: 0.5 }}
                          >
                            {t('orders.drawer.reason', { reason: step.reason })}
                          </Typography>
                        )}
                      </Paper>
                    ))}
                  </Stack>
                )
              )}
            </Box>

            {/* Footer: the one thing to do next, and everything else under More, as on the row. */}
            {(() => {
              const order = selectedDrawerOrder;
              const primary = canResume(order)
                ? 'resume'
                : canPay(order)
                  ? 'pay'
                  : canComplete(order)
                    ? 'complete'
                    : canReport(order)
                      ? 'report'
                      : null;
              const more = [
                hasReceipt(order) && { key: 'receipt', icon: <ReceiptIcon fontSize="small" />, label: t('orders.actions.receipt'), run: () => handleViewReceipt(order.id) },
                !readOnly && order.status !== 'DRAFT' && { key: 'reprint', icon: <PrintIcon fontSize="small" />, label: t('orders.actions.reprint'), run: () => handleOpenReprintDialog(order) },
                // Snappfood's lines are Snappfood's: it has no call for a store to change them.
                canEditLines(order) && { key: 'edit', icon: <EditIcon fontSize="small" />, label: t('orders.actions.editOrder', 'Edit lines'), run: () => setEditDialogOpen(true) },
                canReport(order) && primary !== 'report' && { key: 'report', icon: <ScheduleIcon fontSize="small" />, label: t('orders.actions.reportToSnappfood'), run: () => handleOpenReport(order) },
                canChangeType(order) && {
                  key: 'type',
                  icon: <SwapHorizIcon fontSize="small" />,
                  label: t('orders.actions.changeType', 'Change type'),
                  run: () => {
                    closeDrawer();
                    handleOpenTypeDialog(order);
                  },
                },
              ].filter(Boolean) as Array<{ key: string; icon: React.ReactNode; label: string; run: () => void }>;
              const cancellable = canCancel(order);
              if (!primary && more.length === 0 && !cancellable) return null;
              return (
                <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', bgcolor: 'background.neutral' }}>
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    {(more.length > 0 || cancellable) && (
                      <Button
                        color="inherit"
                        variant="outlined"
                        endIcon={<MoreVertIcon />}
                        onClick={(e) => setDrawerMenuAnchor(e.currentTarget)}
                      >
                        {t('orders.actions.moreShort')}
                      </Button>
                    )}
                    {primary === 'pay' && (
                      <Button
                        color="success"
                        variant="contained"
                        startIcon={<PaymentIcon />}
                        onClick={() => {
                          closeDrawer();
                          handleOpenPayment(order);
                        }}
                      >
                        {t('orders.actions.pay')}
                      </Button>
                    )}
                    {primary === 'complete' && (
                      <Button
                        color="primary"
                        variant="contained"
                        startIcon={<DoneAllIcon />}
                        onClick={async () => {
                          if (await handleUpdateStatus(order.id, 'COMPLETED')) {
                            loadDrawerDetails(order.id);
                          }
                        }}
                      >
                        {t('orders.actions.completeOrder')}
                      </Button>
                    )}
                    {primary === 'resume' && (
                      <Button variant="contained" startIcon={<PointOfSaleIcon />} onClick={() => resumeAtTill(order)}>
                        {t('orders.actions.openAtTill')}
                      </Button>
                    )}
                    {primary === 'report' && (
                      <Button color="warning" variant="contained" startIcon={<ScheduleIcon />} onClick={() => handleOpenReport(order)}>
                        {t('orders.actions.reportToSnappfood')}
                      </Button>
                    )}
                  </Stack>
                  <Menu anchorEl={drawerMenuAnchor} open={!!drawerMenuAnchor} onClose={() => setDrawerMenuAnchor(null)}>
                    {more.map((item) => (
                      <MenuItem
                        key={item.key}
                        onClick={() => {
                          setDrawerMenuAnchor(null);
                          item.run();
                        }}
                      >
                        <ListItemIcon>{item.icon}</ListItemIcon>
                        <ListItemText>{item.label}</ListItemText>
                      </MenuItem>
                    ))}
                    {cancellable && more.length > 0 && <Divider />}
                    {cancellable && (
                      <MenuItem
                        onClick={() => {
                          setDrawerMenuAnchor(null);
                          closeDrawer();
                          handleOpenCancelDialog(order);
                        }}
                        sx={{ color: 'error.main' }}
                      >
                        <ListItemIcon>
                          <CancelIcon color="error" fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>{t('orders.actions.cancelOrder')}</ListItemText>
                      </MenuItem>
                    )}
                  </Menu>
                </Box>
              );
            })()}
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
              slotProps={{ input: { endAdornment: <VersionTag feature="orders.table" /> } }}
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
