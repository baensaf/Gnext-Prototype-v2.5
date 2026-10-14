import type { AddressDraftState } from 'src/components/customer-register';
import type { ProfileLedger, CustomerProfile } from 'src/api/profilesApi';
import type { Customer, CustomField, CustomerAddress } from 'src/api/customerApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import EditIcon from '@mui/icons-material/Edit';
import HomeIcon from '@mui/icons-material/Home';
import PlaceIcon from '@mui/icons-material/Place';
import PersonIcon from '@mui/icons-material/Person';
import CreditScoreIcon from '@mui/icons-material/CreditScore';
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
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
  Switch,
  MenuItem,
  TableRow,
  TableCell,
  TextField,
  Typography,
  InputAdornment,
  FormControlLabel,
} from '@mui/material';

import { fDate } from 'src/utils/format-time';
import { localMobile } from 'src/utils/phone';
import { MoneyUtil } from 'src/utils/money.util';

import { profilesApi } from 'src/api/profilesApi';
import { customerApi } from 'src/api/customerApi';
import { isManagerOrAbove } from 'src/config/role-access';
import { useBranchContext } from 'src/contexts/branch-context';
import { useAuthStore, useIsHeadOffice } from 'src/store/useAuthStore';

import { VersionTag } from 'src/components/version-tag';
import { CalendarDateField } from 'src/components/calendar-date-field';
import { CustomerAddressFields } from 'src/components/customer-register';
import { CustomFieldInputs } from 'src/components/customer-register/custom-field-inputs';
import { CustomerCreditPanel } from 'src/components/customer-credit/customer-credit-panel';
import {
  InfoCard,
  formatMoney,
  LimitNotice,
  ProfileKpis,
  ProfileTable,
  ProfileDrawer,
  formatDateTime,
  ProfileOrdersTable,
} from 'src/components/entity-profile';

export type CustomerDrawerTab = 'overview' | 'orders' | 'addresses' | 'wallet' | 'credit';

/** The rates HAMI's data shows: 10% and 20% cover most personal discounts. */
const DISCOUNT_PRESETS = ['10', '15', '20'];

type Props = {
  /** The customer to show; null closes the drawer. */
  customerId: string | null;
  tab?: CustomerDrawerTab;
  onTabChange?: (tab: CustomerDrawerTab) => void;
  onClose: () => void;
  /** After anything is saved, so the list behind shows the new figures. */
  onChanged: () => void;
};

/**
 * One customer over the customer list: the figures, contact details, personal discount,
 * orders, addresses, wallet and credit, each changed where it is shown. The customer had a
 * page of its own and three dialogs off the row until 2026-10-14.
 */
