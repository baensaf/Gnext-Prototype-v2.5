import type { Courier, Delivery, DeliveryZone, DeliveryEvent } from 'src/api/deliveryApi';

import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import MapIcon from '@mui/icons-material/Map';
import UndoIcon from '@mui/icons-material/Undo';
import PersonIcon from '@mui/icons-material/Person';
import RefreshIcon from '@mui/icons-material/Refresh';
import HistoryIcon from '@mui/icons-material/History';
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

import { tenantApi } from 'src/api/tenantApi';
import { deliveryApi } from 'src/api/deliveryApi';

export function DeliveryPage() {
  const [tab, setTab] = useState<'BOARD' | 'COURIERS' | 'ZONES' | 'AUDIT'>('BOARD');

  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [terminals, setTerminals] = useState<any[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<DeliveryEvent[]>([]);
  const [eventDeliveryId, setEventDeliveryId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialogs
  const [assignCourierModalOpen, setAssignCourierModalOpen] = useState(false);
  const [selectedDeliveryForAssign, setSelectedDeliveryForAssign] = useState<Delivery | null>(null);
  const [selectedCourierId, setSelectedCourierId] = useState('');

  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [selectedDeliveryForComplete, setSelectedDeliveryForComplete] = useState<Delivery | null>(null);
  const [cashCollected, setCashCollected] = useState<number>(0);
  const [posAmount, setPosAmount] = useState<number>(0);

  const [failModalOpen, setFailModalOpen] = useState(false);
  const [selectedDeliveryForFail, setSelectedDeliveryForFail] = useState<Delivery | null>(null);
  const [failReason, setFailReason] = useState('');

  const [courierModalOpen, setCourierModalOpen] = useState(false);
  const [courierForm, setCourierForm] = useState({ code: '', name: '', phone: '', vehicle_type: 'MOTORCYCLE', compensation_per_delivery: 15000 });

  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const [zoneForm, setZoneForm] = useState({ code: '', name: '', fee: 25000, estimated_minutes: 30 });

  const [terminalAssignModalOpen, setTerminalAssignModalOpen] = useState(false);
  const [selectedCourierForTerminal, setSelectedCourierForTerminal] = useState<Courier | null>(null);
  const [selectedTerminalId, setSelectedTerminalId] = useState('');

  const loadData = async () => {
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
      setError(err.detail || err.message || 'Failed to load delivery data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

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
      setError(err.detail || err.message || 'Failed to assign courier');
    }
  };

  const handleDepartDelivery = async (delId: string) => {
    try {
      await deliveryApi.departDelivery(delId);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to depart delivery');
    }
  };

  const handleOpenCompleteModal = (del: Delivery) => {
    setSelectedDeliveryForComplete(del);
    setCashCollected(parseFloat(del.grand_total || '0'));
    setPosAmount(0);
    setCompleteModalOpen(true);
  };

  const handleCompleteDelivery = async () => {
    if (!selectedDeliveryForComplete) return;
    try {
      await deliveryApi.completeDelivery(selectedDeliveryForComplete.id, cashCollected, posAmount);
      setCompleteModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to complete delivery');
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
      setError(err.detail || 'Failed to record delivery failure');
    }
  };

  const handleRequeueDelivery = async (delId: string) => {
    try {
      await deliveryApi.requeueDelivery(delId);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to requeue delivery');
    }
  };

  const handleRecordAttendance = async (courierId: string, status: 'CHECKED_IN' | 'CHECKED_OUT' | 'PAUSED') => {
    try {
      await deliveryApi.recordAttendance({
        courier_id: courierId,
        branch_id: zones[0]?.branch_id || '00000000-0000-0000-0000-000000000000',
        status,
      });
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to update attendance');
    }
  };

  const handleSetAvailability = async (courierId: string, availability: 'AVAILABLE' | 'BUSY' | 'OFF_LINE') => {
    try {
      await deliveryApi.setAvailability(courierId, availability);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to set availability');
    }
  };

  const handleCreateCourier = async () => {
    try {
      await deliveryApi.createCourier({
        branch_id: zones[0]?.branch_id || '00000000-0000-0000-0000-000000000000',
        ...courierForm,
        compensation_per_delivery: courierForm.compensation_per_delivery.toString(),
      });
      setCourierModalOpen(false);
      setCourierForm({ code: '', name: '', phone: '', vehicle_type: 'MOTORCYCLE', compensation_per_delivery: 15000 });
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create courier profile');
    }
  };

  const handleCreateZone = async () => {
    try {
      await deliveryApi.createZone({
        branch_id: zones[0]?.branch_id || '00000000-0000-0000-0000-000000000000',
        ...zoneForm,
        fee: zoneForm.fee.toString(),
      });
      setZoneModalOpen(false);
      setZoneForm({ code: '', name: '', fee: 25000, estimated_minutes: 30 });
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create delivery zone');
    }
  };

  const handleAssignTerminal = async () => {
    if (!selectedCourierForTerminal || !selectedTerminalId) return;
    try {
      await deliveryApi.assignTerminal(selectedCourierForTerminal.id, selectedTerminalId);
      setTerminalAssignModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to assign mobile terminal');
    }
  };

  const handleUnassignTerminal = async (courierId: string) => {
    try {
      await deliveryApi.unassignTerminal(courierId);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to unassign terminal');
    }
  };

  const handleViewEvents = async (delId: string) => {
    try {
      const events = await deliveryApi.getEvents(delId);
      setSelectedEvents(events);
      setEventDeliveryId(delId);
      setTab('AUDIT');
    } catch (err: any) {
      setError(err.detail || 'Failed to load delivery timeline');
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
        DELIVERY EXECUTION & COURIER INSTRUMENT DISPATCHER
      </Alert>

      {/* Header */}
      <Stack direction="row" sx={{ mb: 3, justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
            Delivery Management <LocalShippingIcon color="primary" />
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Dispatch delivery orders, enforce courier attendance & mobile terminal exclusivity, and instrument cash/POS expectations.
          </Typography>
        </Box>

        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
          Refresh
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Paper sx={{ mb: 3, borderRadius: 2 }}>
        <Tabs value={tab} onChange={(_, val) => setTab(val)}>
          <Tab label={`Dispatch Board (${deliveries.length})`} value="BOARD" icon={<LocalShippingIcon />} iconPosition="start" />
          <Tab label={`Couriers & Roster (${couriers.length})`} value="COURIERS" icon={<PersonIcon />} iconPosition="start" />
          <Tab label={`Zones & Fees (${zones.length})`} value="ZONES" icon={<MapIcon />} iconPosition="start" />
          <Tab label="Delivery Audit Log" value="AUDIT" icon={<HistoryIcon />} iconPosition="start" />
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
                  Unassigned ({unassigned.length})
                </Typography>
                <Chip label="Needs Courier" color="info" size="small" />
              </Stack>
              <Divider sx={{ mb: 2 }} />

              <Stack spacing={2}>
                {unassigned.map((del) => (
                  <Card key={del.id} elevation={2} sx={{ borderRadius: 2 }}>
                    <CardContent sx={{ p: 2 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                        Order #{del.order_number}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Zone: {del.zone_name} | Fee: {parseFloat(del.fee).toLocaleString()} {del.currency_code}
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', mt: 1 }}>
                        Total: {parseFloat(del.grand_total).toLocaleString()} {del.currency_code}
                      </Typography>

                      <Stack direction="row" sx={{ pt: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                        <IconButton size="small" onClick={() => handleViewEvents(del.id)}>
                          <HistoryIcon fontSize="small" />
                        </IconButton>
                        <Button variant="contained" size="small" onClick={() => handleOpenAssignModal(del)}>
                          Assign Courier
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
                  Assigned ({assigned.length})
                </Typography>
                <Chip label="Ready to Depart" color="warning" size="small" />
              </Stack>
              <Divider sx={{ mb: 2 }} />

              <Stack spacing={2}>
                {assigned.map((del) => (
                  <Card key={del.id} elevation={2} sx={{ borderRadius: 2, borderLeft: 6, borderColor: 'warning.main' }}>
                    <CardContent sx={{ p: 2 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                        Order #{del.order_number}
                      </Typography>
                      <Chip label={`Courier: ${del.courier_name}`} color="primary" size="small" sx={{ my: 0.5 }} />
                      <Typography variant="body2" color="text.secondary">
                        Assigned At: {del.assigned_at ? new Date(del.assigned_at).toLocaleTimeString() : ''}
                      </Typography>

                      <Stack direction="row" sx={{ pt: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                        <IconButton size="small" onClick={() => handleViewEvents(del.id)}>
                          <HistoryIcon fontSize="small" />
                        </IconButton>
                        <Button variant="contained" color="warning" size="small" onClick={() => handleDepartDelivery(del.id)}>
                          Depart / En Route
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Paper>
          </Grid>

          {/* EN ROUTE */}
          <Grid size={{ xs: 12, md: 3 }}>
            <Paper sx={{ p: 2, bg: '#fafafa', borderRadius: 2, minHeight: 600 }}>
              <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" color="primary.main" sx={{ fontWeight: 'bold' }}>
                  En Route ({enRoute.length})
                </Typography>
                <Chip label="Out for Delivery" color="primary" size="small" />
              </Stack>
              <Divider sx={{ mb: 2 }} />

              <Stack spacing={2}>
                {enRoute.map((del) => (
                  <Card key={del.id} elevation={2} sx={{ borderRadius: 2, borderLeft: 6, borderColor: 'primary.main' }}>
                    <CardContent sx={{ p: 2 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                        Order #{del.order_number}
                      </Typography>
                      <Chip label={`Courier: ${del.courier_name}`} color="primary" size="small" sx={{ my: 0.5 }} />
                      <Typography variant="body2" color="text.secondary">
                        Departed: {del.picked_up_at ? new Date(del.picked_up_at).toLocaleTimeString() : ''}
                      </Typography>

                      <Stack direction="row" spacing={1} sx={{ pt: 2, justifyContent: 'flex-end' }}>
                        <Button variant="outlined" color="error" size="small" onClick={() => handleOpenFailModal(del)}>
                          Fail
                        </Button>
                        <Button variant="contained" color="success" size="small" onClick={() => handleOpenCompleteModal(del)}>
                          Deliver
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Paper>
          </Grid>

          {/* DELIVERED & FAILED */}
          <Grid size={{ xs: 12, md: 3 }}>
            <Paper sx={{ p: 2, bg: '#fafafa', borderRadius: 2, minHeight: 600 }}>
              <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" color="success.main" sx={{ fontWeight: 'bold' }}>
                  History ({finished.length})
                </Typography>
                <Chip label="Completed / Failed" size="small" />
              </Stack>
              <Divider sx={{ mb: 2 }} />

              <Stack spacing={2}>
                {finished.map((del) => (
                  <Card key={del.id} elevation={1} sx={{ borderRadius: 2 }}>
                    <CardContent sx={{ p: 2 }}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                          Order #{del.order_number}
                        </Typography>
                        <Chip
                          label={del.state}
                          color={del.state === 'DELIVERED' ? 'success' : 'error'}
                          size="small"
                        />
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        Courier: {del.courier_name} | Compensation: {parseFloat(del.compensation_amount).toLocaleString()} IRR
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
                          Re-queue Delivery
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
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Courier Profiles & Roster ({couriers.length})</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCourierModalOpen(true)}>
              Add Courier
            </Button>
          </Stack>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Name & Phone</TableCell>
                <TableCell>Vehicle</TableCell>
                <TableCell>Compensation / Delivery</TableCell>
                <TableCell>Attendance</TableCell>
                <TableCell>Availability</TableCell>
                <TableCell>Mobile POS Assignment</TableCell>
                <TableCell>Active Load</TableCell>
                <TableCell align="right">Actions</TableCell>
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
                      <Typography variant="caption" color="text.secondary">{c.phone || 'No phone'}</Typography>
                    </TableCell>
                    <TableCell><Chip label={c.vehicle_type} size="small" /></TableCell>
                    <TableCell>{parseFloat(c.compensation_per_delivery || '0').toLocaleString()} IRR</TableCell>
                    <TableCell>
                      <Chip
                        label={c.attendance?.status || 'CHECKED_OUT'}
                        color={isCheckedIn ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={c.attendance?.availability_status || 'OFF_LINE'}
                        color={c.attendance?.availability_status === 'AVAILABLE' ? 'info' : 'default'}
                        size="small"
                      />
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
                          Assign POS
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
                            Check-In
                          </Button>
                        ) : (
                          <Button size="small" variant="outlined" color="error" onClick={() => handleRecordAttendance(c.id, 'CHECKED_OUT')}>
                            Check-Out
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

      {/* ZONES TAB */}
      {tab === 'ZONES' && (
        <Card sx={{ p: 3, borderRadius: 2 }}>
          <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Delivery Zones ({zones.length})</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setZoneModalOpen(true)}>
              Add Delivery Zone
            </Button>
          </Stack>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Zone Name</TableCell>
                <TableCell>Standard Delivery Fee</TableCell>
                <TableCell>Estimated Minutes</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {zones.map((z) => (
                <TableRow key={z.id}>
                  <TableCell><strong>{z.code}</strong></TableCell>
                  <TableCell>{z.name}</TableCell>
                  <TableCell>{parseFloat(z.fee).toLocaleString()} {z.currency_code}</TableCell>
                  <TableCell>{z.estimated_minutes} mins</TableCell>
                  <TableCell><Chip label={z.is_active ? 'Active' : 'Inactive'} color="success" size="small" /></TableCell>
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
            Delivery State Timeline Events ({selectedEvents.length})
          </Typography>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Timestamp</TableCell>
                <TableCell>From State</TableCell>
                <TableCell>To State</TableCell>
                <TableCell>Reason / Note</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {selectedEvents.map((ev) => (
                <TableRow key={ev.id}>
                  <TableCell>{new Date(ev.occurred_at).toLocaleString()}</TableCell>
                  <TableCell><Chip label={ev.from_state} size="small" /></TableCell>
                  <TableCell><Chip label={ev.to_state} color="primary" size="small" /></TableCell>
                  <TableCell>{ev.reason || 'State transition'}</TableCell>
                </TableRow>
              ))}
              {selectedEvents.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                    Select a delivery from the board to view its audit timeline.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Assign Courier Modal */}
      <Dialog open={assignCourierModalOpen} onClose={() => setAssignCourierModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Assign Courier to Delivery</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Assign an eligible checked-in & available courier to Order #{selectedDeliveryForAssign?.order_number}
          </Typography>
          <FormControl fullWidth>
            <InputLabel>Eligible Courier</InputLabel>
            <Select value={selectedCourierId} label="Eligible Courier" onChange={(e) => setSelectedCourierId(e.target.value)}>
              {eligibleCouriers.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name} ({c.vehicle_type}) - {c.active_delivery_count || 0}/5 active
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {eligibleCouriers.length === 0 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              No couriers are currently checked in and AVAILABLE under capacity limits.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignCourierModalOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!selectedCourierId} onClick={handleAssignCourier}>
            Assign Courier
          </Button>
        </DialogActions>
      </Dialog>

      {/* Complete Delivery Modal */}
      <Dialog open={completeModalOpen} onClose={() => setCompleteModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Complete Delivery & Instrument Actuals</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">
              Record collected instruments for Order #{selectedDeliveryForComplete?.order_number}
            </Typography>
            <TextField
              label="Courier Cash Collected (IRR)"
              type="number"
              value={cashCollected}
              onChange={(e) => setCashCollected(Number(e.target.value))}
              fullWidth
            />
            <TextField
              label="Company Mobile POS Amount (IRR)"
              type="number"
              value={posAmount}
              onChange={(e) => setPosAmount(Number(e.target.value))}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompleteModalOpen(false)}>Cancel</Button>
          <Button variant="contained" color="success" onClick={handleCompleteDelivery}>
            Confirm Delivery
          </Button>
        </DialogActions>
      </Dialog>

      {/* Fail Delivery Modal */}
      <Dialog open={failModalOpen} onClose={() => setFailModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Record Delivery Failure</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Failure Reason"
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
              fullWidth
              multiline
              rows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFailModalOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleFailDelivery}>
            Submit Failure
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Courier Modal */}
      <Dialog open={courierModalOpen} onClose={() => setCourierModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Courier Profile</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Courier Code" value={courierForm.code} onChange={(e) => setCourierForm({ ...courierForm, code: e.target.value })} fullWidth />
            <TextField label="Courier Name" value={courierForm.name} onChange={(e) => setCourierForm({ ...courierForm, name: e.target.value })} fullWidth />
            <TextField label="Phone Number" value={courierForm.phone} onChange={(e) => setCourierForm({ ...courierForm, phone: e.target.value })} fullWidth />
            <FormControl fullWidth>
              <InputLabel>Vehicle Type</InputLabel>
              <Select value={courierForm.vehicle_type} label="Vehicle Type" onChange={(e) => setCourierForm({ ...courierForm, vehicle_type: e.target.value })}>
                <MenuItem value="MOTORCYCLE">Motorcycle</MenuItem>
                <MenuItem value="BICYCLE">Bicycle</MenuItem>
                <MenuItem value="CAR">Car</MenuItem>
                <MenuItem value="ON_FOOT">On Foot</MenuItem>
              </Select>
            </FormControl>
            <TextField label="Compensation per Delivery (IRR)" type="number" value={courierForm.compensation_per_delivery} onChange={(e) => setCourierForm({ ...courierForm, compensation_per_delivery: Number(e.target.value) })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCourierModalOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateCourier}>Save Courier</Button>
        </DialogActions>
      </Dialog>

      {/* Add Zone Modal */}
      <Dialog open={zoneModalOpen} onClose={() => setZoneModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Delivery Zone</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Zone Code" value={zoneForm.code} onChange={(e) => setZoneForm({ ...zoneForm, code: e.target.value })} fullWidth />
            <TextField label="Zone Name" value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })} fullWidth />
            <TextField label="Delivery Fee (IRR)" type="number" value={zoneForm.fee} onChange={(e) => setZoneForm({ ...zoneForm, fee: Number(e.target.value) })} fullWidth />
            <TextField label="Estimated Minutes" type="number" value={zoneForm.estimated_minutes} onChange={(e) => setZoneForm({ ...zoneForm, estimated_minutes: Number(e.target.value) })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setZoneModalOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateZone}>Save Zone</Button>
        </DialogActions>
      </Dialog>

      {/* Assign Terminal Modal */}
      <Dialog open={terminalAssignModalOpen} onClose={() => setTerminalAssignModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Assign Mobile POS Terminal</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Assign exclusive company mobile POS terminal to {selectedCourierForTerminal?.name}
          </Typography>
          <FormControl fullWidth>
            <InputLabel>Mobile POS Terminal</InputLabel>
            <Select value={selectedTerminalId} label="Mobile POS Terminal" onChange={(e) => setSelectedTerminalId(e.target.value)}>
              {terminals.map((t) => (
                <MenuItem key={t.id} value={t.id}>{t.name || t.code} ({t.serial_number || 'Mobile POS'})</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTerminalAssignModalOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAssignTerminal}>Save Assignment</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
