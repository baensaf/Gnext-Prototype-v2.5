import type { GridPaginationModel } from '@mui/x-data-grid-premium';
import type { CreditSummary } from 'src/api/creditApi';
import type { AddressDraftState } from 'src/components/customer-register';
import type { Customer, CustomerAddress, CustomerListFilter } from 'src/api/customerApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import AddIcon from '@mui/icons-material/Add';
import HomeIcon from '@mui/icons-material/Home';
import PlaceIcon from '@mui/icons-material/Place';
import SearchIcon from '@mui/icons-material/Search';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CreditScoreIcon from '@mui/icons-material/CreditScore';
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import {
  Box,
  Card,
  Chip,
  Grid,
  Link,
  Stack,
  Alert,
  Button,
  Dialog,
  MenuItem,
  TextField,
  Typography,
  IconButton,
  CardContent,
  DialogTitle,
  ToggleButton,
  DialogContent,
  DialogActions,
  InputAdornment,
  ToggleButtonGroup,
} from '@mui/material';

import { paths } from 'src/routes/paths';

import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyLabel } from 'src/utils/currency';

import { creditApi } from 'src/api/creditApi';
import { customerApi } from 'src/api/customerApi';
import { isManagerOrAbove } from 'src/config/role-access';
import { useBranchContext } from 'src/contexts/branch-context';
import { useAuthStore, useIsHeadOffice } from 'src/store/useAuthStore';

import { VersionTag } from 'src/components/version-tag';
import { ServerDataGrid } from 'src/components/server-data-grid';
import { CustomerCreditDialog } from 'src/components/customer-credit/customer-credit-dialog';
import { CustomerAddressFields, CustomerRegisterDialog } from 'src/components/customer-register';

const fullName = (c?: Customer | null) => (c ? `${c.first_name || ''} ${c.last_name || ''}`.trim() : '');

/** What a credit account's balance means to the customer: a negative balance is owed. */
const owedOf = (c: Customer) => {
  const balance = c.credit_account?.current_balance || '0';
  return MoneyUtil.greaterThan('0', balance) ? MoneyUtil.subtract('0', balance) : '0';
};

/** The rates HAMI's data shows: 10% and 20% cover most friends and family. */
const FAMILY_PRESETS = ['10', '15', '20'];

