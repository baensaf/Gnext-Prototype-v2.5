import type { Courier } from '../../api/deliveryApi';

import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router';
import { useState, useEffect, useCallback } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import TwoWheelerIcon from '@mui/icons-material/TwoWheeler';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import {
  Box,
  Card,
  Grid,
  Chip,
  Stack,
  Alert,
  Button,
  Divider,
  Container,
  Typography,
  IconButton,
  CardHeader,
  CardContent,
  CircularProgress,
} from '@mui/material';

import { deliveryApi } from '../../api/deliveryApi';

export function CourierDetailPage() {
  const params = useParams<{ id?: string; courierId?: string }>();
  const id = params.id || params.courierId;
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [courier, setCourier] = useState<Courier | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCourier = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await deliveryApi.getCourierById(id);
      setCourier(data);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to load courier');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCourier();
  }, [fetchCourier]);

  const handleStatusUpdate = async (status: 'AVAILABLE' | 'ON_DELIVERY' | 'INACTIVE') => {
    if (!id) return;
    try {
      await deliveryApi.updateCourierStatus(id, status);
      fetchCourier();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to update courier status');
    }
  };

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error || !courier) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/delivery/couriers')} sx={{ mb: 2 }}>
          {t('common.back', 'Back to Couriers')}
        </Button>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || t('delivery.courierNotFound', 'Courier not found')}
        </Alert>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchCourier}>
          {t('common.retry', 'Retry')}
        </Button>
      </Container>
    );
  }

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'AVAILABLE':
        return 'success';
      case 'ON_DELIVERY':
      case 'BUSY':
        return 'warning';
      case 'INACTIVE':
      case 'OFF_LINE':
      default:
        return 'default';
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Stack sx={{ flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 2, mb: 3 }}>
        <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/delivery/couriers')}>
            {t('common.back', 'Back')}
          </Button>
          <Box>
            <Typography variant="h4" sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              {courier.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" dir="ltr">
              {t('delivery.code', 'Code')}: <strong>{courier.code}</strong> | ID: {courier.id}
            </Typography>
          </Box>
        </Stack>
        <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
          <Chip
            label={courier.status || 'AVAILABLE'}
            color={getStatusColor(courier.status)}
            variant="filled"
          />
          {courier.attendance && (
            <Chip
              label={courier.attendance.availability_status || courier.attendance.status}
              color={getStatusColor(courier.attendance.availability_status)}
              variant="outlined"
            />
          )}
          <IconButton onClick={fetchCourier} title={t('common.refresh', 'Refresh')}>
            <RefreshIcon />
          </IconButton>
        </Stack>
      </Stack>

      <Grid container spacing={3}>
        {/* Profile & Vehicle Details */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardHeader
              avatar={<TwoWheelerIcon color="primary" />}
              title={t('delivery.courierInfo', 'Courier Profile')}
            />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('delivery.name', 'Full Name')}:</Typography>
                  <Typography sx={{ fontWeight: 600 }}>{courier.name}</Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('delivery.phone', 'Phone Number')}:</Typography>
                  <Typography dir="ltr">{courier.phone || t('common.none', 'N/A')}</Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('delivery.vehicleType', 'Vehicle Type')}:</Typography>
                  <Typography>{courier.vehicle_type || 'MOTORCYCLE'}</Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('delivery.activeDeliveries', 'Active Deliveries')}:</Typography>
                  <Typography sx={{ fontWeight: 600, color: courier.active_delivery_count ? 'warning.main' : 'text.primary' }}>
                    {courier.active_delivery_count || 0}
                  </Typography>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Compensation & Financials */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardHeader
              avatar={<AttachMoneyIcon color="success" />}
              title={t('delivery.compensation', 'Compensation & Rates')}
            />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('delivery.feePerTrip', 'Fee Per Delivery')}:</Typography>
                  <Typography sx={{ fontWeight: 600, color: 'success.main' }}>
                    {Number(courier.compensation_per_delivery || 0).toLocaleString()} {courier.currency_code || 'IRR'}
                  </Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('delivery.currency', 'Currency')}:</Typography>
                  <Typography>{courier.currency_code || 'IRR'}</Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('delivery.accountStatus', 'Account Status')}:</Typography>
                  <Chip
                    size="small"
                    label={courier.is_active ? t('common.active', 'ACTIVE') : t('common.inactive', 'INACTIVE')}
                    color={courier.is_active ? 'success' : 'default'}
                  />
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Attendance & POS Assignment */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardHeader
              avatar={<AccessTimeIcon color="info" />}
              title={t('delivery.attendanceTitle', 'Daily Attendance')}
            />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('delivery.attendanceStatus', 'Attendance Status')}:</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {courier.attendance?.status || 'CHECKED_OUT'}
                  </Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('delivery.availability', 'Availability')}:</Typography>
                  <Chip
                    size="small"
                    label={courier.attendance?.availability_status || 'OFF_LINE'}
                    color={getStatusColor(courier.attendance?.availability_status)}
                  />
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('delivery.checkedInAt', 'Checked In')}:</Typography>
                  <Typography dir="ltr">
                    {courier.attendance?.checked_in_at ? new Date(courier.attendance.checked_in_at).toLocaleTimeString() : t('common.notCheckedIn', 'Not checked in')}
                  </Typography>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Assigned Terminal */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardHeader
              avatar={<PointOfSaleIcon color="action" />}
              title={t('delivery.terminalAssignment', 'Mobile POS / Terminal Assignment')}
            />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('delivery.assignedTerminal', 'Assigned Terminal')}:</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {courier.active_terminal?.terminal_name || courier.active_terminal?.terminal_id || t('common.unassigned', 'None (Unassigned)')}
                  </Typography>
                </Stack>
                {courier.active_terminal?.assigned_at && (
                  <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Typography color="text.secondary">{t('delivery.assignedAt', 'Assigned At')}:</Typography>
                    <Typography dir="ltr">
                      {new Date(courier.active_terminal.assigned_at).toLocaleString()}
                    </Typography>
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Quick Actions */}
        <Grid size={{ xs: 12 }}>
          <Card sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              {t('delivery.quickStatus', 'Quick Status Action')}
            </Typography>
            <Stack sx={{ flexDirection: 'row', gap: 1.5, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                color="success"
                disabled={courier.status === 'AVAILABLE'}
                onClick={() => handleStatusUpdate('AVAILABLE')}
              >
                {t('delivery.setAvailable', 'Set Available')}
              </Button>
              <Button
                variant="outlined"
                color="warning"
                disabled={courier.status === 'ON_DELIVERY'}
                onClick={() => handleStatusUpdate('ON_DELIVERY')}
              >
                {t('delivery.setOnDelivery', 'Set On Delivery')}
              </Button>
              <Button
                variant="outlined"
                color="error"
                disabled={courier.status === 'INACTIVE'}
                onClick={() => handleStatusUpdate('INACTIVE')}
              >
                {t('delivery.setInactive', 'Set Inactive')}
              </Button>
            </Stack>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}

export default CourierDetailPage;
