import type { Courier, Delivery, DeliveryZone, CourierOnFile, DeliveryEvent } from 'src/api/deliveryApi';

import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import React, { lazy, useRef, useState, Suspense, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import MapIcon from '@mui/icons-material/Map';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import PersonIcon from '@mui/icons-material/Person';
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
import { orderRefOf, useShowsOrderCode } from 'src/utils/order-ref';
import { toToman, fromToman, useCurrencyLabel } from 'src/utils/currency';

import { tenantApi } from 'src/api/tenantApi';
import { deliveryApi } from 'src/api/deliveryApi';
import { canReachPath } from 'src/config/role-access';
import { useBranchContext } from 'src/contexts/branch-context';
import { useAuthStore, useIsHeadOffice } from 'src/store/useAuthStore';

import { VersionTag } from 'src/components/version-tag';

import { CourierSettlementsPage } from './settlements';

type DeliveryTab = 'BOARD' | 'COURIERS' | 'SETTLEMENTS' | 'ZONES' | 'AUDIT';

// The map and its drawing tools only load when zones are on screen.
const ZoneMap = lazy(() => import('src/components/zone-map').then((m) => ({ default: m.ZoneMap })));

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

/** "12 دقیقه", "2 ساعت و 5 دقیقه", "3 روز": raw minutes read as nonsense past an hour. */
function formatElapsed(minutes: number, t: (key: string, options?: any) => string) {
  if (minutes < 60) return t('delivery.card.elapsedMinutes', { n: minutes });
  if (minutes < 24 * 60) return t('delivery.card.elapsedHours', { h: Math.floor(minutes / 60), m: minutes % 60 });
  return t('delivery.card.elapsedDays', { n: Math.floor(minutes / (24 * 60)) });
}

/**
 * One card for both columns, in the order a cashier reads it: the number the counter calls,
 * how long it has been, who it is for and where, who has it, and what to bring back. A waiting
 * order counts from when it was placed; an order that is out counts from when it left.
 */
function DeliveryCard({
  delivery,
  now,
  currency,
  children,
}: {
  delivery: Delivery;
  now: number;
  currency: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const showOrderCode = useShowsOrderCode();
  const out = delivery.state !== 'UNASSIGNED';
  const address = delivery.address_snapshot?.address_text;
  const since = (out && delivery.picked_up_at) || delivery.submitted_at || delivery.created_at;
  const minutes = since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000)) : null;
  const estimate = delivery.zone_estimated_minutes ?? null;
  const late = minutes !== null && estimate !== null && minutes > estimate;
  const toCollect = delivery.outstanding_total ?? delivery.grand_total ?? '0';

  return (
    <Card elevation={2} sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 2 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
              {delivery.call_number != null
                ? t('delivery.card.callNumber', { number: delivery.call_number })
                : t('delivery.card.order')}
            </Typography>
            {/* A cashier goes by the call number; the code (Latin, isolated from the RTL line) is
                for managers, or when the order has no call number. */}
            {(showOrderCode || delivery.call_number == null) && (
              <Typography variant="caption" color="text.secondary" component="div">
                <bdi dir="ltr">{delivery.order_number}</bdi>
              </Typography>
            )}
          </Box>
          {minutes !== null && (
            <Tooltip title={late ? t('delivery.card.waitingLate', { minutes: estimate }) : ''}>
              <Chip
                size="small"
                color={late ? 'error' : 'default'}
                variant={late ? 'filled' : 'outlined'}
                label={formatElapsed(minutes, t)}
              />
            </Tooltip>
          )}
        </Stack>

        <Stack spacing={0.5} sx={{ my: 1.5 }}>
          <Typography variant="body2">
            <strong>{delivery.customer_name || t('delivery.card.noCustomer')}</strong>
            {delivery.customer_phone && (
              <>
                {' · '}
                <bdi dir="ltr">{delivery.customer_phone}</bdi>
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
          {!out && delivery.zone_name && (
            <Typography variant="caption" color="text.secondary">
              {delivery.zone_name} · {t('delivery.card.fee')} {MoneyUtil.formatCurrency(delivery.fee)} {currency}
            </Typography>
          )}
          {out && (
            <Typography variant="body2">
              {t('delivery.card.courier')}:{' '}
              {delivery.courier_id ? (
                <>
                  <strong>{delivery.courier_name}</strong>
                  {delivery.courier_phone && (
                    <>
                      {' · '}
                      <bdi dir="ltr">{delivery.courier_phone}</bdi>
                    </>
                  )}
                </>
              ) : (
                <Box component="strong" sx={{ color: 'warning.main' }}>
                  {t('delivery.card.noCourier')}
                </Box>
              )}
            </Typography>
          )}
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {t('delivery.card.toCollect')}: {MoneyUtil.formatCurrency(toCollect)} {currency}
          </Typography>
        </Stack>

        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {children}
        </Stack>
      </CardContent>
    </Card>
  );
}

export function DeliveryPage() {
  const currencyLabel = useCurrencyLabel();
  const currency = useCurrencyLabel();
  const { t } = useTranslation();
  const showOrderCode = useShowsOrderCode();
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
  // Couriers are on a salary, so a new one carries no pay of their own (FLAT at zero).
  const emptyCourierForm = () => ({ code: '', name: '', phone: '', vehicle_type: 'MOTORCYCLE' });
  const [courierForm, setCourierForm] = useState(emptyCourierForm);

  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const emptyZoneForm = () => ({ code: '', name: '', fee: '500000', estimated_minutes: 30, polygon: null as DeliveryZone['polygon'] });
  const [zoneForm, setZoneForm] = useState(emptyZoneForm);
  const [zoneEdit, setZoneEdit] = useState<{
    zone: DeliveryZone;
    name: string;
    fee: string;
    estimated_minutes: number;
    polygon: DeliveryZone['polygon'];
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

  const openAddCourier = () => {
    setCourierForm(emptyCourierForm());
    setCourierModalOpen(true);
  };

  const handleSaveZone = async () => {
    if (!zoneEdit) return;
    try {
      setPendingAction(`zone:${zoneEdit.zone.id}`);
      await deliveryApi.updateZone(zoneEdit.zone.id, {
        name: zoneEdit.name,
        fee: zoneEdit.fee || '0',
        estimated_minutes: zoneEdit.estimated_minutes,
        polygon: zoneEdit.polygon ?? null,
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

  const handleOpenAssignModal = (del: Delivery) => {
    setSelectedDeliveryForAssign(del);
    setSelectedCourierId('');
    setAssignCourierModalOpen(true);
  };

  const handleAssignCourier = async () => {
    if (!selectedDeliveryForAssign || !selectedCourierId) return;
    try {
      setPendingAction(`assign:${selectedDeliveryForAssign.id}`);
      await deliveryApi.dispatchCourier(selectedDeliveryForAssign.id, selectedCourierId);
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

  const handleCreateCourier = async () => {
    try {
      const targetBranchId = branchId;
      if (!targetBranchId) {
        setError(t('delivery.errors.noBranch'));
        return;
      }
      await deliveryApi.createCourier({ branch_id: targetBranchId, ...courierForm });
      setCourierModalOpen(false);
      setCourierForm(emptyCourierForm());
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
      setCourierForm(emptyCourierForm());
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
      });
      setZoneModalOpen(false);
      setZoneForm(emptyZoneForm());
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

  // The board holds open deliveries only: a failed ride goes back to waiting by itself, and
  // finished ones live in Orders and settlements, so a history column here never filled.
  const unassigned = deliveries.filter((d) => d.state === 'UNASSIGNED');
  const enRoute = deliveries.filter((d) => d.state === 'ASSIGNED' || d.state === 'PICKED_UP' || d.state === 'EN_ROUTE');

  const eligibleCouriers = couriers.filter(
    (c) => c.attendance?.status === 'CHECKED_IN' && c.id !== selectedDeliveryForAssign?.courier_id
  );
  // The same dialog sends an order out and, once it is out with a rider, swaps that rider.
  const changingCourier = Boolean(
    selectedDeliveryForAssign && selectedDeliveryForAssign.state !== 'UNASSIGNED' && selectedDeliveryForAssign.courier_id
  );

  return (
    <Box sx={{ p: 3 }} aria-busy={loading || Boolean(pendingAction)}>

      {/* Header. No refresh button: the board is pushed live (useLiveRefresh), with a poll as backup. */}
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
        {t('delivery.title')} <LocalShippingIcon color="primary" />
      </Typography>

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
            <Tab
              key="AUDIT"
              label={
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  <span>{t('delivery.tabs.audit')}</span>
                  <VersionTag feature="delivery.audit" />
                </Stack>
              }
              value="AUDIT"
              icon={<HistoryIcon />}
              iconPosition="start"
            />,
          ].filter((item) => canOpenTab(item.key as DeliveryTab))}
        </Tabs>
      </Paper>

      {/* BOARD TAB */}
      {tab === 'BOARD' && (
        <Grid container spacing={3}>
          {/* WAITING FOR A COURIER */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper sx={{ p: 2, borderRadius: 2, minHeight: 600 }}>
              <Typography variant="h6" color="info.main" sx={{ fontWeight: 'bold', mb: 2 }}>
                {t('delivery.columns.unassigned')} ({unassigned.length})
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Stack spacing={2}>
                {unassigned.map((del) => (
                  <DeliveryCard key={del.id} delivery={del} now={now} currency={currency}>
                    {/* The timeline opens on the Audit tab, which a cashier cannot reach. */}
                    {canOpenTab('AUDIT') && (
                      <IconButton size="small" onClick={() => handleViewEvents(del.id)}>
                        <HistoryIcon fontSize="small" />
                      </IconButton>
                    )}
                    <Button variant="contained" size="small" onClick={() => handleOpenAssignModal(del)} sx={{ ml: 'auto' }}>
                      {t('delivery.card.assignCourier')}
                    </Button>
                  </DeliveryCard>
                ))}
              </Stack>
            </Paper>
          </Grid>

          {/* OUT FOR DELIVERY — naming the courier sends the order out, so there is no "assigned" stop. */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper sx={{ p: 2, borderRadius: 2, minHeight: 600 }}>
              <Typography variant="h6" color="info.main" sx={{ fontWeight: 'bold', mb: 2 }}>
                {t('delivery.columns.enRoute')} ({enRoute.length})
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Stack spacing={2}>
                {enRoute.map((del) => (
                  <DeliveryCard key={del.id} delivery={del} now={now} currency={currency}>
                    {!del.courier_id ? (
                      // Moved out from the order without a rider: name one before anything else.
                      <Button variant="contained" size="small" onClick={() => handleOpenAssignModal(del)}>
                        {t('delivery.card.assignCourier')}
                      </Button>
                    ) : del.state === 'ASSIGNED' ? (
                      // Named before the board went to one step, or the send-out did not go
                      // through: the rider has not left yet.
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
                    ) : (
                      <>
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
                      </>
                    )}
                    {del.courier_id && (
                      <Button
                        size="small"
                        disabled={Boolean(pendingAction)}
                        onClick={() => handleOpenAssignModal(del)}
                        sx={{ ml: 'auto' }}
                      >
                        {t('delivery.card.reassign')}
                      </Button>
                    )}
                  </DeliveryCard>
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
            {/* A cashier adds a courier too; their pay is still the manager's. */}
            <Button variant="contained" startIcon={<AddIcon />} onClick={openAddCourier}>
              {t('delivery.couriers.addCourier')}
            </Button>
          </Stack>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('delivery.couriers.code')}</TableCell>
                <TableCell>{t('delivery.couriers.nameAndPhone')}</TableCell>
                <TableCell>{t('delivery.couriers.mobilePosAssignment')}</TableCell>
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
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        {/* The one switch for a courier: green, they are working today and take
                            deliveries; grey, they are not. Tapping it changes it. */}
                        <Button
                          size="small"
                          variant={isCheckedIn ? 'contained' : 'outlined'}
                          color={isCheckedIn ? 'success' : 'inherit'}
                          aria-pressed={isCheckedIn}
                          startIcon={isCheckedIn ? <CheckIcon /> : undefined}
                          onClick={() => handleRecordAttendance(c.id, isCheckedIn ? 'CHECKED_OUT' : 'CHECKED_IN')}
                          sx={isCheckedIn ? undefined : { color: 'text.secondary' }}
                        >
                          {t('delivery.couriers.checkIn')}
                        </Button>
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

          <Suspense fallback={<Box sx={{ height: 320 }} />}>
            <ZoneMap zones={zones.map((z) => ({ id: z.id, name: z.name, polygon: z.polygon }))} sx={{ mb: 3 }} />
          </Suspense>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('delivery.zones.code')}</TableCell>
                <TableCell>{t('delivery.zones.zoneName')}</TableCell>
                <TableCell>{t('delivery.zones.standardFee')}</TableCell>
                <TableCell>{t('delivery.zones.estimatedMinutes')}</TableCell>
                <TableCell>{t('delivery.zones.mapColumn')}</TableCell>
                <TableCell>{t('delivery.zones.status')}</TableCell>
                <TableCell align="right">{t('delivery.zones.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {zones.map((z) => (
                <TableRow key={z.id}>
                  <TableCell><strong>{z.code}</strong></TableCell>
                  <TableCell>{z.name}</TableCell>
                  <TableCell>{MoneyUtil.formatCurrency(z.fee)} {currency}</TableCell>
                  <TableCell>{z.estimated_minutes} {t('delivery.zones.mins')}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={z.polygon ? 'primary' : 'default'}
                      label={z.polygon ? t('delivery.zones.drawn') : t('delivery.zones.notDrawn')}
                    />
                  </TableCell>
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
                          polygon: z.polygon ?? null,
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
        <DialogTitle>{changingCourier ? t('delivery.card.reassign') : t('delivery.modals.assignCourier.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t(changingCourier ? 'delivery.modals.assignCourier.changeDescription' : 'delivery.modals.assignCourier.description', {
              orderNumber: orderRefOf(selectedDeliveryForAssign, showOrderCode),
            })}
          </Typography>
          <FormControl fullWidth>
            <InputLabel>{t('delivery.modals.assignCourier.eligibleCourier')}</InputLabel>
            <Select value={selectedCourierId} label={t('delivery.modals.assignCourier.eligibleCourier')} onChange={(e) => setSelectedCourierId(e.target.value)}>
              {eligibleCouriers.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}{c.active_delivery_count ? ` (${c.active_delivery_count})` : ''}
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
            {pendingAction?.startsWith('assign:') ? (
              <CircularProgress size={20} color="inherit" />
            ) : (
              t(changingCourier ? 'delivery.modals.assignCourier.changeSubmit' : 'delivery.modals.assignCourier.submit')
            )}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Complete Delivery Modal */}
      <Dialog open={completeModalOpen} onClose={() => setCompleteModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('delivery.modals.complete.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">
              {t('delivery.modals.complete.description', { orderNumber: orderRefOf(selectedDeliveryForComplete, showOrderCode) })}
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
        <DialogTitle>
          {t('delivery.modals.moveCourier.title')} <VersionTag feature="delivery.moveCourier" />
        </DialogTitle>
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
          {/* Moving a courier between branches, or bringing one back, stays the manager's. */}
          {courierOnFile && !isCashier && (courierOnFile.branch_id !== branchId || !courierOnFile.is_active) && (
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

      {/* Edit Zone */}
      <Dialog open={Boolean(zoneEdit)} onClose={() => setZoneEdit(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('delivery.modals.editZone.title', { code: zoneEdit?.zone.code })}</DialogTitle>
        <DialogContent>
          {zoneEdit && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField label={t('delivery.modals.addZone.name')} value={zoneEdit.name} onChange={(e) => setZoneEdit({ ...zoneEdit, name: e.target.value })} fullWidth />
              <TextField
                label={t('delivery.modals.addZone.fee', { currency: currencyLabel })}
                value={toToman(zoneEdit.fee)}
                onChange={(e) => setZoneEdit({ ...zoneEdit, fee: fromToman(e.target.value) })}
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
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  {t('delivery.modals.addZone.mapHelp')}
                </Typography>
                <Suspense fallback={<Box sx={{ height: 280 }} />}>
                  <ZoneMap
                    height={280}
                    zones={zones.map((z) => ({ id: z.id, name: z.name, polygon: z.polygon }))}
                    editing={{
                      id: zoneEdit.zone.id,
                      polygon: zoneEdit.zone.polygon ?? null,
                      onChange: (polygon) => setZoneEdit((prev) => (prev ? { ...prev, polygon } : prev)),
                    }}
                  />
                </Suspense>
              </Box>
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
      <Dialog open={zoneModalOpen} onClose={() => setZoneModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('delivery.modals.addZone.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label={t('delivery.modals.addZone.code')} value={zoneForm.code} onChange={(e) => setZoneForm({ ...zoneForm, code: e.target.value })} fullWidth />
            <TextField label={t('delivery.modals.addZone.name')} value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })} fullWidth />
            <TextField label={t('delivery.modals.addZone.fee', { currency: currencyLabel })} value={toToman(zoneForm.fee)} onChange={(e) => setZoneForm({ ...zoneForm, fee: fromToman(e.target.value) })} fullWidth />
            <TextField label={t('delivery.modals.addZone.estimatedMinutes')} type="number" value={zoneForm.estimated_minutes} onChange={(e) => setZoneForm({ ...zoneForm, estimated_minutes: Number(e.target.value) })} fullWidth />
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {t('delivery.modals.addZone.mapHelp')}
              </Typography>
              {zoneModalOpen && (
                <Suspense fallback={<Box sx={{ height: 280 }} />}>
                  <ZoneMap
                    height={280}
                    zones={zones.map((z) => ({ id: z.id, name: z.name, polygon: z.polygon }))}
                    editing={{ polygon: null, onChange: (polygon) => setZoneForm((prev) => ({ ...prev, polygon })) }}
                  />
                </Suspense>
              )}
            </Box>
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