export function CustomersPage() {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();
  const navigate = useNavigate();
  const isHeadOffice = useIsHeadOffice();
  const userRole = useAuthStore((state) => state.user?.role);
  // Friends and family are each branch's own: a manager keeps theirs, head office any branch's.
  const canSetFamily = isManagerOrAbove(userRole);
  const { branches, selectedBranch, canChangeScope } = useBranchContext();
  const branchName = (id?: string | null) => branches.find((b) => b.id === id)?.name || '—';
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState<CustomerListFilter | ''>(() => {
    const has = searchParams.get('has');
    return has === 'FAMILY' || has === 'OWES' || has === 'WALLET' ? has : '';
  });

  // Friends-and-family dialog: one person's percent at one branch.
  const [familyFor, setFamilyFor] = useState<Customer | null>(null);
  const [familyBranchId, setFamilyBranchId] = useState('');
  const [familyPercent, setFamilyPercent] = useState('');
  const [familyNote, setFamilyNote] = useState('');
  const [familySaving, setFamilySaving] = useState(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [registerOpen, setRegisterOpen] = useState(false);

  // Credit account dialog (V3): balance, limit and the account's transactions
  const [creditFor, setCreditFor] = useState<Customer | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  // The chain's credit in one line, shown with the Owes filter.
  const [creditSummary, setCreditSummary] = useState<CreditSummary | null>(null);

  // Address dialog
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const emptyDraft = (): AddressDraftState => ({
    title: t('customers.register.addressTitleDefault'),
    address_text: '',
    postal_code: '',
    latitude: null,
    longitude: null,
  });
  const [draft, setDraft] = useState<AddressDraftState>(emptyDraft);

  // Paged on the server: a chain can have 500,000 customers. Search waits for a pause in
  // typing and needs 3 characters (fewer lists everyone, newest first).
  const [paging, setPaging] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPaging((p) => ({ ...p, page: 0 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await customerApi.getCustomersPage({
        search: query.length >= 3 ? query : undefined,
        page: paging.page + 1,
        limit: paging.pageSize,
        has: filter || undefined,
        // Head office looking at one branch sees that branch's friends and family.
        branchId: filter === 'FAMILY' && selectedBranch ? selectedBranch.id : undefined,
      });
      setCustomers(res.items);
      setTotal(res.total);
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('customers.directory.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [query, paging, filter, selectedBranch, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (filter !== 'OWES' || !isHeadOffice) return;
    creditApi.getSummary().then(setCreditSummary).catch(() => setCreditSummary(null));
  }, [filter, isHeadOffice, customers]);

  // The rates this screen shows: a branch sees its own; head office every branch's.
  const visibleFamily = (c: Customer) =>
    (c.family_discounts || []).filter((f) => canChangeScope || f.branch_id === selectedBranch?.id);

  const openFamily = (c: Customer) => {
    const branchId = selectedBranch?.id || branches[0]?.id || '';
    const current = (c.family_discounts || []).find((f) => f.branch_id === branchId);
    setFamilyFor(c);
    setFamilyBranchId(branchId);
    setFamilyPercent(current ? String(Number(current.percent)) : '');
    setFamilyNote(current?.note || '');
  };

  const pickFamilyBranch = (branchId: string) => {
    const current = (familyFor?.family_discounts || []).find((f) => f.branch_id === branchId);
    setFamilyBranchId(branchId);
    setFamilyPercent(current ? String(Number(current.percent)) : '');
    setFamilyNote(current?.note || '');
  };

  /** Saves the percent, or takes it away when `remove` (or the box is empty). */
  const saveFamily = async (remove = false) => {
    if (!familyFor) return;
    setFamilySaving(true);
    try {
      await customerApi.setFamilyDiscount({
        customer_id: familyFor.id,
        branch_id: familyBranchId || undefined,
        percent: remove || !familyPercent ? null : familyPercent,
        note: familyNote.trim() || null,
      });
      setFamilyFor(null);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('customers.family.saveFailed'));
    } finally {
      setFamilySaving(false);
    }
  };

  const handleOpenCredit = (c: Customer) => setCreditFor(c);

  const handleOpenAddresses = async (c: Customer) => {
    setSelectedCustomer(c);
    setDraft(emptyDraft());
    setAddressDialogOpen(true);
    try {
      setAddresses(await customerApi.getAddresses(c.id));
    } catch (err: any) {
      setError(err.detail || t('customers.directory.errors.addressesFailed'));
    }
  };

  const handleAddAddress = async () => {
    if (!selectedCustomer || !draft.address_text.trim()) return;
    try {
      await customerApi.createAddress(selectedCustomer.id, {
        title: draft.title.trim() || t('customers.register.addressTitleDefault'),
        address_text: draft.address_text.trim(),
        postal_code: draft.postal_code?.trim() || undefined,
        latitude: draft.latitude ?? null,
        longitude: draft.longitude ?? null,
        is_default: addresses.length === 0,
      });
      setAddresses(await customerApi.getAddresses(selectedCustomer.id));
      setDraft(emptyDraft());
    } catch (err: any) {
      setError(err.detail || t('customers.directory.errors.addressesFailed'));
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('customers.directory.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('customers.directory.subtitle')}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setRegisterOpen(true)} sx={{ fontWeight: 'bold' }}>
          {t('customers.registerCustomer')}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack direction="row" sx={{ mb: 3, gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder={t('customers.directory.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ width: 400, maxWidth: '100%' }}
          slotProps={{
            input: {
              startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
            },
          }}
        />
        {/* The few customers each of these is about, without a page of their own. */}
        <ToggleButtonGroup
          size="small"
          exclusive
          value={filter}
          onChange={(_e, value) => {
            setFilter(value ?? '');
            setPaging((p) => ({ ...p, page: 0 }));
          }}
        >
          <ToggleButton value="">{t('customers.filters.all')}</ToggleButton>
          <ToggleButton value="FAMILY">{t('customers.filters.family')}</ToggleButton>
          <ToggleButton value="WALLET">{t('customers.filters.wallet')}</ToggleButton>
          {isHeadOffice && <ToggleButton value="OWES">{t('customers.filters.owes')}</ToggleButton>}
        </ToggleButtonGroup>
      </Stack>

      {filter === 'OWES' && isHeadOffice && creditSummary && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {[
            { label: t('credit.totalOwed'), value: creditSummary.total_owed, color: 'error.main', hint: t('customers.creditSummary.owing', { count: creditSummary.owing_count }) },
            { label: t('credit.totalLimit'), value: creditSummary.total_limit, color: 'text.primary' },
            { label: t('credit.totalAvailable'), value: creditSummary.total_available, color: 'primary.main' },
          ].map((f) => (
            <Grid key={f.label} size={{ xs: 12, sm: 4 }}>
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    {f.label}
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 'bold', color: f.color, mt: 0.5 }}>
                    {MoneyUtil.formatCurrency(f.value)} {currency}
                  </Typography>
                  {f.hint && (
                    <Typography variant="caption" color="text.secondary">
                      {f.hint}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <ServerDataGrid
        rows={customers}
        columns={[
          {
            field: 'name',
            headerName: t('customers.name'),
            flex: 1,
            minWidth: 180,
            valueGetter: (_value, row) => fullName(row as Customer),
            renderCell: (params) => (
              <Link
                component="button"
                onClick={() => navigate(paths.app.customers.detail(params.row.id))}
                sx={{ fontWeight: 600 }}
              >
                {params.value || '—'}
              </Link>
            ),
          },
          {
            field: 'mobile',
            headerName: t('customers.directory.mobileCode'),
            width: 170,
            renderCell: (params) => <span dir="ltr">{params.value}</span>,
          },
          {
            field: 'family_discounts',
            headerName: t('customers.family.column'),
            width: 190,
            sortable: false,
            renderCell: (params) => {
              const rates = visibleFamily(params.row as Customer);
              if (rates.length === 0) return <Typography variant="body2" color="text.disabled">—</Typography>;
              return (
                <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap', py: 1 }}>
                  {rates.map((f) => (
                    <Chip
                      key={f.id}
                      size="small"
                      color="secondary"
                      variant="outlined"
                      label={canChangeScope ? `${Number(f.percent)}% · ${branchName(f.branch_id)}` : `${Number(f.percent)}%`}
                      sx={{ fontWeight: 600 }}
                    />
                  ))}
                </Stack>
              );
            },
          },
          {
            field: 'wallet_balance',
            headerName: t('customers.directory.walletColumn'),
            width: 160,
            renderCell: (params) => {
              const balance = (params.row as Customer).wallet_balance || '0';
              return MoneyUtil.greaterThan(balance, '0') ? (
                <Chip
                  icon={<AccountBalanceWalletIcon sx={{ '&&': { fontSize: 16 } }} />}
                  label={`${MoneyUtil.formatCurrency(balance)} ${currency}`}
                  color="success"
                  size="small"
                  variant="outlined"
                  sx={{ fontWeight: 600 }}
                />
              ) : (
                <Typography variant="body2" color="text.disabled">—</Typography>
              );
            },
          },
          ...(isHeadOffice
            ? [
                {
                  field: 'credit_owed',
                  headerName: t('customers.directory.owesColumn'),
                  width: 200,
                  sortable: false,
                  renderHeader: () => (
                    <>
                      {t('customers.directory.owesColumn')} <VersionTag feature="customers.credit" sx={{ ml: 1 }} />
                    </>
                  ),
                  renderCell: (params: any) => {
                    const c = params.row as Customer;
                    const owed = owedOf(c);
                    const limit = c.credit_account?.credit_limit || '0';
                    if (!c.credit_account || (MoneyUtil.isZero(owed) && !MoneyUtil.greaterThan(limit, '0'))) {
                      return <Typography variant="body2" color="text.disabled">—</Typography>;
                    }
                    return (
                      <Stack spacing={0.5} sx={{ alignItems: 'flex-start', py: 1 }}>
                        <Chip
                          icon={<CreditScoreIcon sx={{ '&&': { fontSize: 16 } }} />}
                          label={`${MoneyUtil.formatCurrency(owed)} ${currency}`}
                          color={MoneyUtil.greaterThan(owed, '0') ? 'error' : 'default'}
                          size="small"
                          onClick={() => handleOpenCredit(c)}
                          sx={{ fontWeight: 600, cursor: 'pointer' }}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                          {t('customers.directory.limit', { amount: `${MoneyUtil.formatCurrency(limit)} ${currency}` })}
                        </Typography>
                      </Stack>
                    );
                  },
                },
              ]
            : []),
          {
            field: 'is_active',
            headerName: t('common.status'),
            width: 140,
            renderCell: (params) => (
                <Chip
                  label={params.value ? t('customers.directory.active') : t('customers.directory.disabled')}
                  color={params.value ? 'success' : 'default'}
                  size="small"
                />
              ),
          },
          {
            field: 'actions',
            headerName: t('customers.directory.actions'),
            width: 200,
            sortable: false,
            renderCell: (params) => {
              const c = params.row as Customer;
              return (
                <Stack direction="row" spacing={0.5}>
                  <IconButton size="small" title={t('customers.directory.viewProfile')} onClick={() => navigate(paths.app.customers.detail(c.id))}>
                    <VisibilityIcon fontSize="small" />
                  </IconButton>
                  {canSetFamily && (
                    <IconButton size="small" title={t('customers.family.title')} color="secondary" onClick={() => openFamily(c)}>
                      <VolunteerActivismIcon fontSize="small" />
                    </IconButton>
                  )}
                  {isHeadOffice && (
                    <IconButton size="small" title={t('customers.directory.credit.title')} color="primary" onClick={() => handleOpenCredit(c)}>
                      <CreditScoreIcon fontSize="small" />
                    </IconButton>
                  )}
                  <IconButton size="small" title={t('customers.directory.addresses')} color="info" onClick={() => handleOpenAddresses(c)}>
                    <HomeIcon fontSize="small" />
                  </IconButton>
                </Stack>
              );
            },
          },
        ]}
        loading={loading}
        rowCount={total}
        paginationModel={paging}
        onPaginationModelChange={setPaging}
        pageSizeOptions={[25, 50, 100]}
        height={600}
        emptyTitle={t('customers.directory.emptyTitle')}
        emptyDescription={t('customers.directory.emptyDescription')}
      />

      <CustomerRegisterDialog
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onCreated={() => {
          setRegisterOpen(false);
          loadData();
        }}
        createCustomer={customerApi.createCustomer}
        showCredit={isHeadOffice}
      />

      {/* Credit (V3): what they owe, repayments and the limit, from the row. */}
      <CustomerCreditDialog customer={creditFor} onClose={() => setCreditFor(null)} onChanged={() => loadData()} />

      {/* Friends and family: one person's percent off at one branch, filled in on the till. */}
      <Dialog open={!!familyFor} onClose={() => setFamilyFor(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('customers.family.title')} — {fullName(familyFor)}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('customers.family.help')}
          </Typography>
          <Stack spacing={2}>
            {canChangeScope && (
              <TextField
                select
                size="small"
                label={t('customers.family.branch')}
                value={familyBranchId}
                onChange={(e) => pickFamilyBranch(e.target.value)}
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
              autoFocus
              label={t('customers.family.percent')}
              value={familyPercent}
              onChange={(e) => setFamilyPercent(e.target.value.replace(/[^0-9.]/g, ''))}
              slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }}
            />
            <Stack direction="row" spacing={1}>
              {FAMILY_PRESETS.map((pct) => (
                <Chip
                  key={pct}
                  label={`${pct}%`}
                  size="small"
                  variant={familyPercent === pct ? 'filled' : 'outlined'}
                  color="secondary"
                  onClick={() => setFamilyPercent(pct)}
                />
              ))}
            </Stack>
            <TextField
              size="small"
              label={t('customers.family.note')}
              placeholder={t('customers.family.notePlaceholder')}
              value={familyNote}
              onChange={(e) => setFamilyNote(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          {(familyFor?.family_discounts || []).some((f) => f.branch_id === familyBranchId) && (
            <Button color="error" disabled={familySaving} onClick={() => saveFamily(true)} sx={{ mr: 'auto' }}>
              {t('customers.family.remove')}
            </Button>
          )}
          <Button onClick={() => setFamilyFor(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={familySaving || !familyPercent || Number(familyPercent) <= 0 || Number(familyPercent) > 100 || !familyBranchId}
            onClick={() => saveFamily()}
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Addresses */}
      <Dialog open={addressDialogOpen} onClose={() => setAddressDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('customers.directory.addresses')} — {fullName(selectedCustomer)}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
            {t('customers.directory.savedAddresses')}
          </Typography>
          <Stack spacing={1} sx={{ mb: 3 }}>
            {addresses.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                {t('customers.register.noAddresses')}
              </Typography>
            )}
            {addresses.map((a) => (
              <Card key={a.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                  {a.title} {a.is_default && <Chip label={t('customers.directory.default')} size="small" color="primary" sx={{ ml: 1 }} />}
                  {a.latitude != null && (
                    <Chip icon={<PlaceIcon />} label={t('customers.register.pinPlaced')} size="small" variant="outlined" sx={{ ml: 1 }} />
                  )}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {a.address_text}
                  {a.postal_code ? ` — ${a.postal_code}` : ''}
                </Typography>
              </Card>
            ))}
          </Stack>

          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
            {t('customers.register.addAddress')}
          </Typography>
          <CustomerAddressFields value={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
          <Button
            variant="contained"
            size="small"
            sx={{ mt: 1.5, fontWeight: 'bold' }}
            disabled={!draft.address_text.trim()}
            onClick={handleAddAddress}
          >
            {t('customers.register.addAddress')}
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddressDialogOpen(false)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}
