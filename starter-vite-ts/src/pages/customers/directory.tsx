import type { GridFilterModel, GridPaginationModel, GridRowSelectionModel } from '@mui/x-data-grid-premium';
import type { CreditSummary } from 'src/api/creditApi';
import type { CustomerGroup } from 'src/api/discountsApi';
import type { CustomerDrawerTab } from './customer-drawer';
import type { Customer, CustomerListFilter } from 'src/api/customerApi';

import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useMemo, useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import CreditScoreIcon from '@mui/icons-material/CreditScore';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import {
  Box,
  Tab,
  Card,
  Chip,
  Grid,
  Link,
  Tabs,
  Stack,
  Alert,
  Button,
  Dialog,
  MenuItem,
  TextField,
  Typography,
  CardContent,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyLabel } from 'src/utils/currency';

import { creditApi } from 'src/api/creditApi';
import { customerApi } from 'src/api/customerApi';
import { discountsApi } from 'src/api/discountsApi';
import { isManagerOrAbove } from 'src/config/role-access';
import { useBranchContext } from 'src/contexts/branch-context';
import { useAuthStore, useIsHeadOffice } from 'src/store/useAuthStore';

import { Label } from 'src/components/label';
import { VersionTag } from 'src/components/version-tag';
import { ServerDataGrid } from 'src/components/server-data-grid';
import { CustomerRegisterDialog } from 'src/components/customer-register';

import { CustomerDrawer } from './customer-drawer';

const fullName = (c?: Customer | null) => (c ? `${c.first_name || ''} ${c.last_name || ''}`.trim() : '');

/** What a credit account's balance means to the customer: a negative balance is owed. */
const owedOf = (c: Customer) => {
  const balance = c.credit_account?.current_balance || '0';
  return MoneyUtil.greaterThan('0', balance) ? MoneyUtil.subtract('0', balance) : '0';
};

const DRAWER_TABS: CustomerDrawerTab[] = ['overview', 'orders', 'addresses', 'wallet', 'credit'];

