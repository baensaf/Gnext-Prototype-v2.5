import type { ProfileLedger, CustomerProfile } from 'src/api/profilesApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import HomeIcon from '@mui/icons-material/Home';
import PersonIcon from '@mui/icons-material/Person';
import CreditScoreIcon from '@mui/icons-material/CreditScore';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
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
  Typography,
  CircularProgress,
} from '@mui/material';

import { paths } from 'src/routes/paths';
import { useParams } from 'src/routes/hooks';

import { fDate } from 'src/utils/format-time';
import { localMobile } from 'src/utils/phone';
import { MoneyUtil } from 'src/utils/money.util';

import { profilesApi } from 'src/api/profilesApi';

import {
  InfoCard,
  formatMoney,
  LimitNotice,
  ProfileKpis,
  ProfileTable,
  ProfileHeader,
  formatDateTime,
  ProfileOrdersTable,
} from 'src/components/entity-profile';

type ProfileTab = 'overview' | 'orders' | 'wallet' | 'credit';

export function CustomerProfilePage() {
  const { t } = useTranslation();
  const { id } = useParams();

  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ProfileTab>('overview');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setProfile(await profilesApi.customer(id));
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

  const { customer, stats, credit, wallet } = profile;
  const fullName = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || customer.code;
  // A credit balance below zero is what the customer owes.
  const owed = credit && MoneyUtil.lessThan(credit.account.current_balance, '0')
    ? MoneyUtil.subtract('0', credit.account.current_balance)
    : '0';

  /** One account's transactions, newest first: the wallet's or the credit account's. */
  const ledger = (account: ProfileLedger) => (
    <Box>
      <ProfileTable
        head={[
          t('profile.customer.postedAt'),
          t('profile.customer.entryType'),
          t('profile.customer.amount'),
          t('profile.customer.balanceAfter'),
          t('profile.customer.reason'),
        ]}
        empty={t('profile.customer.noEntries')}
        isEmpty={account.entries.length === 0}
      >
        {account.entries.map((entry) => (
          <TableRow key={entry.id} hover>
            <TableCell dir="ltr">{formatDateTime(entry.posted_at)}</TableCell>
            <TableCell>
              <Chip size="small" label={t(`credit.types.${entry.entry_type}`, entry.entry_type)} />
            </TableCell>
            <TableCell
              sx={{
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: MoneyUtil.lessThan(entry.amount, '0') ? 'error.main' : 'success.main',
              }}
            >
              {formatMoney(entry.amount, entry.currency_code)}
            </TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatMoney(entry.balance_after, entry.currency_code)}</TableCell>
            <TableCell>{entry.reason_text || entry.reference || '—'}</TableCell>
          </TableRow>
        ))}
      </ProfileTable>
      <LimitNotice shown={account.entries.length} limit={50} />
    </Box>
  );

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <ProfileHeader
        title={fullName}
        subtitle={
          <span dir="ltr">
            {customer.code} · {localMobile(customer.mobile)}
          </span>
        }
        backTo={paths.app.customers.root}
        onRefresh={load}
        chips={
          <Chip
            label={customer.is_active ? t('profile.active') : t('profile.inactive')}
            color={customer.is_active ? 'success' : 'default'}
          />
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
            label: t('profile.kpi.orders'),
            value: stats.order_count,
            hint: t('profile.kpi.completedCancelled', {
              completed: stats.completed_count,
              cancelled: stats.cancelled_count,
            }),
          },
          { label: t('profile.kpi.spent'), value: formatMoney(stats.completed_value) },
          { label: t('profile.kpi.averageTicket'), value: formatMoney(stats.average_value) },
          {
            label: t('profile.kpi.lastOrder'),
            value: stats.last_order_at ? fDate(stats.last_order_at) : t('profile.never'),
          },
          {
            label: t('profile.customer.walletBalance'),
            value: wallet ? formatMoney(wallet.account.current_balance, wallet.account.currency_code) : '—',
          },
          {
            label: t('profile.customer.owed'),
            value: credit ? formatMoney(owed, credit.account.currency_code) : '—',
            hint: credit
              ? t('profile.customer.limitOf', { limit: formatMoney(credit.account.credit_limit) })
              : undefined,
          },
        ]}
      />

      <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" sx={{ mb: 3 }}>
        <Tab value="overview" label={t('profile.tabs.overview')} />
        <Tab value="orders" label={`${t('profile.tabs.orders')} (${stats.order_count})`} />
        <Tab value="wallet" label={t('profile.tabs.wallet')} />
        <Tab value="credit" label={t('profile.tabs.credit')} />
      </Tabs>

      {tab === 'overview' && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <InfoCard
              title={t('profile.customer.contact')}
              icon={<PersonIcon color="primary" />}
              rows={[
                { label: t('profile.customer.code'), value: <span dir="ltr">{customer.code}</span> },
                { label: t('profile.customer.mobile'), value: <span dir="ltr">{localMobile(customer.mobile)}</span> },
                { label: t('profile.customer.email'), value: customer.email || '—' },
                { label: t('profile.customer.nationalId'), value: customer.national_id || '—' },
                { label: t('profile.createdAt'), value: <span dir="ltr">{formatDateTime(customer.created_at)}</span> },
                {
                  label: t('profile.kpi.firstOrder'),
                  value: <span dir="ltr">{formatDateTime(stats.first_order_at)}</span>,
                },
              ]}
            >
              {profile.phones.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('profile.customer.phones')}
                  </Typography>
                  <Stack sx={{ flexDirection: 'row', flexWrap: 'wrap', gap: 1 }}>
                    {profile.phones.map((phone) => (
                      <Chip
                        key={phone.id}
                        size="small"
                        variant={phone.is_primary ? 'filled' : 'outlined'}
                        color={phone.is_primary ? 'primary' : 'default'}
                        label={<span dir="ltr">{phone.phone_number}</span>}
                        title={phone.label}
                      />
                    ))}
                  </Stack>
                </Box>
              )}
            </InfoCard>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <InfoCard title={t('profile.customer.addresses')} icon={<HomeIcon color="info" />}>
              {profile.addresses.length === 0 ? (
                <Typography color="text.secondary">{t('profile.noneRecorded')}</Typography>
              ) : (
                <Stack spacing={1.5}>
                  {profile.addresses.map((address) => (
                    <Box key={address.id}>
                      <Typography variant="subtitle2">
                        {address.title}{' '}
                        {address.is_default && (
                          <Chip size="small" color="primary" label={t('profile.customer.default')} sx={{ ml: 1 }} />
                        )}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {address.address_text}
                        {address.postal_code ? ` · ${address.postal_code}` : ''}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              )}
            </InfoCard>
          </Grid>
        </Grid>
      )}

      {tab === 'orders' && <ProfileOrdersTable orders={profile.orders} />}

      {tab === 'wallet' &&
        (wallet ? (
          <Stack spacing={3}>
            <InfoCard
              title={t('profile.customer.wallet')}
              icon={<AccountBalanceWalletIcon color="success" />}
              rows={[
                {
                  label: t('profile.customer.walletBalance'),
                  value: formatMoney(wallet.account.current_balance, wallet.account.currency_code),
                },
              ]}
            />
            {ledger(wallet)}
          </Stack>
        ) : (
          <Alert severity="info">{t('profile.customer.noWallet')}</Alert>
        ))}

      {tab === 'credit' &&
        (credit ? (
          <Stack spacing={3}>
            <InfoCard
              title={t('profile.customer.creditAccount')}
              icon={<CreditScoreIcon color="primary" />}
              rows={[
                { label: t('profile.customer.owed'), value: formatMoney(owed, credit.account.currency_code) },
                { label: t('profile.customer.creditLimit'), value: formatMoney(credit.account.credit_limit) },
                {
                  label: t('profile.customer.available'),
                  value: formatMoney(MoneyUtil.add(credit.account.current_balance, credit.account.credit_limit)),
                },
              ]}
            />
            {ledger(credit)}
          </Stack>
        ) : (
          <Alert severity="info">{t('profile.customer.noAccount')}</Alert>
        ))}

    </Container>
  );
}

export default CustomerProfilePage;