export function CustomerDrawer({
  customerId,
  tab: tabProp,
  onTabChange,
  onClose,
  onChanged,
}: Props) {
  const { t } = useTranslation();
  const isHeadOffice = useIsHeadOffice();
  const userRole = useAuthStore((state) => state.user?.role);
  // A personal discount is each branch's own: a manager keeps theirs, head office any branch's.
  const canSetDiscount = isManagerOrAbove(userRole);
  const { branches, selectedBranch, canChangeScope } = useBranchContext();
  const branchName = (id?: string | null) => branches.find((b) => b.id === id)?.name || '—';

  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [record, setRecord] = useState<Customer | null>(null);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownTab, setOwnTab] = useState<CustomerDrawerTab>('overview');
  const tab = tabProp ?? ownTab;
  const setTab = (next: CustomerDrawerTab) => (onTabChange ? onTabChange(next) : setOwnTab(next));

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const [p, c, a] = await Promise.all([
        profilesApi.customer(customerId),
        customerApi.getCustomer(customerId),
        customerApi.getAddresses(customerId),
      ]);
      setProfile(p);
      setRecord(c);
      setAddresses(a);
      setError(null);
    } catch (err: any) {
      setError(err?.detail || err?.message || t('profile.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [customerId, t]);

  useEffect(() => {
    setProfile(null);
    setEditing(false);
    setOwnTab('overview');
    load();
  }, [load]);

  useEffect(() => {
    customerApi
      .getCustomFields()
      .then(setFields)
      .catch(() => setFields([]));
  }, []);

  const changed = async () => {
    await load();
    onChanged();
  };

  // ---- Contact: edited in place -------------------------------------------------------
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [email, setEmail] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    if (!record) return;
    setName(`${record.first_name || ''} ${record.last_name || ''}`.trim());
    setBirthDate(record.birth_date || '');
    setEmail(record.email || '');
    setNationalId(record.national_id || '');
    setIsActive(record.is_active);
    setCustomValues(
      Object.fromEntries(Object.entries(record.custom_values || {}).map(([k, v]) => [k, v ?? '']))
    );
    setEditing(true);
  };

  const saveContact = async () => {
    if (!customerId) return;
    const missing = fields.find((f) => f.is_required && !customValues[f.id]?.trim());
    if (missing) {
      setError(t('customers.register.errors.fieldRequired', { name: missing.name }));
      return;
    }
    setSaving(true);
    try {
      // The whole name in one box, as the register form takes it; an untouched name keeps
      // its first and last parts.
      const oldName = `${record?.first_name || ''} ${record?.last_name || ''}`.trim();
      const nameChange =
        name.trim() === oldName
          ? {}
          : { first_name: name.trim() || record?.code || '', last_name: '' };
      await customerApi.updateCustomer(customerId, {
        ...nameChange,
        birth_date: birthDate || null,
        email: email.trim() || null,
        national_id: nationalId.trim() || null,
        is_active: isActive,
        custom_values: customValues,
      });
      setEditing(false);
      await changed();
    } catch (err: any) {
      setError(err?.detail || err?.message || t('customers.drawer.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // ---- Personal discount: one percent per branch ---------------------------------------
  const [discountBranchId, setDiscountBranchId] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [discountNote, setDiscountNote] = useState('');
  const [discountSaving, setDiscountSaving] = useState(false);

  const rates = profile?.family_discounts || [];
  // The rates this account sees: a branch its own; head office every branch's.
  const visibleRates = rates.filter((f) => canChangeScope || f.branch_id === selectedBranch?.id);

  const pickDiscountBranch = useCallback(
    (branchId: string) => {
      const current = rates.find((f) => f.branch_id === branchId);
      setDiscountBranchId(branchId);
      setDiscountPercent(current ? String(Number(current.percent)) : '');
      setDiscountNote(current?.note || '');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile]
  );

  useEffect(() => {
    if (profile) pickDiscountBranch(selectedBranch?.id || branches[0]?.id || '');
  }, [profile, selectedBranch, branches, pickDiscountBranch]);

  const saveDiscount = async (remove = false) => {
    if (!customerId) return;
    setDiscountSaving(true);
    try {
      await customerApi.setFamilyDiscount({
        customer_id: customerId,
        branch_id: discountBranchId || undefined,
        percent: remove || !discountPercent ? null : discountPercent,
        note: discountNote.trim() || null,
      });
      await changed();
    } catch (err: any) {
      setError(err?.detail || t('customers.family.saveFailed'));
    } finally {
      setDiscountSaving(false);
    }
  };

  // ---- Addresses ------------------------------------------------------------------------
  const emptyDraft = (): AddressDraftState => ({
    title: t('customers.register.addressTitleDefault'),
    address_text: '',
    postal_code: '',
    latitude: null,
    longitude: null,
  });
  const [draft, setDraft] = useState<AddressDraftState>(emptyDraft);

  const addAddress = async () => {
    if (!customerId || !draft.address_text.trim()) return;
    try {
      await customerApi.createAddress(customerId, {
        title: draft.title.trim() || t('customers.register.addressTitleDefault'),
        address_text: draft.address_text.trim(),
        postal_code: draft.postal_code?.trim() || undefined,
        latitude: draft.latitude ?? null,
        longitude: draft.longitude ?? null,
        is_default: addresses.length === 0,
      });
      setDraft(emptyDraft());
      setAddresses(await customerApi.getAddresses(customerId));
    } catch (err: any) {
      setError(err?.detail || t('customers.directory.errors.addressesFailed'));
    }
  };

  // ---------------------------------------------------------------------------------------
  const customer = profile?.customer;
  const stats = profile?.stats;
  const credit = profile?.credit ?? null;
  const wallet = profile?.wallet ?? null;
  const fullName = customer
    ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || customer.code
    : '';
  // A credit balance below zero is what the customer owes.
  const owed =
    credit && MoneyUtil.lessThan(credit.account.current_balance, '0')
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
            <TableCell sx={{ whiteSpace: 'nowrap' }}>
              {formatMoney(entry.balance_after, entry.currency_code)}
            </TableCell>
            <TableCell>{entry.reason_text || entry.reference || '—'}</TableCell>
          </TableRow>
        ))}
      </ProfileTable>
      <LimitNotice shown={account.entries.length} limit={50} />
    </Box>
  );

  const tabsBar = (
    <Tabs
      value={tab}
      onChange={(_, value) => setTab(value)}
      variant="scrollable"
      scrollButtons={false}
      sx={{ mt: 1.5 }}
    >
      <Tab value="overview" label={t('profile.tabs.overview')} />
      <Tab
        value="orders"
        label={
          stats ? `${t('profile.tabs.orders')} (${stats.order_count})` : t('profile.tabs.orders')
        }
      />
      <Tab value="addresses" label={`${t('profile.customer.addresses')} (${addresses.length})`} />
      <Tab value="wallet" label={t('profile.tabs.wallet')} />
      <Tab value="credit" label={t('profile.tabs.credit')} />
    </Tabs>
  );

  return (
    <ProfileDrawer
      open={!!customerId}
      onClose={onClose}
      title={fullName || undefined}
      subtitle={
        customer && (
          <span dir="ltr">
            {customer.code} · {localMobile(customer.mobile)}
          </span>
        )
      }
      chips={
        customer && (
          <Chip
            size="small"
            label={customer.is_active ? t('profile.active') : t('profile.inactive')}
            color={customer.is_active ? 'success' : 'default'}
          />
        )
      }
      loading={loading && !profile}
      error={error}
      onRefresh={load}
      bar={tabsBar}
    >
      {customer && stats && (
        <>
          {tab === 'overview' && (
            <Stack spacing={2.5}>
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
                  {
                    label: t('profile.kpi.averageTicket'),
                    value: formatMoney(stats.average_value),
                  },
                  {
                    label: t('profile.kpi.lastOrder'),
                    value: stats.last_order_at ? fDate(stats.last_order_at) : t('profile.never'),
                  },
                  {
                    label: t('profile.customer.walletBalance'),
                    value: wallet
                      ? formatMoney(wallet.account.current_balance, wallet.account.currency_code)
                      : '—',
                  },
                  {
                    label: t('profile.customer.owed'),
                    value: credit ? formatMoney(owed, credit.account.currency_code) : '—',
                  },
                ]}
              />

              {/* Contact: read, or edited in place. */}
              <InfoCard
                title={t('profile.customer.contact')}
                icon={<PersonIcon color="primary" />}
                action={
                  !editing && (
                    <Button
                      size="small"
                      startIcon={<EditIcon />}
                      onClick={startEdit}
                      disabled={!record}
                    >
                      {t('common.edit')}
                    </Button>
                  )
                }
                rows={
                  editing
                    ? undefined
                    : [
                        {
                          label: t('profile.customer.mobile'),
                          value: <span dir="ltr">{localMobile(customer.mobile)}</span>,
                        },
                        {
                          label: t('customers.drawer.birthDate'),
                          value: record?.birth_date ? (
                            <span dir="ltr">{fDate(record.birth_date)}</span>
                          ) : (
                            '—'
                          ),
                        },
                        ...fields
                          .filter((f) => record?.custom_values?.[f.id])
                          .map((f) => ({
                            label: f.name,
                            value:
                              f.data_type === 'DATE'
                                ? fDate(record!.custom_values![f.id]!)
                                : record!.custom_values![f.id],
                          })),
                        { label: t('profile.customer.email'), value: customer.email || '—' },
                        {
                          label: t('profile.customer.nationalId'),
                          value: customer.national_id || '—',
                        },
                        {
                          label: t('profile.createdAt'),
                          value: <span dir="ltr">{formatDateTime(customer.created_at)}</span>,
                        },
                      ]
                }
              >
                {editing ? (
                  <Stack spacing={2}>
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          label={t('customers.register.name')}
                          fullWidth
                          size="small"
                          autoFocus
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <CalendarDateField
                          label={t('customers.drawer.birthDate')}
                          fullWidth
                          size="small"
                          value={birthDate}
                          onChange={(e) => setBirthDate(e.target.value)}
                        />
                      </Grid>
                      <CustomFieldInputs
                        fields={fields}
                        values={customValues}
                        onChange={(fieldId, value) =>
                          setCustomValues((current) => ({ ...current, [fieldId]: value }))
                        }
                      />
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          label={t('profile.customer.email')}
                          fullWidth
                          size="small"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          slotProps={{ htmlInput: { dir: 'ltr' } }}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          label={t('profile.customer.nationalId')}
                          fullWidth
                          size="small"
                          value={nationalId}
                          onChange={(e) => setNationalId(e.target.value)}
                          slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
                        />
                      </Grid>
                    </Grid>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={isActive}
                          onChange={(e) => setIsActive(e.target.checked)}
                        />
                      }
                      label={t('profile.active')}
                    />
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                      <Button onClick={() => setEditing(false)} disabled={saving}>
                        {t('common.cancel')}
                      </Button>
                      <Button variant="contained" onClick={saveContact} disabled={saving}>
                        {t('common.save')}
                      </Button>
                    </Stack>
                  </Stack>
                ) : (
                  profile!.phones.length > 1 && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        {t('profile.customer.phones')}
                      </Typography>
                      <Stack sx={{ flexDirection: 'row', flexWrap: 'wrap', gap: 1 }}>
                        {profile!.phones.map((phone) => (
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
                  )
                )}
              </InfoCard>

              {/* Personal discount: one person's percent off at one branch, filled in on the till. */}
              <InfoCard
                title={t('customers.family.title')}
                icon={<VolunteerActivismIcon color="secondary" />}
                action={<VersionTag feature="customers.family" />}
              >
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('customers.family.help')}
                </Typography>
                {visibleRates.length > 0 ? (
                  <Stack
                    direction="row"
                    sx={{ gap: 1, flexWrap: 'wrap', mb: canSetDiscount ? 2.5 : 0 }}
                  >
                    {visibleRates.map((f) => (
                      <Chip
                        key={f.id}
                        color="secondary"
                        variant="outlined"
                        label={`${Number(f.percent)}% · ${branchName(f.branch_id)}${f.note ? ` · ${f.note}` : ''}`}
                        sx={{ fontWeight: 600 }}
                      />
                    ))}
                  </Stack>
                ) : (
                  <Typography
                    variant="body2"
                    color="text.disabled"
                    sx={{ mb: canSetDiscount ? 2.5 : 0 }}
                  >
                    {t('customers.family.none')}
                  </Typography>
                )}
                {canSetDiscount && (
                  <Stack spacing={2}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      {canChangeScope && (
                        <TextField
                          select
                          size="small"
                          label={t('customers.family.branch')}
                          value={discountBranchId}
                          onChange={(e) => pickDiscountBranch(e.target.value)}
                          sx={{ minWidth: 180 }}
                        >
                          {branches.map((b) => (
                            <MenuItem key={b.id} value={b.id}>
                              {b.name}
                            </MenuItem>
                          ))}
                        </TextField>
                      )}
                      <TextField
                        size="small"
                        label={t('customers.family.percent')}
                        value={discountPercent}
                        onChange={(e) => setDiscountPercent(e.target.value.replace(/[^0-9.]/g, ''))}
                        slotProps={{
                          input: {
                            endAdornment: <InputAdornment position="end">%</InputAdornment>,
                          },
                        }}
                        sx={{ width: { sm: 150 }, flexShrink: 0 }}
                      />
                      <TextField
                        size="small"
                        fullWidth
                        label={t('customers.family.note')}
                        placeholder={t('customers.family.notePlaceholder')}
                        value={discountNote}
                        onChange={(e) => setDiscountNote(e.target.value)}
                      />
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      {DISCOUNT_PRESETS.map((pct) => (
                        <Chip
                          key={pct}
                          label={`${pct}%`}
                          size="small"
                          variant={discountPercent === pct ? 'filled' : 'outlined'}
                          color="secondary"
                          onClick={() => setDiscountPercent(pct)}
                        />
                      ))}
                      <Box sx={{ flex: 1 }} />
                      {rates.some((f) => f.branch_id === discountBranchId) && (
                        <Button
                          color="error"
                          disabled={discountSaving}
                          onClick={() => saveDiscount(true)}
                        >
                          {t('customers.family.remove')}
                        </Button>
                      )}
                      <Button
                        variant="contained"
                        color="secondary"
                        disabled={
                          discountSaving ||
                          !discountPercent ||
                          Number(discountPercent) <= 0 ||
                          Number(discountPercent) > 100 ||
                          !discountBranchId
                        }
                        onClick={() => saveDiscount()}
                      >
                        {t('common.save')}
                      </Button>
                    </Stack>
                  </Stack>
                )}
              </InfoCard>
            </Stack>
          )}

          {tab === 'orders' && <ProfileOrdersTable orders={profile!.orders} />}

          {tab === 'addresses' && (
            <Stack spacing={2.5}>
              {addresses.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('customers.register.noAddresses')}
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {addresses.map((a) => (
                    <Card key={a.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                      <Stack
                        direction="row"
                        sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
                      >
                        <HomeIcon fontSize="small" color="info" />
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                          {a.title}
                        </Typography>
                        {a.is_default && (
                          <Chip
                            label={t('profile.customer.default')}
                            size="small"
                            color="primary"
                          />
                        )}
                        {a.latitude != null && (
                          <Chip
                            icon={<PlaceIcon />}
                            label={t('customers.register.pinPlaced')}
                            size="small"
                            variant="outlined"
                          />
                        )}
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {a.address_text}
                        {a.postal_code ? ` — ${a.postal_code}` : ''}
                      </Typography>
                    </Card>
                  ))}
                </Stack>
              )}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                  {t('customers.register.addAddress')}
                </Typography>
                <CustomerAddressFields
                  value={draft}
                  onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
                />
                <Button
                  variant="contained"
                  size="small"
                  sx={{ mt: 1.5, fontWeight: 'bold' }}
                  disabled={!draft.address_text.trim()}
                  onClick={addAddress}
                >
                  {t('customers.register.addAddress')}
                </Button>
              </Box>
            </Stack>
          )}

          {tab === 'wallet' &&
            (wallet ? (
              <Stack spacing={2.5}>
                <InfoCard
                  title={t('profile.customer.wallet')}
                  icon={<AccountBalanceWalletIcon color="success" />}
                  action={<VersionTag feature="customers.wallet" />}
                  rows={[
                    {
                      label: t('profile.customer.walletBalance'),
                      value: formatMoney(
                        wallet.account.current_balance,
                        wallet.account.currency_code
                      ),
                    },
                  ]}
                />
                {ledger(wallet)}
              </Stack>
            ) : (
              <Alert severity="info">{t('profile.customer.noWallet')}</Alert>
            ))}

          {/* Credit: head office records repayments and sets the limit; a branch only reads it. */}
          {tab === 'credit' &&
            (isHeadOffice ? (
              <CustomerCreditPanel
                customerId={customer.id}
                accountId={credit?.account.id}
                onChanged={changed}
              />
            ) : credit ? (
              <Stack spacing={2.5}>
                <InfoCard
                  title={t('profile.customer.creditAccount')}
                  icon={<CreditScoreIcon color="primary" />}
                  action={<VersionTag feature="customers.credit" />}
                  rows={[
                    {
                      label: t('profile.customer.owed'),
                      value: formatMoney(owed, credit.account.currency_code),
                    },
                    {
                      label: t('profile.customer.creditLimit'),
                      value: formatMoney(credit.account.credit_limit),
                    },
                    {
                      label: t('profile.customer.available'),
                      value: formatMoney(
                        MoneyUtil.add(credit.account.current_balance, credit.account.credit_limit)
                      ),
                    },
                  ]}
                />
                {ledger(credit)}
              </Stack>
            ) : (
              <Alert severity="info">{t('profile.customer.noAccount')}</Alert>
            ))}
        </>
      )}
    </ProfileDrawer>
  );
}