export function CustomersPage() {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();
  const isHeadOffice = useIsHeadOffice();
  const { branches, canChangeScope } = useBranchContext();
  const branchName = (id?: string | null) => branches.find((b) => b.id === id)?.name || '—';
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<CustomerListFilter | ''>(() => {
    const has = searchParams.get('has');
    // FAMILY was the personal discount tab before groups (2026-10-16).
    if (has === 'FAMILY') return 'GROUPED';
    return has === 'GROUPED' || has === 'OWES' || has === 'WALLET' ? has : '';
  });
  // One group's people, as ?group=<id> (the groups page links its member counts here).
  const groupFilter = searchParams.get('group') || '';
  const setGroupFilter = (id: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('group', id);
      else next.delete('group');
      return next;
    });
    setPaging((p) => ({ ...p, page: 0 }));
  };
  const canAddToGroups = isManagerOrAbove(useAuthStore((state) => state.user?.role));
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  useEffect(() => {
    discountsApi
      .getCustomerGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);

  // One customer opens in the drawer as ?customer=<id> (and &tab=), so it can be linked to.
  const drawerCustomerId = searchParams.get('customer');
  const tabParam = searchParams.get('tab') as CustomerDrawerTab | null;
  const drawerTab: CustomerDrawerTab = tabParam && DRAWER_TABS.includes(tabParam) ? tabParam : 'overview';
  const openCustomer = (id: string, tab: CustomerDrawerTab = 'overview') =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('customer', id);
      if (tab === 'overview') next.delete('tab');
      else next.set('tab', tab);
      return next;
    });
  const setDrawerTab = (tab: CustomerDrawerTab) => {
    if (drawerCustomerId) openCustomer(drawerCustomerId, tab);
  };
  const closeCustomer = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('customer');
      next.delete('tab');
      return next;
    });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [counts, setCounts] = useState<Partial<Record<'ALL' | CustomerListFilter, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [registerOpen, setRegisterOpen] = useState(false);
  // The chain's credit in one line, shown with the Owes filter.
  const [creditSummary, setCreditSummary] = useState<CreditSummary | null>(null);

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
        groupId: groupFilter || undefined,
      });
      setCustomers(res.items);
      setTotal(res.total);
      if (res.counts) setCounts(res.counts);
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('customers.directory.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [query, paging, filter, groupFilter, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (filter !== 'OWES' || !isHeadOffice) return;
    creditApi.getSummary().then(setCreditSummary).catch(() => setCreditSummary(null));
  }, [filter, isHeadOffice, customers]);

  // Which customers: the tabs on the grid's toolbar line, as on the orders list. Owes is head
  // office's, like the rest of credit.
  const tabs: { key: '' | CustomerListFilter; label: string; color: 'default' | 'secondary' | 'success' | 'error'; count?: number }[] = [
    { key: '', label: t('customers.filters.all'), color: 'default', count: counts.ALL },
    { key: 'GROUPED', label: t('customers.filters.grouped'), color: 'secondary', count: counts.GROUPED },
    { key: 'WALLET', label: t('customers.filters.wallet'), color: 'success', count: counts.WALLET },
    ...(isHeadOffice ? [{ key: 'OWES' as const, label: t('customers.filters.owes'), color: 'error' as const, count: counts.OWES }] : []),
  ];
  const tabsBar = (
    <Tabs
      value={filter}
      onChange={(_e, value) => {
        setFilter(value);
        setPaging((p) => ({ ...p, page: 0 }));
      }}
      variant="scrollable"
      scrollButtons={false}
      sx={{ minHeight: 48, minWidth: 0 }}
    >
      {tabs.map(({ key, label, color, count }) => (
        <Tab
          key={key || 'ALL'}
          value={key}
          iconPosition="end"
          label={label}
          icon={
            <Label variant={key === filter ? 'filled' : 'soft'} color={color}>
              {count ?? 0}
            </Label>
          }
          sx={{ minHeight: 48 }}
        />
      ))}
    </Tabs>
  );
  const gridFilterModel = useMemo<GridFilterModel>(() => ({ items: [], quickFilterValues: search ? [search] : [] }), [search]);

  // Rows ticked for "Add to group". Selecting the whole page arrives as everything but the
  // unticked rows, so it is read against the rows on screen.
  const [selection, setSelection] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() });
  const selectedIds =
    selection.type === 'include'
      ? [...selection.ids].map(String)
      : customers.filter((c) => !selection.ids.has(c.id)).map((c) => c.id);
  const [addOpen, setAddOpen] = useState(false);
  const [addGroupId, setAddGroupId] = useState('');
  const [addBranchId, setAddBranchId] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // A branch adds its own people, to the groups head office opens to branches.
  const addable = groups.filter((g) => canChangeScope || g.branch_can_assign);
  const addSelected = async () => {
    if (!addGroupId || !selectedIds.length) return;
    setAdding(true);
    try {
      const res = await discountsApi.addGroupMembers(addGroupId, { customer_ids: selectedIds, branch_id: addBranchId || null });
      setNotice(t('customers.groups.added', { count: res.added, already: res.already }));
      setAddOpen(false);
      setSelection({ type: 'include', ids: new Set() });
      await loadData();
    } catch (err: any) {
      setError(err?.detail || err?.message || t('customers.groups.saveFailed'));
    } finally {
      setAdding(false);
    }
  };

  const toolbar = (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, minWidth: 0 }}>
      {tabsBar}
      <TextField
        select
        size="small"
        label={t('customers.groups.filter')}
        value={groupFilter}
        onChange={(e) => setGroupFilter(e.target.value)}
        sx={{ minWidth: 180, flexShrink: 0 }}
      >
        <MenuItem value="">
          <em>{t('customers.groups.allGroups')}</em>
        </MenuItem>
        {groups.map((g) => (
          <MenuItem key={g.id} value={g.id}>
            {g.name}
          </MenuItem>
        ))}
      </TextField>
      {canAddToGroups && selectedIds.length > 0 && addable.length > 0 && (
        <Button variant="contained" color="secondary" size="small" sx={{ flexShrink: 0 }} onClick={() => setAddOpen(true)}>
          {t('customers.groups.addSelected', { count: selectedIds.length })}
        </Button>
      )}
    </Stack>
  );

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
      {notice && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {filter === 'OWES' && isHeadOffice && creditSummary && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {[
            { label: t('credit.totalOwed'), value: creditSummary.total_owed, color: 'error.main', hint: t('customers.creditSummary.owing', { count: creditSummary.owing_count }) },
            { label: t('credit.totalLimit'), value: creditSummary.total_limit, color: 'text.primary' },
            { label: t('credit.totalAvailable'), value: creditSummary.total_available, color: 'primary.main' },
          ].map((f) => (
            <Grid key={f.label} size={{ xs: 12, sm: 4 }}>
              <Card variant="outlined">
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
        toolbarStart={toolbar}
        checkboxSelection={canAddToGroups}
        disableRowSelectionOnClick
        rowSelectionModel={selection}
        onRowSelectionModelChange={setSelection}
        // Search goes to the server (500,000 customers), through the grid's own search box.
        filterModel={gridFilterModel}
        onFilterModelChange={(model) => setSearch((model.quickFilterValues ?? []).join(' '))}
        quickFilterPlaceholder={t('customers.directory.searchPlaceholder')}
        columns={[
          {
            field: 'name',
            headerName: t('customers.name'),
            flex: 1,
            minWidth: 180,
            valueGetter: (_value, row) => fullName(row as Customer),
            renderCell: (params) => (
              <Link component="button" onClick={() => openCustomer(params.row.id)} sx={{ fontWeight: 600 }}>
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
            field: 'groups',
            headerName: t('customers.groups.column'),
            renderHeader: () => (
              <>
                {t('customers.groups.column')} <VersionTag feature="customers.groups" sx={{ ml: 1 }} />
              </>
            ),
            width: 260,
            // Centres the chips and the dash in the row, as the text columns are.
            display: 'flex',
            sortable: false,
            renderCell: (params) => {
              const list = (params.row as Customer).groups || [];
              if (list.length === 0) return <Typography variant="body2" color="text.disabled">—</Typography>;
              return (
                <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap', py: 1 }}>
                  {list.map((g) => (
                    <Chip
                      key={g.id}
                      size="small"
                      color="secondary"
                      variant="outlined"
                      label={g.name}
                      title={g.branch_id ? branchName(g.branch_id) : undefined}
                      sx={{ fontWeight: 600, maxWidth: '100%' }}
                    />
                  ))}
                </Stack>
              );
            },
          },
          {
            field: 'wallet_balance',
            headerName: t('customers.directory.walletColumn'),
            renderHeader: () => (
              <>
                {t('customers.directory.walletColumn')} <VersionTag feature="customers.wallet" sx={{ ml: 1 }} />
              </>
            ),
            width: 160,
            display: 'flex',
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
                  display: 'flex' as const,
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
                          onClick={(e) => {
                            // The row would open the drawer on its first tab.
                            e.stopPropagation();
                            openCustomer(c.id, 'credit');
                          }}
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
        ]}
        onRowClick={(params) => openCustomer(String(params.id))}
        sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
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

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('customers.groups.addSelected', { count: selectedIds.length })}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField select label={t('customers.groups.addTo')} value={addGroupId} onChange={(e) => setAddGroupId(e.target.value)}>
              {addable.map((g) => (
                <MenuItem key={g.id} value={g.id}>
                  {g.name}
                </MenuItem>
              ))}
            </TextField>
            {canChangeScope && (
              <TextField
                select
                label={t('customers.groups.branch')}
                value={addBranchId}
                onChange={(e) => setAddBranchId(e.target.value)}
                helperText={t('customers.groups.branchHelp')}
              >
                <MenuItem value="">
                  <em>{t('customers.groups.noBranch')}</em>
                </MenuItem>
                {branches.map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" color="secondary" disabled={!addGroupId || adding} onClick={addSelected}>
            {t('customers.groups.add')}
          </Button>
        </DialogActions>
      </Dialog>

      <CustomerDrawer
        customerId={drawerCustomerId}
        tab={drawerTab}
        onTabChange={setDrawerTab}
        onClose={closeCustomer}
        onChanged={loadData}
      />
    </Box>
  );
}
