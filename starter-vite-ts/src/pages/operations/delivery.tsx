import type { Courier, Delivery, DeliveryZone, CourierOnFile, DeliveryEvent, CourierPayMode } from 'src/api/deliveryApi';

import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import React, { useRef, useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import MapIcon from '@mui/icons-material/Map';
import EditIcon from '@mui/icons-material/Edit';
import UndoIcon from '@mui/icons-material/Undo';
import PersonIcon from '@mui/icons-material/Person';
import RefreshIcon from '@mui/icons-material/Refresh';
import HistoryIcon from '@mui/icons-material/History';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import {
  Box,
  Tab,
  Card,
  Tabs,
  Chip,
  Grid,
  Link,
  Table,
  Stack,
  Alert,
  Paper,
  Button,
  Dialog,
  Select,
  Divider,
  Tooltip,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  InputLabel,
  DialogTitle,
  FormControl,
  CardContent,
  DialogContent,
  DialogActions,
  LinearProgress,
  CircularProgress,
} from '@mui/material';

import { paths } from 'src/routes/paths';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';
import { useLiveRefresh } from 'src/utils/use-live-refresh';
import { useCurrencyCode, useCurrencyLabel } from 'src/utils/currency';

import { tenantApi } from 'src/api/tenantApi';
import { settingsApi } from 'src/api/settingsApi';
import { canReachPath } from 'src/config/role-access';
import { useBranchContext } from 'src/contexts/branch-context';
import { deliveryApi, COURIER_PAY_MODES } from 'src/api/deliveryApi';
import { useAuthStore, useIsHeadOffice } from 'src/store/useAuthStore';

import { CourierSettlementsPage } from './settlements';

type DeliveryTab = 'BOARD' | 'COURIERS' | 'SETTLEMENTS' | 'ZONES' | 'AUDIT';

/**
 * Each tab is a place you can be sent to, bookmark, or come back to with the browser's back
 * button, so the address bar has to follow the tabs rather than only seed them.
 */
const TAB_PATHS: Record<DeliveryTab, string> = {
  BOARD: '/app/delivery/orders',
  COURIERS: '/app/delivery/couriers',
  SETTLEMENTS: '/app/delivery/settlements',
  ZONES: '/app/delivery/zones',
  AUDIT: '/app/delivery/audit',
};

function tabFromPathname(pathname: string): DeliveryTab {
  const found = (Object.keys(TAB_PATHS) as DeliveryTab[]).find(
    (key) => key !== 'BOARD' && pathname.startsWith(TAB_PATHS[key]),
  );
  return found ?? 'BOARD';
}

/**
 * What a dispatcher reads off a card: the number the counter calls, who the order is for and
 * where it goes, and how long it has waited since it was sent, in red once past the zone's
 * estimate. Every card used to say "Customer", with no address or phone.
 */
function DispatchDetails({ delivery, now }: { delivery: Delivery; now: number }) {
  const { t } = useTranslation();
  const address = delivery.address_snapshot?.address_text;
  const since = delivery.submitted_at || delivery.created_at;
  const minutes = since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000)) : null;
  const estimate = delivery.zone_estimated_minutes ?? null;
  const late = minutes !== null && estimate !== null && minutes > estimate;

  return (
    <Stack spacing={0.5} sx={{ my: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {delivery.call_number != null && (
          <Chip size="small" label={t('delivery.card.callNumber', { number: delivery.call_number })} />
        )}
        {minutes !== null && (
          <Tooltip title={late ? t('delivery.card.waitingLate', { minutes: estimate }) : ''}>
            <Chip
              size="small"
              color={late ? 'error' : 'default'}
              variant={late ? 'filled' : 'outlined'}
              label={t('delivery.card.waiting', { minutes })}
            />
          </Tooltip>
        )}
      </Stack>
      <Typography variant="body2">
        {t('delivery.card.customer')}: <strong>{delivery.customer_name || t('delivery.card.noCustomer')}</strong>
        {delivery.customer_phone && (
          <>
            {' · '}
            <span dir="ltr">{delivery.customer_phone}</span>
          </>
        )}
      </Typography>
      {address && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {address}
        </Typography>
      )}
    </Stack>
  );
}

