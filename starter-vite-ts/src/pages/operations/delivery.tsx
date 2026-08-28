import type { Branch } from 'src/api/tenantApi';
import type { Courier, Delivery, DeliveryZone, DeliveryEvent } from 'src/api/deliveryApi';

import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import MapIcon from '@mui/icons-material/Map';
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
  Table,
  Stack,
  Alert,
  Paper,
  Button,
  Dialog,
  Select,
  Divider,
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
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';

import { useBranchContext } from 'src/contexts/branch-context';

import { tenantApi } from 'src/api/tenantApi';
import { deliveryApi } from 'src/api/deliveryApi';

import { CourierSettlementsPage } from './settlements';

export function DeliveryPage() {
  const { t } = useTranslation();
  const location = useLocation();

  const getInitialTab = (): 'BOARD' | 'COURIERS' | 'SETTLEMENTS' | 'ZONES' | 'AUDIT' => {
    if (location.pathname.includes('/settlements')) return 'SETTLEMENTS';
    if (location.pathname.includes('/couriers')) return 'COURIERS';
    if (location.pathname.includes('/zones')) return 'ZONES';
    if (location.pathname.includes('/audit')) return 'AUDIT';
    return 'BOARD';
  };

  const [tab, setTab] = useState<'BOARD' | 'COURIERS' | 'SETTLEMENTS' | 'ZONES' | 'AUDIT'>(getInitialTab);

  useEffect(() => {
    if (location.pathname.includes('/settlements')) setTab('SETTLEMENTS');
    else if (location.pathname.includes('/couriers')) setTab('COURIERS');
    else if (location.pathname.includes('/zones')) setTab('ZONES');
    else if (location.pathname.includes('/audit')) setTab('AUDIT');
  }, [location.pathname]);

  const { selectedBranchId, branches } = useBranchContext();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [terminals, setTerminals] = useState<any[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<DeliveryEvent[]>([]);
  const [_eventDeliveryId, setEventDeliveryId] = useState<string | null>(null);

  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialogs
  const [assignCourierModalOpen, setAssignCourierModalOpen] = useState(false);
  const [selectedDeliveryForAssign, setSelectedDeliveryForAssign] = useState<Delivery | null>(null);
  const [selectedCourierId, setSelectedCourierId] = useState('');

  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [selectedDeliveryForComplete, setSelectedDeliveryForComplete] = useState<Delivery | null>(null);
  const [cashCollected, setCashCollected] = useState<string>('0');
  const [posAmount, setPosAmount] = useState<string>('0');

  const [failModalOpen, setFailModalOpen] = useState(false);
  const [selectedDeliveryForFail, setSelectedDeliveryForFail] = useState<Delivery | null>(null);
  const [failReason, setFailReason] = useState('');

  const [courierModalOpen, setCourierModalOpen] = useState(false);
  const [courierForm, setCourierForm] = useState({ code: '', name: '', phone: '', vehicle_type: 'MOTORCYCLE', compensation_per_delivery: '15000' });

  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const [zoneForm, setZoneForm] = useState({ code: '', name: '', fee: '25000', estimated_minutes: 30 });

  const [terminalAssignModalOpen, setTerminalAssignModalOpen] = useState(false);
  const [selectedCourierForTerminal, setSelectedCourierForTerminal] = useState<Courier | null>(null);
  const [selectedTerminalId, setSelectedTerminalId] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [delList, courList, znList, termList] = await Promise.all([
        deliveryApi.getDeliveries(),
        deliveryApi.getCouriers(),
        deliveryApi.getZones(),
        tenantApi.getTerminals().catch(() => []),
      ]);
      setDeliveries(delList);
      setCouriers(courList);
      setZones(znList);
      setTerminals(termList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('delivery.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleOpenAssignModal = (del: Delivery) => {
    setSelectedDeliveryForAssign(del);
    setSelectedCourierId('');
    setAssignCourierModalOpen(true);
  };

  const handleAssignCourier = async () => {
    if (!selectedDeliveryForAssign || !selectedCourierId) return;
    try {
      await deliveryApi.assignCourier(selectedDeliveryForAssign.id, selectedCourierId);
      setAssignCourierModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('delivery.errors.assignFailed'));
    }
  };

  const handleDepartDelivery = async (delId: string) => {
    try {
      await deliveryApi.departDelivery(delId);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.departFailed'));
    }
  };

  const handleOpenCompleteModal = (del: Delivery) => {
    setSelectedDeliveryForComplete(del);
    setCashCollected(del.grand_total || '0');
    setPosAmount('0');
    setCompleteModalOpen(true);
  };

  const handleCompleteDelivery = async () => {
    if (!selectedDeliveryForComplete) return;
    try {
      await deliveryApi.completeDelivery(selectedDeliveryForComplete.id, cashCollected, posAmount);
      setCompleteModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.completeFailed'));
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
      await deliveryApi.failDelivery(selectedDeliveryForFail.id, failReason);
      setFailModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.failFailed'));
    }
  };

  const handleRequeueDelivery = async (delId: string) => {
    try {
      await deliveryApi.requeueDelivery(delId);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.requeueFailed'));
    }
  };

  const handleRecordAttendance = async (courierId: string, status: 'CHECKED_IN' | 'CHECKED_OUT' | 'PAUSED') => {
    try {
      const targetBranchId = selectedBranchId || zones[0]?.branch_id || branches[0]?.id;
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
      const targetBranchId = selectedBranchId || zones[0]?.branch_id || branches[0]?.id;
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
      setCourierForm({ code: '', name: '', phone: '', vehicle_type: 'MOTORCYCLE', compensation_per_delivery: '15000' });
      loadData();
    } catch (err: any) {
      setError(err.detail || t('delivery.errors.createCourierFailed'));
    }
  };

  const handleCreateZone = async () => {
    try {
      const targetBranchId = selectedBranchId || zones[0]?.branch_id || branches[0]?.id;
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
      setZoneForm({ code: '', name: '', fee: '25000', estimated_minutes: 30 });
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
      setTab('AUDIT');
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
    <Box sx={{ p: 3 }}>
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
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            {t('delivery.refresh')}
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Paper sx={{ mb: 3, borderRadius: 2 }}>
        <Tabs value={tab} onChange={(_, val) => setTab(val)}>
          <Tab label={`${t('delivery.tabs.board')} (${deliveries.length})`} value="BOARD" icon={<LocalShippingIcon />} iconPosition="start" />
          <Tab label={`${t('delivery.tabs.couriers')} (${couriers.length})`} value="COURIERS" icon={<PersonIcon />} iconPosition="start" />
          <Tab label={t('delivery.tabs.settlements')} value="SETTLEMENTS" icon={<ReceiptLongIcon />} iconPosition="start" />
          <Tab label={`${t('delivery.tabs.zones')} (${zones.length})`} value="ZONES" icon={<MapIcon />} iconPosition="start" />
          <Tab label={t('delivery.tabs.audit')} value="AUDIT" icon={<HistoryIcon />} iconPosition="start" />
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
                      <Typography variant="body2" color="text.secondary">
                        {t('delivery.card.zone')}: {del.zone_name} | {t('delivery.card.fee')}: {MoneyUtil.formatCurrency(del.fee)} {del.currency_code}
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', mt: 1 }}>
                        {t('delivery.card.total')}: {MoneyUtil.formatCurrency(del.grand_total)} {del.currency_code}
                      </Typography>

                      <Stack direction="row" sx={{ pt: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                        <IconButton size="small" onClick={() => handleViewEvents(del.id)}>
                          <HistoryIcon fontSize="small" />
                        </IconButton>
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

                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Button
                          variant="contained"
                          color="warning"
                          size="small"
                          startIcon={<LocalShippingIcon />}
                          onClick={() => handleDepartDelivery(del.id)}
                        >
                          {t('delivery.card.depart')}
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

                      <Stack spacing={0.5} sx={{ my: 1 }}>
                        <Typography variant="caption">
                          {t('delivery.card.expCash')}: {MoneyUtil.formatCurrency(del.cash_expected)} IRR
                        </Typography>
                        <Typography variant="caption">
                          {t('delivery.card.expPos')}: {MoneyUtil.formatCurrency(del.mobile_pos_expected)} IRR
                        </Typography>
                      </Stack>

                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', pt: 1 }}>
                        <Button
                          variant="contained"
                          color="success"
                          size="small"
                          onClick={() => handleOpenCompleteModal(del)}
                        >
                          {t('delivery.card.complete')}
                        </Button>
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
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
                        {t('delivery.card.courier')}: {del.courier_name} | {t('delivery.card.compensation')}: {MoneyUtil.formatCurrency(del.compensation_amount)} IRR
                      </Typography>

                      {del.state === 'FAILED' && (
                        <Button
                          variant="outlined"
                          size="small"
                          color="warning"
                          startIcon={<UndoIcon />}
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
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCourierModalOpen(true)}>
              {t('delivery.couriers.addCourier')}
            </Button>
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
                      <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>{c.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{c.phone || t('delivery.card.noPhone')}</Typography>
                    </TableCell>
                    <TableCell><Chip label={getVehicleTypeLabel(c.vehicle_type)} size="small" /></TableCell>
                    <TableCell>{MoneyUtil.formatCurrency(c.compensation_per_delivery || '0')} IRR</TableCell>
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
                <TableCell>{t('delivery.zones.estimatedMinutes')}</TableCell>
                <TableCell>{t('delivery.zones.status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {zones.map((z) => (
                <TableRow key={z.id}>
                  <TableCell><strong>{z.code}</strong></TableCell>
                  <TableCell>{z.name}</TableCell>
                  <TableCell>{MoneyUtil.formatCurrency(z.fee)} {z.currency_code}</TableCell>
                  <TableCell>{z.estimated_minutes} {t('delivery.zones.mins')}</TableCell>
                  <TableCell><Chip label={z.is_active ? t('delivery.zones.active') : t('delivery.zones.inactive')} color="success" size="small" /></TableCell>
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
                  <TableCell>{new Date(ev.occurred_at).toLocaleString()}</TableCell>
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
          <Button variant="contained" disabled={!selectedCourierId} onClick={handleAssignCourier}>
            {t('delivery.modals.assignCourier.submit')}
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
            <TextField
              label={t('delivery.modals.complete.cashLabel')}
              value={cashCollected}
              onChange={(e) => setCashCollected(e.target.value)}
              fullWidth
            />
            <TextField
              label={t('delivery.modals.complete.posLabel')}
              value={posAmount}
              onChange={(e) => setPosAmount(e.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompleteModalOpen(false)}>{t('delivery.modals.complete.cancel')}</Button>
          <Button variant="contained" color="success" onClick={handleCompleteDelivery}>
            {t('delivery.modals.complete.submit')}
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
          <Button variant="contained" color="error" onClick={handleFailDelivery}>
            {t('delivery.modals.fail.submit')}
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
            <TextField label={t('delivery.modals.addCourier.phone')} value={courierForm.phone} onChange={(e) => setCourierForm({ ...courierForm, phone: e.target.value })} fullWidth />
            <FormControl fullWidth>
              <InputLabel>{t('delivery.modals.addCourier.vehicleType')}</InputLabel>
              <Select value={courierForm.vehicle_type} label={t('delivery.modals.addCourier.vehicleType')} onChange={(e) => setCourierForm({ ...courierForm, vehicle_type: e.target.value })}>
                <MenuItem value="MOTORCYCLE">{t('delivery.couriers.vehicleTypes.motorcycle')}</MenuItem>
                <MenuItem value="BICYCLE">{t('delivery.couriers.vehicleTypes.bicycle')}</MenuItem>
                <MenuItem value="CAR">{t('delivery.couriers.vehicleTypes.car')}</MenuItem>
                <MenuItem value="ON_FOOT">{t('delivery.couriers.vehicleTypes.onFoot')}</MenuItem>
              </Select>
            </FormControl>
            <TextField label={t('delivery.modals.addCourier.compensation')} value={courierForm.compensation_per_delivery} onChange={(e) => setCourierForm({ ...courierForm, compensation_per_delivery: e.target.value })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCourierModalOpen(false)}>{t('delivery.modals.addCourier.cancel')}</Button>
          <Button variant="contained" onClick={handleCreateCourier}>{t('delivery.modals.addCourier.submit')}</Button>
        </DialogActions>
      </Dialog>

      {/* Add Zone Modal */}
      <Dialog open={zoneModalOpen} onClose={() => setZoneModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('delivery.modals.addZone.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label={t('delivery.modals.addZone.code')} value={zoneForm.code} onChange={(e) => setZoneForm({ ...zoneForm, code: e.target.value })} fullWidth />
            <TextField label={t('delivery.modals.addZone.name')} value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })} fullWidth />
            <TextField label={t('delivery.modals.addZone.fee')} value={zoneForm.fee} onChange={(e) => setZoneForm({ ...zoneForm, fee: e.target.value })} fullWidth />
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
