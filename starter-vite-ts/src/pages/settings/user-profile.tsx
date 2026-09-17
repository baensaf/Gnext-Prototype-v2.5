import type { UserProfile } from 'src/api/profilesApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import BadgeIcon from '@mui/icons-material/Badge';
import {
  Box,
  Tab,
  Chip,
  Grid,
  Tabs,
  Alert,
  Stack,
  TableRow,
  Container,
  TableCell,
  CircularProgress,
} from '@mui/material';

import { paths } from 'src/routes/paths';
import { useParams } from 'src/routes/hooks';

import { fDate } from 'src/utils/format-time';
import { MoneyUtil } from 'src/utils/money.util';

import { profilesApi } from 'src/api/profilesApi';
import { ROLE_LABELS } from 'src/config/role-access';

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

type ProfileTab = 'overview' | 'orders' | 'shifts' | 'audit';

export function UserProfilePage() {
  const { t } = useTranslation();
  const { id } = useParams();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ProfileTab>('overview');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setProfile(await profilesApi.user(id));
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || t('profile.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

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

  const { user, stats } = profile;
  const roleLabel = t(`auth.roles.${user.role}`, ROLE_LABELS[user.role] || user.role);
  const shortOverColor = MoneyUtil.lessThan(stats.net_short_over, '0')
    ? 'error.main'
    : MoneyUtil.greaterThan(stats.net_short_over, '0')
      ? 'warning.main'
      : 'text.primary';

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <ProfileHeader
        title={user.display_name}
        subtitle={<span dir="ltr">{user.username}</span>}
        backTo={paths.app.settings.users}
        onRefresh={load}
        chips={
          <>
            <Chip label={roleLabel} />
            <Chip
              color={user.branch_name ? 'default' : 'info'}
              variant="outlined"
              label={user.branch_name || t('auth.headOffice', 'Head office')}
            />
            <Chip
              color={user.is_active ? 'success' : 'default'}
              label={user.is_active ? t('profile.active') : t('profile.inactive')}
            />
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
            label: t('profile.user.ordersTaken'),
            value: stats.order_count,
            hint: t('profile.kpi.completedCancelled', {
              completed: stats.completed_count,
              cancelled: stats.cancelled_count,
            }),
          },
          { label: t('profile.user.salesValue'), value: formatMoney(stats.completed_value) },
          {
            label: t('profile.user.shifts'),
            value: stats.shift_count,
            hint: t('profile.user.closedShifts', { count: stats.closed_shift_count }),
          },
          {
            label: t('profile.user.netShortOver'),
            value: <Box component="span" sx={{ color: shortOverColor }}>{formatMoney(stats.net_short_over)}</Box>,
          },
          {
            label: t('profile.user.approvals'),
            value: stats.approval_decision_count,
            hint: t('profile.user.approvedRejected', {
              approved: stats.approved_count,
              rejected: stats.rejected_count,
            }),
          },
          {
            label: t('profile.user.lastLogin'),
            value: user.last_login_at ? fDate(user.last_login_at) : t('profile.never'),
          },
        ]}
      />

      <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" sx={{ mb: 3 }}>
        <Tab value="overview" label={t('profile.tabs.overview')} />
        <Tab value="orders" label={`${t('profile.tabs.orders')} (${stats.order_count})`} />
        <Tab value="shifts" label={t('profile.tabs.shiftsCash')} />
        <Tab value="audit" label={t('profile.tabs.audit')} />
      </Tabs>

      {tab === 'overview' && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <InfoCard
              title={t('profile.user.account')}
              icon={<BadgeIcon color="primary" />}
              rows={[
                { label: t('users.username', 'Username'), value: <span dir="ltr">{user.username}</span> },
                { label: t('users.displayName', 'Name'), value: user.display_name },
                { label: t('users.role', 'Role'), value: roleLabel },
                { label: t('users.scope', 'Scope'), value: user.branch_name || t('auth.headOffice', 'Head office') },
                { label: t('users.approves', 'Approves'), value: user.has_pin ? t('common.yes', 'Yes') : t('common.no', 'No') },
                { label: t('profile.user.locale'), value: user.preferred_locale },
              ]}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <InfoCard
              title={t('profile.user.history')}
              rows={[
                { label: t('profile.createdAt'), value: <span dir="ltr">{formatDateTime(user.created_at)}</span> },
                { label: t('profile.user.createdBy'), value: user.created_by_name || '—' },
                { label: t('profile.user.updatedAt'), value: <span dir="ltr">{formatDateTime(user.updated_at)}</span> },
                { label: t('profile.user.lastLogin'), value: <span dir="ltr">{formatDateTime(user.last_login_at)}</span> },
                { label: t('profile.kpi.lastOrder'), value: <span dir="ltr">{formatDateTime(stats.last_order_at)}</span> },
              ]}
            />
          </Grid>
        </Grid>
      )}

      {tab === 'orders' && <ProfileOrdersTable orders={profile.orders} />}

      {tab === 'shifts' && (
        <Stack spacing={1}>
          <ProfileTable
            head={[
              t('profile.user.shiftNumber'),
              t('profile.user.branchTerminal'),
              t('profile.user.businessDate'),
              t('profile.user.openedClosed'),
              t('profile.status'),
              t('profile.user.openingCash'),
              t('profile.user.expectedActual'),
              t('profile.user.shortOver'),
            ]}
            empty={t('profile.user.noShifts')}
            isEmpty={profile.shifts.length === 0}
          >
            {profile.shifts.map((shift) => (
              <TableRow key={shift.id} hover>
                <TableCell sx={{ fontFamily: 'monospace' }}>{shift.shift_number}</TableCell>
                <TableCell>
                  {shift.branch_name || '—'}
                  <Box component="span" sx={{ display: 'block', color: 'text.secondary', typography: 'caption' }}>
                    {shift.terminal_name || '—'}
                  </Box>
                </TableCell>
                <TableCell dir="ltr">{fDate(shift.business_date)}</TableCell>
                <TableCell dir="ltr" sx={{ whiteSpace: 'nowrap' }}>
                  {formatDateTime(shift.opened_at)}
                  <Box component="span" sx={{ display: 'block', color: 'text.secondary', typography: 'caption' }}>
                    {formatDateTime(shift.closed_at)}
                  </Box>
                </TableCell>
                <TableCell>
                  <Stack sx={{ gap: 0.5, alignItems: 'flex-start' }}>
                    <Chip size="small" label={shift.state} />
                    {!shift.opened_by_user && shift.closed_by_user && (
                      <Chip size="small" variant="outlined" label={t('profile.user.closedOnly')} />
                    )}
                  </Stack>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatMoney(shift.opening_cash, shift.currency_code)}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {shift.expected_cash ? formatMoney(shift.expected_cash, shift.currency_code) : '—'}
                  <Box component="span" sx={{ display: 'block', color: 'text.secondary', typography: 'caption' }}>
                    {shift.actual_cash ? formatMoney(shift.actual_cash, shift.currency_code) : '—'}
                  </Box>
                </TableCell>
                <TableCell
                  sx={{
                    whiteSpace: 'nowrap',
                    fontWeight: 600,
                    color:
                      shift.short_over && !MoneyUtil.isZero(shift.short_over) ? 'error.main' : 'text.primary',
                  }}
                >
                  {shift.short_over ? formatMoney(shift.short_over, shift.currency_code) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </ProfileTable>
          <LimitNotice shown={profile.shifts.length} limit={50} />
        </Stack>
      )}

      {tab === 'audit' && <ProfileAuditTable events={profile.audit} />}
    </Container>
  );
}

export default UserProfilePage;