export function DeliveryPage() {
  const currencyLabel = useCurrencyLabel();
  const currency = useCurrencyCode();
  const { t } = useTranslation();
  // A cashier checks couriers in and out at the counter; taking one onto the roster is the
  // manager's (the API refuses a register account).
  const role = useAuthStore((state) => state.user?.role);
  const isCashier = role?.toUpperCase() === 'CASHIER';
  const isHeadOfficeAccount = useIsHeadOffice();
  // The same table the router applies: a cashier was offered Zones and Audit, and clicking
  // either swapped the whole page for "Not available for your role".
  const canOpenTab = (key: DeliveryTab) => canReachPath(role, TAB_PATHS[key], isHeadOfficeAccount);
  const location = useLocation();
  const navigate = useNavigate();

  const [tab, setTab] = useState<DeliveryTab>(() => tabFromPathname(location.pathname));

  useEffect(() => {
    setTab(tabFromPathname(location.pathname));
  }, [location.pathname]);

  const goToTab = (next: DeliveryTab) => {
    setTab(next);
    if (!location.pathname.startsWith(TAB_PATHS[next])) navigate(TAB_PATHS[next]);
  };

  // Everything on this page is one branch's: the header's. Head office inside Downtown sees
  // Downtown's board, not the chain's deliveries mixed together.
  const { selectedBranchId } = useBranchContext();
  const branchId = selectedBranchId || undefined;
  const branchRef = useRef(branchId);
  branchRef.current = branchId;
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [terminals, setTerminals] = useState<any[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<DeliveryEvent[]>([]);
  const [_eventDeliveryId, setEventDeliveryId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  // The waiting time on each card moves on between refreshes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [courierOnFile, setCourierOnFile] = useState<CourierOnFile | null>(null);

  // Dialogs
  const [assignCourierModalOpen, setAssignCourierModalOpen] = useState(false);
  const [selectedDeliveryForAssign, setSelectedDeliveryForAssign] = useState<Delivery | null>(null);
  const [selectedCourierId, setSelectedCourierId] = useState('');

  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [selectedDeliveryForComplete, setSelectedDeliveryForComplete] = useState<Delivery | null>(null);

  const [failModalOpen, setFailModalOpen] = useState(false);
  const [selectedDeliveryForFail, setSelectedDeliveryForFail] = useState<Delivery | null>(null);
  const [failReason, setFailReason] = useState('');

  const [courierModalOpen, setCourierModalOpen] = useState(false);
  const [defaultPayMode, setDefaultPayMode] = useState<CourierPayMode>('FLAT');
  const emptyCourierForm = (payMode: CourierPayMode) => ({
    code: '',
    name: '',
    phone: '',
    vehicle_type: 'MOTORCYCLE',
    pay_mode: payMode,
    compensation_per_delivery: '400000',
  });
  const [courierForm, setCourierForm] = useState(() => emptyCourierForm('FLAT'));
  const [payEdit, setPayEdit] = useState<{ courier: Courier; pay_mode: CourierPayMode; amount: string } | null>(null);

  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const [zoneForm, setZoneForm] = useState({ code: '', name: '', fee: '500000', estimated_minutes: 30, courier_pay: '' });
  const [zoneEdit, setZoneEdit] = useState<{
    zone: DeliveryZone;
    name: string;
    fee: string;
    estimated_minutes: number;
    courier_pay: string;
  } | null>(null);
  const [zoneRemoveAsked, setZoneRemoveAsked] = useState(false);

  const [terminalAssignModalOpen, setTerminalAssignModalOpen] = useState(false);
  const [selectedCourierForTerminal, setSelectedCourierForTerminal] = useState<Courier | null>(null);
  const [selectedTerminalId, setSelectedTerminalId] = useState('');

  // `quiet` is for pushed refreshes: the board updates in place instead of flashing a loading state.
  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [delList, courList, znList, termList] = await Promise.all([
        deliveryApi.getDeliveries(branchId),
        deliveryApi.getCouriers(branchId),
        deliveryApi.getZones(branchId),
        tenantApi.getTerminals(branchId).catch(() => []),
      ]);
      // A poll that left before the header switched branch must not repaint the new one.
      if (branchRef.current !== branchId) return;
      setDeliveries(delList);
      setCouriers(courList);
      setZones(znList);
      setTerminals(termList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('delivery.errors.loadFailed'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [branchId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useLiveRefresh(['delivery'], () => loadData(true), branchId);

  useEffect(() => {
    setSelectedEvents([]);
    setNotice(null);
  }, [branchId]);

  // The pay rule a new courier starts on is the branch's COURIER_PAY default.
  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getScopedSettings(branchId)
      .then((scoped: any) => {
        const mode = scoped?.groups?.COURIER_PAY?.value?.defaultPayMode;
        if (!cancelled) setDefaultPayMode((COURIER_PAY_MODES as readonly string[]).includes(mode) ? mode : 'FLAT');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  const openAddCourier = () => {
    setCourierForm(emptyCourierForm(defaultPayMode));
    setCourierModalOpen(true);
  };

  const handleSavePay = async () => {
    if (!payEdit) return;
    try {
      setPendingAction(`pay:${payEdit.courier.id}`);
      await deliveryApi.updateCourierPay(payEdit.courier.id, {
        pay_mode: payEdit.pay_mode,
        compensation_per_delivery: payEdit.amount || '0',
      });
      setPayEdit(null);
      await loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.updatePayFailed'));
    } finally {
      setPendingAction(null);
    }
  };

  const handleSaveZone = async () => {
    if (!zoneEdit) return;
    try {
      setPendingAction(`zone:${zoneEdit.zone.id}`);
      await deliveryApi.updateZone(zoneEdit.zone.id, {
        name: zoneEdit.name,
        fee: zoneEdit.fee || '0',
        estimated_minutes: zoneEdit.estimated_minutes,
        courier_pay: zoneEdit.courier_pay.trim() === '' ? null : zoneEdit.courier_pay,
      });
      setZoneEdit(null);
      await loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.updateZoneFailed'));
    } finally {
      setPendingAction(null);
    }
  };

  // Removal is a soft delete: the zone leaves the POS picker, and orders placed in it keep it.
  const handleRemoveZone = async () => {
    if (!zoneEdit) return;
    try {
      setPendingAction(`zone:${zoneEdit.zone.id}`);
      await deliveryApi.deleteZone(zoneEdit.zone.id);
      setZoneEdit(null);
      await loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.deleteZoneFailed'));
    } finally {
      setPendingAction(null);
    }
  };

  /** A pay rule picker with the rule's meaning underneath, shared by the add and edit dialogs. */
  const renderPayModeSelect = (value: CourierPayMode, onChange: (mode: CourierPayMode) => void) => (
    <TextField
      select
      fullWidth
      label={t('delivery.modals.addCourier.payMode')}
      value={value}
      onChange={(e) => onChange(e.target.value as CourierPayMode)}
      helperText={`${t(`delivery.payRules.help_${value}`)} ${t('delivery.payRules.tipsNote')}`}
    >
      {COURIER_PAY_MODES.map((mode) => (
        <MenuItem key={mode} value={mode}>
          {t(`delivery.payRules.${mode}`)}
        </MenuItem>
      ))}
    </TextField>
  );

  /** The amount field only a rule that uses it shows: FLAT pays it, ZONE_RATE falls back to it. */
  const renderPayAmount = (mode: CourierPayMode, value: string, onChange: (amount: string) => void) =>
    mode === 'DELIVERY_FEE' ? null : (
      <TextField
        fullWidth
        label={t(mode === 'FLAT' ? 'delivery.modals.addCourier.compensationFlat' : 'delivery.modals.addCourier.compensationFallback', { currency: currencyLabel })}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
      />
    );

  const handleOpenAssignModal = (del: Delivery) => {
    setSelectedDeliveryForAssign(del);
    setSelectedCourierId('');
    setAssignCourierModalOpen(true);
  };

  const handleAssignCourier = async () => {
    if (!selectedDeliveryForAssign || !selectedCourierId) return;
    try {
      setPendingAction(`assign:${selectedDeliveryForAssign.id}`);
      await deliveryApi.assignCourier(selectedDeliveryForAssign.id, selectedCourierId);
      setAssignCourierModalOpen(false);
      await loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('delivery.errors.assignFailed'));
    } finally {
      setPendingAction(null);
    }
  };

  const handleDepartDelivery = async (delId: string) => {
    try {
      setPendingAction(`depart:${delId}`);
      await deliveryApi.departDelivery(delId);
      await loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.departFailed'));
    } finally {
      setPendingAction(null);
    }
  };

  const handleOpenCompleteModal = (del: Delivery) => {
    setSelectedDeliveryForComplete(del);
    setCompleteModalOpen(true);
  };

  // What the customer still owed when the order left. Completing only marks it delivered:
  // how the customer paid — card on the courier's reader, cash, or both — is not known
  // until the courier is back, so it is entered on the settlement from the card slip.
  const owedOnDelivery = selectedDeliveryForComplete?.outstanding_total ?? selectedDeliveryForComplete?.grand_total ?? '0';

  const handleCompleteDelivery = async () => {
    if (!selectedDeliveryForComplete) return;
    try {
      setPendingAction(`complete:${selectedDeliveryForComplete.id}`);
      await deliveryApi.completeDelivery(selectedDeliveryForComplete.id);
      setCompleteModalOpen(false);
      await loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.completeFailed'));
    } finally {
      setPendingAction(null);
    }
  };

  const handleOpenFailModal = (del: Delivery) => {
    setSelectedDeliveryForFail(del);
    setFailReason('');
    setFailModalOpen(true);
  };

  const handleFailDelivery = async () => {
    if (!selectedDeliveryForFail || !failReason) return;
    try {
      setPendingAction(`fail:${selectedDeliveryForFail.id}`);
      await deliveryApi.failDelivery(selectedDeliveryForFail.id, failReason);
      setFailModalOpen(false);
      await loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.failFailed'));
    } finally {
      setPendingAction(null);
    }
  };

  const handleRequeueDelivery = async (delId: string) => {
    try {
      setPendingAction(`requeue:${delId}`);
      await deliveryApi.requeueDelivery(delId);
      await loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.requeueFailed'));
    } finally {
      setPendingAction(null);
    }
  };

  const handleRecordAttendance = async (courierId: string, status: 'CHECKED_IN' | 'CHECKED_OUT' | 'PAUSED') => {
    try {
      const targetBranchId = branchId;
      if (!targetBranchId) {
        setError(t('delivery.errors.noBranch'));
        return;
      }
      await deliveryApi.recordAttendance({
        courier_id: courierId,
        branch_id: targetBranchId,
        status,
      });
      loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.attendanceFailed'));
    }
  };

  const handleSetAvailability = async (courierId: string, availability: 'AVAILABLE' | 'BUSY' | 'OFF_LINE') => {
    try {
      await deliveryApi.setAvailability(courierId, availability);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.availabilityFailed'));
    }
  };

  const handleCreateCourier = async () => {
    try {
      const targetBranchId = branchId;
      if (!targetBranchId) {
        setError(t('delivery.errors.noBranch'));
        return;
      }
      await deliveryApi.createCourier({
        branch_id: targetBranchId,
        ...courierForm,
        compensation_per_delivery: courierForm.compensation_per_delivery.toString(),
      });
      setCourierModalOpen(false);
      setCourierForm(emptyCourierForm(defaultPayMode));
      loadData();
    } catch (err: any) {
      // Somebody already on file — here archived, or at another branch. Offer the move
      // rather than a second record for the same person.
      if (err?.code === 'COURIER_EXISTS' && err?.context?.courier) {
        setCourierModalOpen(false);
        setCourierOnFile(err.context.courier as CourierOnFile);
        return;
      }
      setError(err.detail || t('delivery.errors.createCourierFailed'));
    }
  };

  const handleMoveCourier = async () => {
    if (!courierOnFile) return;
    try {
      setPendingAction(`move:${courierOnFile.id}`);
      await deliveryApi.moveCourier(courierOnFile.id, branchId);
      setNotice(t('delivery.modals.moveCourier.moved', { name: courierOnFile.name }));
      setCourierOnFile(null);
      setCourierForm(emptyCourierForm(defaultPayMode));
      await loadData();
    } catch (err: any) {
      setCourierOnFile(null);
      setError(err.detail || t('delivery.errors.moveCourierFailed'));
    } finally {
      setPendingAction(null);
    }
  };

  const handleCreateZone = async () => {
    try {
      const targetBranchId = branchId;
      if (!targetBranchId) {
        setError(t('delivery.errors.noBranch'));
        return;
      }
      await deliveryApi.createZone({
        branch_id: targetBranchId,
        ...zoneForm,
        fee: zoneForm.fee.toString(),
        // Blank means "use each courier's own rate"; an empty string fails the amount check.
        courier_pay: zoneForm.courier_pay.trim() === '' ? null : zoneForm.courier_pay,
      });
      setZoneModalOpen(false);
      setZoneForm({ code: '', name: '', fee: '500000', estimated_minutes: 30, courier_pay: '' });
      loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.createZoneFailed'));
    }
  };

  const handleAssignTerminal = async () => {
    if (!selectedCourierForTerminal || !selectedTerminalId) return;
    try {
      await deliveryApi.assignTerminal(selectedCourierForTerminal.id, selectedTerminalId);
      setTerminalAssignModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.assignTerminalFailed'));
    }
  };

  const handleUnassignTerminal = async (courierId: string) => {
    try {
      await deliveryApi.unassignTerminal(courierId);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.unassignTerminalFailed'));
    }
  };

  const handleViewEvents = async (delId: string) => {
    try {
      const events = await deliveryApi.getEvents(delId);
      setSelectedEvents(events);
      setEventDeliveryId(delId);
      goToTab('AUDIT');
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.timelineFailed'));
    }
  };

  const getDeliveryStateLabel = (state?: string) => {
    switch (state) {
      case 'UNASSIGNED':
        return t('delivery.states.unassigned');
      case 'ASSIGNED':
        return t('delivery.states.assigned');
      case 'PICKED_UP':
        return t('delivery.states.pickedUp');
      case 'EN_ROUTE':
        return t('delivery.states.enRoute');
      case 'DELIVERED':
        return t('delivery.states.delivered');
      case 'FAILED':
        return t('delivery.states.failed');
      case 'CANCELLED':
        return t('delivery.states.cancelled');
      default:
        return state || '';
    }
  };

  const getVehicleTypeLabel = (vType?: string) => {
    switch (vType) {
      case 'MOTORCYCLE':
        return t('delivery.couriers.vehicleTypes.motorcycle');
      case 'BICYCLE':
        return t('delivery.couriers.vehicleTypes.bicycle');
      case 'CAR':
        return t('delivery.couriers.vehicleTypes.car');
      case 'ON_FOOT':
        return t('delivery.couriers.vehicleTypes.onFoot');
      default:
        return vType || '';
    }
  };

  const getAttendanceStatusLabel = (att?: string) => {
    switch (att) {
      case 'CHECKED_IN':
        return t('delivery.couriers.attendanceStatus.checkedIn');
      case 'CHECKED_OUT':
        return t('delivery.couriers.attendanceStatus.checkedOut');
      case 'PAUSED':
        return t('delivery.couriers.attendanceStatus.paused');
      default:
        return att || t('delivery.couriers.attendanceStatus.checkedOut');
    }
  };

  const unassigned = deliveries.filter((d) => d.state === 'UNASSIGNED');
  const assigned = deliveries.filter((d) => d.state === 'ASSIGNED');
  const enRoute = deliveries.filter((d) => d.state === 'PICKED_UP' || d.state === 'EN_ROUTE');
  const finished = deliveries.filter((d) => d.state === 'DELIVERED' || d.state === 'FAILED' || d.state === 'CANCELLED');

  const eligibleCouriers = couriers.filter(
    (c) => c.attendance?.status === 'CHECKED_IN' && c.attendance?.availability_status === 'AVAILABLE' && (c.active_delivery_count || 0) < 5
  );

  return (
    <Box sx={{ p: 3 }} aria-busy={loading || Boolean(pendingAction)}>
      <Alert severity="info" variant="filled" icon={<LocalShippingIcon />} sx={{ mb: 3, fontWeight: 'bold' }}>
        {t('delivery.banner')}
      </Alert>

      {/* Header */}
      <Stack direction="row" sx={{ mb: 3, justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
            {t('delivery.title')} <LocalShippingIcon color="primary" />
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('delivery.subtitle')}
          </Typography>
        </Box>

        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Button
            variant="outlined"
            disabled={loading || Boolean(pendingAction)}
            startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <RefreshIcon />}
            onClick={() => loadData()}
          >
            {loading ? t('delivery.refreshing') : t('delivery.refresh')}
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 3 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {(loading || pendingAction) && <LinearProgress sx={{ mb: 2 }} />}

      <Paper sx={{ mb: 3, borderRadius: 2 }}>
        <Tabs value={tab} onChange={(_, val) => goToTab(val)}>
          {[
            <Tab key="BOARD" label={`${t('delivery.tabs.board')} (${deliveries.length})`} value="BOARD" icon={<LocalShippingIcon />} iconPosition="start" />,
            <Tab key="COURIERS" label={`${t('delivery.tabs.couriers')} (${couriers.length})`} value="COURIERS" icon={<PersonIcon />} iconPosition="start" />,
            <Tab key="SETTLEMENTS" label={t('delivery.tabs.settlements')} value="SETTLEMENTS" icon={<ReceiptLongIcon />} iconPosition="start" />,
            <Tab key="ZONES" label={`${t('delivery.tabs.zones')} (${zones.length})`} value="ZONES" icon={<MapIcon />} iconPosition="start" />,
            <Tab key="AUDIT" label={t('delivery.tabs.audit')} value="AUDIT" icon={<HistoryIcon />} iconPosition="start" />,
          ].filter((item) => canOpenTab(item.key as DeliveryTab))}
        </Tabs>
      </Paper>

      {/* BOARD TAB */}
      {tab === 'BOARD' && (
        <Grid container spacing={3}>
          {/* UNASSIGNED */}
          <Grid size={{ xs: 12, md: 3 }}>
            <Paper sx={{ p: 2, bg: '#fafafa', borderRadius: 2, minHeight: 600 }}>
              <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" color="info.main" sx={{ fontWeight: 'bold' }}>
                  {t('delivery.columns.unassigned')} ({unassigned.length})
                </Typography>
                <Chip label={t('delivery.columns.needsCourier')} color="info" size="small" />
              </Stack>
              <Divider sx={{ mb: 2 }} />

              <Stack spacing={2}>
                {unassigned.map((del) => (
                  <Card key={del.id} elevation={2} sx={{ borderRadius: 2 }}>
                    <CardContent sx={{ p: 2 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                        {t('delivery.card.order')} #{del.order_number}
                      </Typography>
                      <DispatchDetails delivery={del} now={now} />
                      <Typography variant="body2" color="text.secondary">
                        {t('delivery.card.zone')}: {del.zone_name} | {t('delivery.card.fee')}: {MoneyUtil.formatCurrency(del.fee)} {del.currency_code}
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', mt: 1 }}>
                        {t('delivery.card.total')}: {MoneyUtil.formatCurrency(del.grand_total)} {del.currency_code}
                      </Typography>

                      <Stack direction="row" sx={{ pt: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                        {/* The timeline opens on the Audit tab, which a cashier cannot reach. */}
                        {canOpenTab('AUDIT') ? (
                          <IconButton size="small" onClick={() => handleViewEvents(del.id)}>
                            <HistoryIcon fontSize="small" />
                          </IconButton>
                        ) : (
                          <span />
                        )}
                        <Button variant="contained" size="small" onClick={() => handleOpenAssignModal(del)}>
                          {t('delivery.card.assignCourier')}
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Paper>
          </Grid>

          {/* ASSIGNED */}
          <Grid size={{ xs: 12, md: 3 }}>
            <Paper sx={{ p: 2, bg: '#fafafa', borderRadius: 2, minHeight: 600 }}>
              <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" color="warning.main" sx={{ fontWeight: 'bold' }}>
                  {t('delivery.columns.assigned')} ({assigned.length})
                </Typography>
                <Chip label={t('delivery.columns.readyToDepart')} color="warning" size="small" />
              </Stack>
              <Divider sx={{ mb: 2 }} />

              <Stack spacing={2}>
                {assigned.map((del) => (
                  <Card key={del.id} elevation={2} sx={{ borderRadius: 2 }}>
                    <CardContent sx={{ p: 2 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                        {t('delivery.card.order')} #{del.order_number}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('delivery.card.courier')}: <strong>{del.courier_name}</strong>
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                        {t('delivery.card.phone')}: {del.courier_phone || t('delivery.card.noPhone')}
                      </Typography>
                      <DispatchDetails delivery={del} now={now} />

                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Button
                          variant="contained"
                          color="warning"
                          size="small"
                          disabled={Boolean(pendingAction)}
                          startIcon={pendingAction === `depart:${del.id}` ? <CircularProgress size={16} color="inherit" /> : <LocalShippingIcon />}
                          onClick={() => handleDepartDelivery(del.id)}
                        >
                          {pendingAction === `depart:${del.id}` ? t('delivery.card.departing') : t('delivery.card.depart')}
                        </Button>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => handleOpenAssignModal(del)}
                        >
                          {t('delivery.card.reassign')}
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Paper>
          </Grid>

          {/* EN_ROUTE */}
          <Grid size={{ xs: 12, md: 3 }}>
            <Paper sx={{ p: 2, bg: '#fafafa', borderRadius: 2, minHeight: 600 }}>
              <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" color="info.main" sx={{ fontWeight: 'bold' }}>
                  {t('delivery.columns.enRoute')} ({enRoute.length})
                </Typography>
                <Chip label={t('delivery.columns.outForDelivery')} color="info" size="small" />
              </Stack>
              <Divider sx={{ mb: 2 }} />

              <Stack spacing={2}>
                {enRoute.map((del) => (
                  <Card key={del.id} elevation={2} sx={{ borderRadius: 2 }}>
                    <CardContent sx={{ p: 2 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                        {t('delivery.card.order')} #{del.order_number}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('delivery.card.courier')}: <strong>{del.courier_name}</strong>
                      </Typography>
                      <DispatchDetails delivery={del} now={now} />

                      <Stack spacing={0.5} sx={{ my: 1 }}>
                        {/* The expected cash and card figures are only written when the run is
                            completed; until then what the rider must bring back is what the
                            customer still owes. */}
                        <Typography variant="caption" sx={{ fontWeight: 700 }}>
                          {t('delivery.card.toCollect', 'To collect')}: {MoneyUtil.formatCurrency((del as any).outstanding_total || '0')} {currency}
                        </Typography>
                      </Stack>

                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', pt: 1 }}>
                        <Button
                          variant="contained"
                          color="success"
                          size="small"
                          disabled={Boolean(pendingAction)}
                          onClick={() => handleOpenCompleteModal(del)}
                        >
                          {t('delivery.card.complete')}
                        </Button>
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
                          disabled={Boolean(pendingAction)}
                          onClick={() => handleOpenFailModal(del)}
                        >
                          {t('delivery.card.failed')}
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Paper>
          </Grid>

          {/* DELIVERED / TERMINAL */}
          <Grid size={{ xs: 12, md: 3 }}>
            <Paper sx={{ p: 2, bg: '#fafafa', borderRadius: 2, minHeight: 600 }}>
              <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" color="success.main" sx={{ fontWeight: 'bold' }}>
                  {t('delivery.columns.history')} ({finished.length})
                </Typography>
                <Chip label={t('delivery.columns.terminal')} size="small" />
              </Stack>
              <Divider sx={{ mb: 2 }} />

              <Stack spacing={2}>
                {finished.map((del) => (
                  <Card key={del.id} elevation={1} sx={{ borderRadius: 2 }}>
                    <CardContent sx={{ p: 2 }}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                          {t('delivery.card.order')} #{del.order_number}
                        </Typography>
                        <Chip
                          label={getDeliveryStateLabel(del.state)}
                          color={del.state === 'DELIVERED' ? 'success' : 'error'}
                          size="small"
                        />
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        {t('delivery.card.courier')}: {del.courier_name} | {t('delivery.card.compensation')}: {MoneyUtil.formatCurrency(del.compensation_amount)} {currency}
                      </Typography>

                      {del.state === 'FAILED' && (
                        <Button
                          variant="outlined"
                          size="small"
                          color="warning"
                          disabled={Boolean(pendingAction)}
                          startIcon={pendingAction === `requeue:${del.id}` ? <CircularProgress size={16} color="inherit" /> : <UndoIcon />}
                          onClick={() => handleRequeueDelivery(del.id)}
                          sx={{ mt: 1 }}
                        >
                          {t('delivery.card.requeue')}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Paper>
          </Grid>
        </Grid>
      )}

      {/* COURIERS TAB */}
      {tab === 'COURIERS' && (
        <Card sx={{ p: 3, borderRadius: 2 }}>
          <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>{t('delivery.couriers.title')} ({couriers.length})</Typography>
            {!isCashier && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={openAddCourier}>
                {t('delivery.couriers.addCourier')}
              </Button>
            )}
          </Stack>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('delivery.couriers.code')}</TableCell>
                <TableCell>{t('delivery.couriers.nameAndPhone')}</TableCell>
                <TableCell>{t('delivery.couriers.vehicle')}</TableCell>
                <TableCell>{t('delivery.couriers.compensationPerDelivery')}</TableCell>
                <TableCell>{t('delivery.couriers.attendance')}</TableCell>
                <TableCell>{t('delivery.couriers.availability')}</TableCell>
                <TableCell>{t('delivery.couriers.mobilePosAssignment')}</TableCell>
                <TableCell>{t('delivery.couriers.activeLoad')}</TableCell>
                <TableCell align="right">{t('delivery.couriers.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {couriers.map((c) => {
                const isCheckedIn = c.attendance?.status === 'CHECKED_IN';
                return (
                  <TableRow key={c.id}>
                    <TableCell><strong>{c.code}</strong></TableCell>
                    <TableCell>
                      <Link
                        component="button"
                        variant="subtitle2"
                        onClick={() => navigate(paths.app.delivery.courierDetail(c.id))}
                        sx={{ fontWeight: 'bold', display: 'block' }}
                      >
                        {c.name}
                      </Link>
                      <Typography variant="caption" color="text.secondary">{c.phone || t('delivery.card.noPhone')}</Typography>
                    </TableCell>
                    <TableCell><Chip label={getVehicleTypeLabel(c.vehicle_type)} size="small" /></TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Box>
                          <Typography variant="body2">{t(`delivery.payRules.${c.pay_mode || 'FLAT'}`)}</Typography>
                          {c.pay_mode !== 'DELIVERY_FEE' && (
                            <Typography variant="caption" color="text.secondary">
                              {t(c.pay_mode === 'ZONE_RATE' ? 'delivery.payRules.zoneFallback' : 'delivery.payRules.flatAmount', {
                                amount: `${MoneyUtil.formatCurrency(c.compensation_per_delivery || '0')} ${currency}`,
                              })}
                            </Typography>
                          )}
                        </Box>
                        {!isCashier && (
                          <IconButton
                            size="small"
                            aria-label={t('delivery.couriers.editPay')}
                            onClick={() =>
                              setPayEdit({
                                courier: c,
                                pay_mode: (c.pay_mode || 'FLAT') as CourierPayMode,
                                amount: String(Number(c.compensation_per_delivery || 0)),
                              })
                            }
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={getAttendanceStatusLabel(c.attendance?.status)}
                        color={isCheckedIn ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        size="small"
                        value={c.attendance?.availability_status || 'OFF_LINE'}
                        disabled={!isCheckedIn}
                        onChange={(e) => handleSetAvailability(c.id, e.target.value as any)}
                        sx={{ fontSize: '0.8125rem', py: 0 }}
                      >
                        <MenuItem value="AVAILABLE">{t('delivery.couriers.availabilityStatus.available')}</MenuItem>
                        <MenuItem value="BUSY">{t('delivery.couriers.availabilityStatus.busy')}</MenuItem>
                        <MenuItem value="OFF_LINE">{t('delivery.couriers.availabilityStatus.offline')}</MenuItem>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {c.active_terminal ? (
                        <Chip
                          icon={<PhoneAndroidIcon />}
                          label={c.active_terminal.terminal_name}
                          color="secondary"
                          size="small"
                          onDelete={() => handleUnassignTerminal(c.id)}
                        />
                      ) : (
                        <Button size="small" variant="outlined" onClick={() => { setSelectedCourierForTerminal(c); setTerminalAssignModalOpen(true); }}>
                          {t('delivery.couriers.assignPos')}
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip label={`${c.active_delivery_count || 0} / 5`} color={(c.active_delivery_count || 0) >= 5 ? 'error' : 'default'} size="small" />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        {!isCheckedIn ? (
                          <Button size="small" variant="contained" color="success" onClick={() => handleRecordAttendance(c.id, 'CHECKED_IN')}>
                            {t('delivery.couriers.checkIn')}
                          </Button>
                        ) : (
                          <Button size="small" variant="outlined" color="error" onClick={() => handleRecordAttendance(c.id, 'CHECKED_OUT')}>
                            {t('delivery.couriers.checkOut')}
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* SETTLEMENTS TAB */}
      {tab === 'SETTLEMENTS' && (
        <Box>
          <CourierSettlementsPage hideHeader />
        </Box>
      )}

      {/* ZONES TAB */}
      {tab === 'ZONES' && (
        <Card sx={{ p: 3, borderRadius: 2 }}>
          <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>{t('delivery.zones.title')} ({zones.length})</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setZoneModalOpen(true)}>
              {t('delivery.zones.addZone')}
            </Button>
          </Stack>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('delivery.zones.code')}</TableCell>
                <TableCell>{t('delivery.zones.zoneName')}</TableCell>
                <TableCell>{t('delivery.zones.standardFee')}</TableCell>
                <TableCell>{t('delivery.zones.courierPay')}</TableCell>
                <TableCell>{t('delivery.zones.estimatedMinutes')}</TableCell>
                <TableCell>{t('delivery.zones.status')}</TableCell>
                <TableCell align="right">{t('delivery.zones.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {zones.map((z) => (
                <TableRow key={z.id}>
                  <TableCell><strong>{z.code}</strong></TableCell>
                  <TableCell>{z.name}</TableCell>
                  <TableCell>{MoneyUtil.formatCurrency(z.fee)} {z.currency_code}</TableCell>
                  <TableCell>
                    {z.courier_pay !== null && z.courier_pay !== undefined ? (
                      `${MoneyUtil.formatCurrency(z.courier_pay)} ${z.currency_code}`
                    ) : (
                      <Typography variant="caption" color="text.secondary">{t('delivery.zones.courierPayUnset')}</Typography>
                    )}
                  </TableCell>
                  <TableCell>{z.estimated_minutes} {t('delivery.zones.mins')}</TableCell>
                  <TableCell><Chip label={z.is_active ? t('delivery.zones.active') : t('delivery.zones.inactive')} color="success" size="small" /></TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      aria-label={t('delivery.zones.edit')}
                      onClick={() => {
                        setZoneRemoveAsked(false);
                        setZoneEdit({
                          zone: z,
                          name: z.name,
                          fee: String(Number(z.fee || 0)),
                          estimated_minutes: z.estimated_minutes,
                          courier_pay: z.courier_pay !== null && z.courier_pay !== undefined ? String(Number(z.courier_pay)) : '',
                        });
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* AUDIT TAB */}
      {tab === 'AUDIT' && (
        <Card sx={{ p: 3, borderRadius: 2 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
            {t('delivery.audit.title')} ({selectedEvents.length})
          </Typography>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('delivery.audit.timestamp')}</TableCell>
                <TableCell>{t('delivery.audit.fromState')}</TableCell>
                <TableCell>{t('delivery.audit.toState')}</TableCell>
                <TableCell>{t('delivery.audit.reason')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {selectedEvents.map((ev) => (
                <TableRow key={ev.id}>
                  <TableCell>{fDateTime(ev.occurred_at)}</TableCell>
                  <TableCell><Chip label={getDeliveryStateLabel(ev.from_state)} size="small" /></TableCell>
                  <TableCell><Chip label={getDeliveryStateLabel(ev.to_state)} color="primary" size="small" /></TableCell>
                  <TableCell>{ev.reason || t('delivery.audit.stateTransition')}</TableCell>
                </TableRow>
              ))}
              {selectedEvents.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                    {t('delivery.audit.empty')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Assign Courier Modal */}
      <Dialog open={assignCourierModalOpen} onClose={() => setAssignCourierModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('delivery.modals.assignCourier.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t('delivery.modals.assignCourier.description', { orderNumber: selectedDeliveryForAssign?.order_number })}
          </Typography>
          <FormControl fullWidth>
            <InputLabel>{t('delivery.modals.assignCourier.eligibleCourier')}</InputLabel>
            <Select value={selectedCourierId} label={t('delivery.modals.assignCourier.eligibleCourier')} onChange={(e) => setSelectedCourierId(e.target.value)}>
              {eligibleCouriers.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name} ({getVehicleTypeLabel(c.vehicle_type)}) - {c.active_delivery_count || 0}/5 active
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {eligibleCouriers.length === 0 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {t('delivery.modals.assignCourier.noEligible')}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignCourierModalOpen(false)}>{t('delivery.modals.assignCourier.cancel')}</Button>
          <Button variant="contained" disabled={!selectedCourierId || Boolean(pendingAction)} onClick={handleAssignCourier}>
            {pendingAction?.startsWith('assign:') ? <CircularProgress size={20} color="inherit" /> : t('delivery.modals.assignCourier.submit')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Complete Delivery Modal */}
      <Dialog open={completeModalOpen} onClose={() => setCompleteModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('delivery.modals.complete.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">
              {t('delivery.modals.complete.description', { orderNumber: selectedDeliveryForComplete?.order_number })}
            </Typography>
            <Typography variant="body2">
              {t('delivery.modals.complete.owedLabel')}: <strong>{MoneyUtil.formatCurrency(owedOnDelivery)} {currency}</strong>
            </Typography>
            <Alert severity="info">{t('delivery.modals.complete.settleNote')}</Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompleteModalOpen(false)}>{t('delivery.modals.complete.cancel')}</Button>
          <Button variant="contained" color="success" disabled={Boolean(pendingAction)} onClick={handleCompleteDelivery}>
            {pendingAction?.startsWith('complete:') ? <CircularProgress size={20} color="inherit" /> : t('delivery.modals.complete.submit')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Fail Delivery Modal */}
      <Dialog open={failModalOpen} onClose={() => setFailModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('delivery.modals.fail.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t('delivery.modals.fail.reasonLabel')}
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
              fullWidth
              multiline
              rows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFailModalOpen(false)}>{t('delivery.modals.fail.cancel')}</Button>
          <Button variant="contained" color="error" disabled={Boolean(pendingAction)} onClick={handleFailDelivery}>
            {pendingAction?.startsWith('fail:') ? <CircularProgress size={20} color="inherit" /> : t('delivery.modals.fail.submit')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Courier Modal */}
      <Dialog open={courierModalOpen} onClose={() => setCourierModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('delivery.modals.addCourier.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label={t('delivery.modals.addCourier.code')} value={courierForm.code} onChange={(e) => setCourierForm({ ...courierForm, code: e.target.value })} fullWidth />
            <TextField label={t('delivery.modals.addCourier.name')} value={courierForm.name} onChange={(e) => setCourierForm({ ...courierForm, name: e.target.value })} fullWidth />
            <TextField
              required
              label={t('delivery.modals.addCourier.phone')}
              value={courierForm.phone}
              onChange={(e) => setCourierForm({ ...courierForm, phone: e.target.value })}
              helperText={t('delivery.modals.addCourier.phoneHelp')}
              slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'tel' } }}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>{t('delivery.modals.addCourier.vehicleType')}</InputLabel>
              <Select value={courierForm.vehicle_type} label={t('delivery.modals.addCourier.vehicleType')} onChange={(e) => setCourierForm({ ...courierForm, vehicle_type: e.target.value })}>
                <MenuItem value="MOTORCYCLE">{t('delivery.couriers.vehicleTypes.motorcycle')}</MenuItem>
                <MenuItem value="BICYCLE">{t('delivery.couriers.vehicleTypes.bicycle')}</MenuItem>
                <MenuItem value="CAR">{t('delivery.couriers.vehicleTypes.car')}</MenuItem>
                <MenuItem value="ON_FOOT">{t('delivery.couriers.vehicleTypes.onFoot')}</MenuItem>
              </Select>
            </FormControl>
            {renderPayModeSelect(courierForm.pay_mode, (mode) => setCourierForm({ ...courierForm, pay_mode: mode }))}
            {renderPayAmount(courierForm.pay_mode, courierForm.compensation_per_delivery, (amount) =>
              setCourierForm({ ...courierForm, compensation_per_delivery: amount })
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCourierModalOpen(false)}>{t('delivery.modals.addCourier.cancel')}</Button>
          <Button
            variant="contained"
            disabled={!courierForm.code.trim() || !courierForm.name.trim() || !courierForm.phone.trim()}
            onClick={handleCreateCourier}
          >
            {t('delivery.modals.addCourier.submit')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Courier Already On File */}
      <Dialog open={Boolean(courierOnFile)} onClose={() => setCourierOnFile(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('delivery.modals.moveCourier.title')}</DialogTitle>
        <DialogContent>
          {courierOnFile && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">
                {courierOnFile.branch_id === branchId
                  ? t('delivery.modals.moveCourier.descriptionHere', { name: courierOnFile.name, code: courierOnFile.code })
                  : t('delivery.modals.moveCourier.description', {
                      name: courierOnFile.name,
                      code: courierOnFile.code,
                      branch: courierOnFile.branch_name || t('delivery.modals.moveCourier.otherBranch'),
                    })}
              </Typography>
              {courierOnFile.branch_id !== branchId && (
                <Alert severity="info">{t('delivery.modals.moveCourier.unsettledNote')}</Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCourierOnFile(null)}>{t('delivery.modals.moveCourier.cancel')}</Button>
          {courierOnFile && (courierOnFile.branch_id !== branchId || !courierOnFile.is_active) && (
            <Button variant="contained" disabled={Boolean(pendingAction)} onClick={handleMoveCourier}>
              {pendingAction?.startsWith('move:') ? (
                <CircularProgress size={20} color="inherit" />
              ) : courierOnFile.branch_id === branchId ? (
                t('delivery.modals.moveCourier.restore')
              ) : (
                t('delivery.modals.moveCourier.submit')
              )}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Courier Pay Rule */}
      <Dialog open={Boolean(payEdit)} onClose={() => setPayEdit(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('delivery.modals.courierPay.title', { name: payEdit?.courier.name })}</DialogTitle>
        <DialogContent>
          {payEdit && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              {renderPayModeSelect(payEdit.pay_mode, (mode) => setPayEdit({ ...payEdit, pay_mode: mode }))}
              {renderPayAmount(payEdit.pay_mode, payEdit.amount, (amount) => setPayEdit({ ...payEdit, amount }))}
              <Alert severity="info">{t('delivery.modals.courierPay.note')}</Alert>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayEdit(null)}>{t('delivery.modals.courierPay.cancel')}</Button>
          <Button variant="contained" disabled={Boolean(pendingAction)} onClick={handleSavePay}>
            {pendingAction?.startsWith('pay:') ? <CircularProgress size={20} color="inherit" /> : t('delivery.modals.courierPay.submit')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Zone */}
      <Dialog open={Boolean(zoneEdit)} onClose={() => setZoneEdit(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('delivery.modals.editZone.title', { code: zoneEdit?.zone.code })}</DialogTitle>
        <DialogContent>
          {zoneEdit && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField label={t('delivery.modals.addZone.name')} value={zoneEdit.name} onChange={(e) => setZoneEdit({ ...zoneEdit, name: e.target.value })} fullWidth />
              <TextField
                label={t('delivery.modals.addZone.fee', { currency: currencyLabel })}
                value={zoneEdit.fee}
                onChange={(e) => setZoneEdit({ ...zoneEdit, fee: e.target.value })}
                slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
                fullWidth
              />
              <TextField
                label={t('delivery.modals.addZone.courierPay', { currency: currencyLabel })}
                helperText={t('delivery.modals.addZone.courierPayHelp')}
                value={zoneEdit.courier_pay}
                onChange={(e) => setZoneEdit({ ...zoneEdit, courier_pay: e.target.value })}
                slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
                fullWidth
              />
              <TextField
                label={t('delivery.modals.addZone.estimatedMinutes')}
                type="number"
                value={zoneEdit.estimated_minutes}
                onChange={(e) => setZoneEdit({ ...zoneEdit, estimated_minutes: Number(e.target.value) })}
                fullWidth
              />
              {zoneRemoveAsked && (
                <Alert
                  severity="warning"
                  action={
                    <Stack direction="row" spacing={1}>
                      <Button size="small" onClick={() => setZoneRemoveAsked(false)}>{t('delivery.modals.editZone.removeNo')}</Button>
                      <Button size="small" color="error" variant="contained" disabled={Boolean(pendingAction)} onClick={handleRemoveZone}>
                        {t('delivery.modals.editZone.removeYes')}
                      </Button>
                    </Stack>
                  }
                >
                  {t('delivery.modals.editZone.removeConfirm', { code: zoneEdit.zone.code })}
                </Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button color="error" disabled={zoneRemoveAsked || Boolean(pendingAction)} onClick={() => setZoneRemoveAsked(true)} sx={{ mr: 'auto' }}>
            {t('delivery.modals.editZone.remove')}
          </Button>
          <Button onClick={() => setZoneEdit(null)}>{t('delivery.modals.editZone.cancel')}</Button>
          <Button variant="contained" disabled={Boolean(pendingAction) || !zoneEdit?.name.trim()} onClick={handleSaveZone}>
            {pendingAction?.startsWith('zone:') ? <CircularProgress size={20} color="inherit" /> : t('delivery.modals.editZone.submit')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Zone Modal */}
      <Dialog open={zoneModalOpen} onClose={() => setZoneModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('delivery.modals.addZone.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label={t('delivery.modals.addZone.code')} value={zoneForm.code} onChange={(e) => setZoneForm({ ...zoneForm, code: e.target.value })} fullWidth />
            <TextField label={t('delivery.modals.addZone.name')} value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })} fullWidth />
            <TextField label={t('delivery.modals.addZone.fee', { currency: currencyLabel })} value={zoneForm.fee} onChange={(e) => setZoneForm({ ...zoneForm, fee: e.target.value })} fullWidth />
            <TextField
              label={t('delivery.modals.addZone.courierPay', { currency: currencyLabel })}
              helperText={t('delivery.modals.addZone.courierPayHelp')}
              value={zoneForm.courier_pay}
              onChange={(e) => setZoneForm({ ...zoneForm, courier_pay: e.target.value })}
              slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
              fullWidth
            />
            <TextField label={t('delivery.modals.addZone.estimatedMinutes')} type="number" value={zoneForm.estimated_minutes} onChange={(e) => setZoneForm({ ...zoneForm, estimated_minutes: Number(e.target.value) })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setZoneModalOpen(false)}>{t('delivery.modals.addZone.cancel')}</Button>
          <Button variant="contained" onClick={handleCreateZone}>{t('delivery.modals.addZone.submit')}</Button>
        </DialogActions>
      </Dialog>

      {/* Assign Terminal Modal */}
      <Dialog open={terminalAssignModalOpen} onClose={() => setTerminalAssignModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('delivery.modals.assignTerminal.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t('delivery.modals.assignTerminal.description', { courierName: selectedCourierForTerminal?.name })}
          </Typography>
          <FormControl fullWidth>
            <InputLabel>{t('delivery.modals.assignTerminal.terminal')}</InputLabel>
            <Select value={selectedTerminalId} label={t('delivery.modals.assignTerminal.terminal')} onChange={(e) => setSelectedTerminalId(e.target.value)}>
              {terminals.map((tm) => (
                <MenuItem key={tm.id} value={tm.id}>{tm.name || tm.code} ({tm.serial_number || 'Mobile POS'})</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTerminalAssignModalOpen(false)}>{t('delivery.modals.assignTerminal.cancel')}</Button>
          <Button variant="contained" onClick={handleAssignTerminal}>{t('delivery.modals.assignTerminal.submit')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
