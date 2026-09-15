import type { CourierProfile } from 'src/api/profilesApi';

import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import TwoWheelerIcon from '@mui/icons-material/TwoWheeler';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import {
  Box,
  Tab,
  Card,
  Chip,
  Grid,
  Tabs,
  Alert,
  Stack,
  Button,
  TableRow,
  Container,
  TableCell,
  Typography,
  CircularProgress,
} from '@mui/material';

import { paths } from 'src/routes/paths';

import { MoneyUtil } from 'src/utils/money.util';

import { deliveryApi } from 'src/api/deliveryApi';
import { profilesApi } from 'src/api/profilesApi';

import {
  InfoCard,
  formatMoney,
  LimitNotice,
  ProfileKpis,
  ProfileTable,
  ProfileHeader,
  formatDateTime,
  ProfileAuditTable,
  ProfileOrdersTable,
} from 'src/components/entity-profile';

type ProfileTab = 'overview' | 'orders' | 'money' | 'attendance' | 'audit';

const STATUS_COLOR: Record<string, 'success' | 'warning' | 'default'> = {
  AVAILABLE: 'success',
  ON_DELIVERY: 'warning',
  BUSY: 'warning',
};

export function CourierDetailPage() {
  const params = useParams<{ id?: string; courierId?: string }>();
  const id = params.id || params.courierId;
  const { t } = useTranslation();

  const [profile, setProfile] = useState<CourierProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ProfileTab>('overview');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setProfile(await profilesApi.courier(id));
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || t('profile.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleStatusUpdate = async (status: 'AVAILABLE' | 'ON_DELIVERY' | 'INACTIVE') => {
    if (!id) return;
    try {
      await deliveryApi.updateCourierStatus(id, status);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || t('profile.courier.statusFailed'));
    }
  };

  if (loading && !profile) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!profile) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Alert severity="error">{error || t('profile.notFound')}</Alert>
      </Container>
    );
  }

  const { courier, stats } = profile;
  const currency = courier.currency_code || 'IRR';
  const cashDiscrepancy = MoneyUtil.sum(profile.settlements.map((s) => s.cash_discrepancy_amount || '0'));

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <ProfileHeader
        title={courier.name}
        subtitle={
          <span dir="ltr">
            {courier.code}
            {courier.phone ? ` · ${courier.phone}` : ''}
          </span>
        }
        backTo={paths.app.delivery.couriers}
        onRefresh={load}
        chips={
          <>
            <Chip label={courier.status || 'AVAILABLE'} color={STATUS_COLOR[courier.status] || 'default'} />
            {courier.attendance && (
              <Chip
                variant="outlined"
                label={courier.attendance.availability_status || courier.attendance.status}
                color={STATUS_COLOR[courier.attendance.availability_status] || 'default'}
              />
            )}
          </>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <ProfileKpis
        items={[
          {
            label: t('profile.courier.delivered'),
            value: stats.delivered_count,
            hint: t('profile.courier.failedActive', { failed: stats.failed_count, active: stats.active_count }),
          },
          { label: t('profile.kpi.orders'), value: stats.order_count },
          { label: t('profile.courier.orderValue'), value: formatMoney(stats.completed_value, currency) },
          { label: t('profile.courier.compensationEarned'), value: formatMoney(stats.compensation_earned, currency) },
          {
            label: t('profile.courier.unsettled'),
            value: formatMoney(stats.unsettled_fees, currency),
            hint: t('profile.courier.unsettledCount', { count: stats.unsettled_count }),
          },
          {
            label: t('profile.courier.lastDelivery'),
            value: stats.last_delivered_at
              ? new Date(stats.last_delivered_at).toLocaleDateString()
              : t('profile.never'),
          },
        ]}
      />

      <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" sx={{ mb: 3 }}>
        <Tab value="overview" label={t('profile.tabs.overview')} />
        <Tab value="orders" label={`${t('profile.tabs.orders')} (${stats.order_count})`} />
        <Tab value="money" label={t('profile.tabs.settlements')} />
        <Tab value="attendance" label={t('profile.tabs.attendance')} />
        <Tab value="audit" label={t('profile.tabs.audit')} />
      </Tabs>

      {tab === 'overview' && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 4 }}>
            <InfoCard
              title={t('profile.courier.profile')}
              icon={<TwoWheelerIcon color="primary" />}
              rows={[
                { label: t('profile.courier.code'), value: <span dir="ltr">{courier.code}</span> },
                { label: t('profile.courier.phone'), value: <span dir="ltr">{courier.phone || '—'}</span> },
                { label: t('profile.courier.branch'), value: courier.branch_name || '—' },
                { label: t('profile.courier.vehicle'), value: courier.vehicle_type || '—' },
                {
                  label: t('profile.courier.feePerDelivery'),
                  value: formatMoney(courier.compensation_per_delivery, currency),
                },
                {
                  label: t('profile.status'),
                  value: (
                    <Chip
                      size="small"
                      label={courier.is_active ? t('profile.active') : t('profile.inactive')}
                      color={courier.is_active ? 'success' : 'default'}
                    />
                  ),
                },
              ]}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <InfoCard
              title={t('profile.courier.today')}
              icon={<AccessTimeIcon color="info" />}
              rows={[
                { label: t('profile.courier.attendanceStatus'), value: courier.attendance?.status || 'CHECKED_OUT' },
                {
                  label: t('profile.courier.availability'),
                  value: courier.attendance?.availability_status || 'OFF_LINE',
                },
                {
                  label: t('profile.courier.checkedIn'),
                  value: <span dir="ltr">{formatDateTime(courier.attendance?.checked_in_at)}</span>,
                },
                { label: t('profile.courier.activeDeliveries'), value: courier.active_delivery_count || 0 },
              ]}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <InfoCard
              title={t('profile.courier.terminal')}
              icon={<PointOfSaleIcon color="action" />}
              rows={[
                {
                  label: t('profile.courier.assignedTerminal'),
                  value: courier.active_terminal?.terminal_name || t('profile.courier.unassigned'),
                },
                {
                  label: t('profile.courier.assignedAt'),
                  value: <span dir="ltr">{formatDateTime(courier.active_terminal?.assigned_at)}</span>,
                },
              ]}
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Card sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                {t('profile.courier.quickStatus')}
              </Typography>
              <Stack sx={{ flexDirection: 'row', gap: 1.5, flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  color="success"
                  disabled={courier.status === 'AVAILABLE'}
                  onClick={() => handleStatusUpdate('AVAILABLE')}
                >
                  {t('profile.courier.setAvailable')}
                </Button>
                <Button
                  variant="outlined"
                  color="warning"
                  disabled={courier.status === 'ON_DELIVERY'}
                  onClick={() => handleStatusUpdate('ON_DELIVERY')}
                >
                  {t('profile.courier.setOnDelivery')}
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  disabled={courier.status === 'INACTIVE'}
                  onClick={() => handleStatusUpdate('INACTIVE')}
                >
                  {t('profile.courier.setInactive')}
                </Button>
              </Stack>
            </Card>
          </Grid>
        </Grid>
      )}

      {tab === 'orders' && <ProfileOrdersTable orders={profile.orders} />}

      {tab === 'money' && (
        <Stack spacing={2}>
          <Alert severity={MoneyUtil.isZero(cashDiscrepancy) ? 'info' : 'warning'}>
            {t('profile.courier.discrepancyNotice', {
              count: profile.settlements.length,
              amount: formatMoney(cashDiscrepancy, currency),
            })}
          </Alert>
          <Box>
            <ProfileTable
              head={[
                t('profile.courier.settlementNumber'),
                t('profile.courier.settlementDate'),
                t('profile.status'),
                t('profile.courier.expectedCash'),
                t('profile.courier.actualCash'),
                t('profile.courier.discrepancy'),
                t('profile.courier.net'),
              ]}
              empty={t('profile.courier.noSettlements')}
              isEmpty={profile.settlements.length === 0}
            >
              {profile.settlements.map((s) => (
                <TableRow key={s.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{s.settlement_number}</TableCell>
                  <TableCell dir="ltr">{formatDateTime(s.settlement_date)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={s.status} />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatMoney(s.expected_cash_amount, currency)}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatMoney(s.actual_cash_amount, currency)}</TableCell>
                  <TableCell
                    sx={{
                      whiteSpace: 'nowrap',
                      color: MoneyUtil.isZero(s.cash_discrepancy_amount || '0') ? 'text.primary' : 'error.main',
                    }}
                  >
                    {formatMoney(s.cash_discrepancy_amount, currency)}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {formatMoney(s.net_settlement_amount, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </ProfileTable>
            <LimitNotice shown={profile.settlements.length} limit={50} />
          </Box>
        </Stack>
      )}

      {tab === 'attendance' && (
        <Stack spacing={3}>
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              {t('profile.courier.attendanceHistory')}
            </Typography>
            <ProfileTable
              head={[
                t('profile.courier.date'),
                t('profile.courier.branch'),
                t('profile.courier.attendanceStatus'),
                t('profile.courier.availability'),
                t('profile.courier.checkedIn'),
                t('profile.courier.checkedOut'),
              ]}
              empty={t('profile.courier.noAttendance')}
              isEmpty={profile.attendance.length === 0}
            >
              {profile.attendance.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell dir="ltr">{row.date}</TableCell>
                  <TableCell>{row.branch_name || '—'}</TableCell>
                  <TableCell>
                    <Chip size="small" label={row.status} color={row.status === 'CHECKED_IN' ? 'success' : 'default'} />
                  </TableCell>
                  <TableCell>{row.availability_status}</TableCell>
                  <TableCell dir="ltr">{formatDateTime(row.checked_in_at)}</TableCell>
                  <TableCell dir="ltr">{formatDateTime(row.checked_out_at)}</TableCell>
                </TableRow>
              ))}
            </ProfileTable>
          </Box>
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              {t('profile.courier.terminalHistory')}
            </Typography>
            <ProfileTable
              head={[
                t('profile.courier.assignedTerminal'),
                t('profile.courier.assignedAt'),
                t('profile.courier.unassignedAt'),
                t('profile.status'),
              ]}
              empty={t('profile.courier.noTerminals')}
              isEmpty={profile.terminals.length === 0}
            >
              {profile.terminals.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>{row.terminal_name || row.terminal_code || row.terminal_id}</TableCell>
                  <TableCell dir="ltr">{formatDateTime(row.assigned_at)}</TableCell>
                  <TableCell dir="ltr">{formatDateTime(row.unassigned_at)}</TableCell>
                  <TableCell>
                    {row.is_active && <Chip size="small" color="success" label={t('profile.courier.current')} />}
                  </TableCell>
                </TableRow>
              ))}
            </ProfileTable>
          </Box>
        </Stack>
      )}

      {tab === 'audit' && <ProfileAuditTable events={profile.audit} />}
    </Container>
  );
}

export default CourierDetailPage;
