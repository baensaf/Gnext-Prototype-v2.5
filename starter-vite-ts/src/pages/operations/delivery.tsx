import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Stack,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Alert,
  Grid,
  Paper,
  Drawer,
  Divider,
} from '@mui/material';
import TwoWheelerIcon from '@mui/icons-material/TwoWheeler';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import PhoneIcon from '@mui/icons-material/Phone';
import LocationOnIcon from '@mui/icons-material/LocationOn';

import { deliveryApi, Courier, DeliveryAssignment } from 'src/api/deliveryApi';

export function DeliveryPage() {
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [assignments, setAssignments] = useState<DeliveryAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add Courier Drawer
  const [courierDrawerOpen, setCourierDrawerOpen] = useState(false);
  const [cCode, setCCode] = useState('');
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cVehicle, setCVehicle] = useState<'MOTORCYCLE' | 'BICYCLE' | 'CAR' | 'ON_FOOT'>('MOTORCYCLE');

  // Assign Courier Modal
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('ORD-DEMO-101');
  const [selectedCourierId, setSelectedCourierId] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('25.00');

  // Failure Modal
  const [failDialogOpen, setFailDialogOpen] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [failReason, setFailReason] = useState('Customer unavailable');

  const loadData = async () => {
    setLoading(true);
    try {
      const [cList, aList] = await Promise.all([deliveryApi.getCouriers(), deliveryApi.getAssignments()]);
      setCouriers(cList);
      setAssignments(aList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load delivery data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateCourier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await deliveryApi.createCourier({ code: cCode, name: cName, phone: cPhone, vehicle_type: cVehicle });
      setCourierDrawerOpen(false);
      setCCode('');
      setCName('');
      setCPhone('');
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create courier');
    }
  };

  const handleAssignOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourierId) return;
    try {
      await deliveryApi.assignOrder(selectedOrderId, selectedCourierId, parseFloat(deliveryFee));
      setAssignDialogOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to assign order to courier');
    }
  };

  const handleUpdateStatus = async (
    assignmentId: string,
    status: 'ASSIGNED' | 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'RETURNED',
  ) => {
    try {
      await deliveryApi.updateAssignmentStatus(assignmentId, status);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to update assignment status');
    }
  };

  const handleFailDelivery = async () => {
    if (!selectedAssignmentId) return;
    try {
      await deliveryApi.updateAssignmentStatus(selectedAssignmentId, 'FAILED', failReason);
      setFailDialogOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to record delivery failure');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DELIVERED':
        return 'success';
      case 'OUT_FOR_DELIVERY':
        return 'warning';
      case 'PICKED_UP':
        return 'info';
      case 'FAILED':
      case 'RETURNED':
        return 'error';
      default:
        return 'default';
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Delivery & Courier Dispatch Board
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Slice 16 — Active delivery tracking, courier roster, order dispatch, and delivery fee accounting
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            Refresh
          </Button>
          <Button variant="outlined" startIcon={<PersonAddIcon />} onClick={() => setCourierDrawerOpen(true)}>
            Add Courier
          </Button>
          <Button variant="contained" startIcon={<LocalShippingIcon />} onClick={() => setAssignDialogOpen(true)}>
            Dispatch Order
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Active Deliveries Grid (Left 8 Cols) */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Active Delivery Assignments ({assignments.length})
          </Typography>

          {assignments.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 5, textAlign: 'center' }}>
              <LocalShippingIcon sx={{ fontSize: 60, color: 'text.secondary', mb: 1 }} />
              <Typography variant="h6" color="text.secondary">
                No active delivery orders. Click "Dispatch Order" to assign a courier.
              </Typography>
            </Paper>
          ) : (
            <Stack spacing={2}>
              {assignments.map((a) => (
                <Card key={a.id} variant="outlined" sx={{ borderLeft: 6, borderLeftColor: `${getStatusColor(a.status)}.main` }}>
                  <CardContent>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                        #{a.order_number} — {a.customer_name}
                      </Typography>
                      <Chip label={a.status} color={getStatusColor(a.status) as any} size="small" sx={{ fontWeight: 'bold' }} />
                    </Stack>

                    <Stack direction="row" spacing={3} sx={{ mb: 1.5, color: 'text.secondary', fontSize: 13 }}>
                      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                        <TwoWheelerIcon fontSize="small" />
                        <span>
                          Courier: <strong>{a.courier_name}</strong> ({a.courier_vehicle})
                        </span>
                      </Stack>
                      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                        <PhoneIcon fontSize="small" />
                        <span>{a.customer_phone || 'No Phone'}</span>
                      </Stack>
                    </Stack>

                    <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, mb: 2 }}>
                      <LocationOnIcon fontSize="small" color="action" />
                      <Typography variant="body2">{a.delivery_address}</Typography>
                    </Stack>

                    <Divider sx={{ mb: 2 }} />

                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="body2" color="text.secondary">
                        Fee: ${a.delivery_fee} • Total: ${a.order_total}
                      </Typography>
                      <Stack direction="row" spacing={1}>
                        {a.status === 'ASSIGNED' && (
                          <Button variant="outlined" size="small" onClick={() => handleUpdateStatus(a.id, 'PICKED_UP')}>
                            Mark Picked Up
                          </Button>
                        )}
                        {a.status === 'PICKED_UP' && (
                          <Button variant="outlined" size="small" color="warning" onClick={() => handleUpdateStatus(a.id, 'OUT_FOR_DELIVERY')}>
                            Out for Delivery
                          </Button>
                        )}
                        {a.status === 'OUT_FOR_DELIVERY' && (
                          <>
                            <Button variant="contained" size="small" color="success" startIcon={<CheckCircleIcon />} onClick={() => handleUpdateStatus(a.id, 'DELIVERED')}>
                              Delivered
                            </Button>
                            <Button
                              variant="outlined"
                              size="small"
                              color="error"
                              startIcon={<CancelIcon />}
                              onClick={() => {
                                setSelectedAssignmentId(a.id);
                                setFailDialogOpen(true);
                              }}
                            >
                              Failed
                            </Button>
                          </>
                        )}
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
        </Grid>

        {/* Courier Roster Sidebar (Right 4 Cols) */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Courier Roster ({couriers.length})
          </Typography>

          <Stack spacing={2}>
            {couriers.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  No couriers registered. Click "Add Courier".
                </Typography>
              </Paper>
            ) : (
              couriers.map((c) => (
                <Paper key={c.id} variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                      {c.name}
                    </Typography>
                    <Chip
                      label={c.status}
                      color={c.status === 'AVAILABLE' ? 'success' : c.status === 'ON_DELIVERY' ? 'warning' : 'default'}
                      size="small"
                    />
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Code: {c.code} • Phone: {c.phone || 'N/A'} • Vehicle: {c.vehicle_type}
                  </Typography>
                </Paper>
              ))
            )}
          </Stack>
        </Grid>
      </Grid>

      {/* Add Courier Drawer */}
      <Drawer anchor="right" open={courierDrawerOpen} onClose={() => setCourierDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Register New Courier
          </Typography>
          <Box component="form" onSubmit={handleCreateCourier}>
            <Stack spacing={2.5}>
              <TextField label="Courier Code" value={cCode} onChange={(e) => setCCode(e.target.value)} required fullWidth placeholder="e.g. CR-01" />
              <TextField label="Full Name" value={cName} onChange={(e) => setCName(e.target.value)} required fullWidth placeholder="e.g. Ali Reza" />
              <TextField label="Phone Number" value={cPhone} onChange={(e) => setCPhone(e.target.value)} fullWidth placeholder="e.g. +98 912 345 6789" />
              <TextField select label="Vehicle Type" value={cVehicle} onChange={(e) => setCVehicle(e.target.value as any)} fullWidth>
                <MenuItem value="MOTORCYCLE">Motorcycle</MenuItem>
                <MenuItem value="BICYCLE">Bicycle</MenuItem>
                <MenuItem value="CAR">Car</MenuItem>
                <MenuItem value="ON_FOOT">On Foot</MenuItem>
              </TextField>

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                Save Courier
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>

      {/* Dispatch Order Dialog */}
      <Dialog open={assignDialogOpen} onClose={() => setAssignDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>Dispatch Delivery Order</DialogTitle>
        <Box component="form" onSubmit={handleAssignOrder}>
          <DialogContent>
            <Stack spacing={2.5}>
              <TextField label="Order ID" value={selectedOrderId} onChange={(e) => setSelectedOrderId(e.target.value)} required fullWidth />
              <TextField select label="Select Courier" value={selectedCourierId} onChange={(e) => setSelectedCourierId(e.target.value)} required fullWidth>
                {couriers
                  .filter((c) => c.status === 'AVAILABLE')
                  .map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name} ({c.vehicle_type})
                    </MenuItem>
                  ))}
              </TextField>
              <TextField label="Delivery Fee ($)" type="number" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} fullWidth />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAssignDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" color="primary" disabled={!selectedCourierId}>
              Confirm Dispatch
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Failure Dialog */}
      <Dialog open={failDialogOpen} onClose={() => setFailDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>Record Delivery Failure</DialogTitle>
        <DialogContent>
          <TextField label="Reason for Failure" value={failReason} onChange={(e) => setFailReason(e.target.value)} required fullWidth multiline rows={3} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFailDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleFailDelivery}>
            Mark Failed
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
