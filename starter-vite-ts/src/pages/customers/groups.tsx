import type { CustomerGroup, GroupDiscount } from 'src/api/discountsApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import {
  Box,
  Card,
  Chip,
  Link,
  Alert,
  Stack,
  Table,
  Button,
  Switch,
  Tooltip,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  IconButton,
  Typography,
  Autocomplete,
  InputAdornment,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { RouterLink } from 'src/routes/components';

import { toToman, fromToman, useCurrencyLabel } from 'src/utils/currency';

import { discountsApi } from 'src/api/discountsApi';
import { DashboardContent } from 'src/layouts/dashboard';
import { useIsHeadOffice } from 'src/store/useAuthStore';

import { Iconify } from 'src/components/iconify';
import { VersionTag } from 'src/components/version-tag';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

/** A group on the page, keyed so a discount can pick a group that is not saved yet. */
type GroupRow = CustomerGroup & { key: string };
type DiscountRow = GroupDiscount & { key: string };

const digits = (v: string) => v.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[^0-9.]/g, '');
const withCommas = (v: string) => v.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
let nextKey = 0;
const newKey = () => `new-${(nextKey += 1)}`;

/**
 * Customer groups and the discounts given to them, both head office's. A group is a list of
 * customers (staff, owners, regulars); people are added from the customer list. A group
 * discount is a percent for the groups it picks, with optional monthly limits. Saved together.
 */
export function CustomerGroupsPage() {
  const { t } = useTranslation();
  const currencyLabel = useCurrencyLabel();
  const isHeadOffice = useIsHeadOffice();

  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [discounts, setDiscounts] = useState<DiscountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, d] = await Promise.all([discountsApi.getCustomerGroups(), discountsApi.getGroupDiscounts()]);
      setGroups(g.map((row) => ({ ...row, key: row.id! })));
      setDiscounts(d.map((row) => ({ ...row, key: row.id! })));
      setError(null);
    } catch (err: any) {
      setError(err?.detail || err?.message || t('customerGroups.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      // Groups first, so a discount can pick a group added on this visit.
      const savedGroups = await discountsApi.saveCustomerGroups(
        groups.map(({ key: _key, ...g }) => g)
      );
      const idOf = new Map(groups.map((g, i) => [g.key, savedGroups[i]?.id]));
      await discountsApi.saveGroupDiscounts(
        discounts.map(({ key: _key, ...d }) => ({
          ...d,
          group_ids: d.group_ids.map((k) => idOf.get(k)).filter((id): id is string => !!id),
        }))
      );
      await load();
      setSaved(true);
    } catch (err: any) {
      setError(err?.detail || err?.message || t('customerGroups.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const setGroup = (i: number, patch: Partial<GroupRow>) =>
    setGroups((rows) => rows.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  const setDiscount = (i: number, patch: Partial<DiscountRow>) =>
    setDiscounts((rows) => rows.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const removeGroup = (key: string) => {
    setGroups((rows) => rows.filter((g) => g.key !== key));
    setDiscounts((rows) => rows.map((d) => ({ ...d, group_ids: d.group_ids.filter((k) => k !== key) })));
  };

  const money = (i: number, field: 'monthly_cap' | 'per_visit_cap') => (
    <TextField
      size="small"
      value={discounts[i][field] ? withCommas(toToman(discounts[i][field])) : ''}
      placeholder={t('customerGroups.noLimit')}
      onChange={(e) => {
        const typed = digits(e.target.value);
        setDiscount(i, { [field]: typed ? fromToman(typed) : null });
      }}
      disabled={!isHeadOffice}
      slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
      sx={{ width: 140 }}
    />
  );

  return (
    <DashboardContent>
      <CustomBreadcrumbs
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.customersGroup', 'Customers'), href: '/app/customers' },
          { name: t('customerGroups.title') },
        ]}
        sx={{ mb: 2 }}
      />
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3, gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
            {t('customerGroups.title')}
            <VersionTag feature="customers.groups" />
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('customerGroups.subtitle')}
          </Typography>
        </Box>
        {isHeadOffice && (
          <Button variant="contained" onClick={save} disabled={saving || loading}>
            {saving ? <CircularProgress size={22} /> : t('common.save')}
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {saved && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSaved(false)}>
          {t('customerGroups.saved')}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Stack spacing={3}>
          {/* Groups: lists of customers. */}
          <Card sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 0.5 }}>
              {t('customerGroups.groupsTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('customerGroups.groupsHelp')}
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('customerGroups.name')}</TableCell>
                    <TableCell>{t('customerGroups.branchCanAssign')}</TableCell>
                    <TableCell align="center">{t('customerGroups.members')}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {groups.map((g, i) => (
                    <TableRow key={g.key}>
                      <TableCell sx={{ minWidth: 280 }}>
                        <TextField
                          size="small"
                          fullWidth
                          value={g.name}
                          onChange={(e) => setGroup(i, { name: e.target.value })}
                          disabled={!isHeadOffice}
                        />
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={g.branch_can_assign}
                          onChange={(e) => setGroup(i, { branch_can_assign: e.target.checked })}
                          disabled={!isHeadOffice}
                          slotProps={{ input: { 'aria-label': t('customerGroups.branchCanAssign') } }}
                        />
                      </TableCell>
                      <TableCell align="center">
                        {g.id && g.members ? (
                          <Link component={RouterLink} href={`/app/customers?group=${g.id}`}>
                            {g.members}
                          </Link>
                        ) : (
                          g.members || 0
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {isHeadOffice && (
                          <Tooltip title={g.members ? t('customerGroups.removeWithMembers', { count: g.members }) : t('customerGroups.removeGroup')}>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => removeGroup(g.key)}
                              aria-label={t('customerGroups.removeGroup')}
                            >
                              <Iconify icon="solar:trash-bin-trash-bold" width={18} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {isHeadOffice && (
              <Button
                size="small"
                sx={{ mt: 2 }}
                startIcon={<Iconify icon="mingcute:add-line" />}
                onClick={() => setGroups((rows) => [...rows, { key: newKey(), name: '', branch_can_assign: false, members: 0 }])}
              >
                {t('customerGroups.addGroup')}
              </Button>
            )}
          </Card>

          {/* Group discounts: a percent for the groups each one picks. */}
          <Card sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 0.5 }}>
              {t('customerGroups.discountsTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('customerGroups.discountsHelp')}
            </Typography>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 1180 }}>
                <TableHead>
                  <TableRow>
                    <TableCell colSpan={4} />
                    <TableCell colSpan={3} align="center" sx={{ borderBottom: 0, pb: 0 }}>
                      <Tooltip title={t('customerGroups.limitsHelp')}>
                        <Chip size="small" variant="outlined" label={t('customerGroups.limitsTitle')} />
                      </Tooltip>
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow>
                    <TableCell>{t('customerGroups.name')}</TableCell>
                    <TableCell>{t('customerGroups.percent')}</TableCell>
                    <TableCell>{t('customerGroups.forGroups')}</TableCell>
                    <TableCell>{t('customerGroups.where')}</TableCell>
                    <TableCell>{`${t('customerGroups.monthlyCap')} (${currencyLabel})`}</TableCell>
                    <TableCell>{t('customerGroups.usesPerMonth')}</TableCell>
                    <TableCell>{`${t('customerGroups.perVisitCap')} (${currencyLabel})`}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {discounts.map((d, i) => (
                    <TableRow key={d.key}>
                      <TableCell sx={{ minWidth: 220 }}>
                        <TextField
                          size="small"
                          fullWidth
                          value={d.name}
                          onChange={(e) => setDiscount(i, { name: e.target.value })}
                          disabled={!isHeadOffice}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          value={d.percent ? String(Number(d.percent) || d.percent) : ''}
                          onChange={(e) => setDiscount(i, { percent: digits(e.target.value) })}
                          disabled={!isHeadOffice}
                          slotProps={{
                            htmlInput: { dir: 'ltr', inputMode: 'decimal' },
                            input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                          }}
                          sx={{ width: 96 }}
                        />
                      </TableCell>
                      <TableCell sx={{ minWidth: 260 }}>
                        <Autocomplete
                          multiple
                          size="small"
                          options={groups}
                          getOptionLabel={(g) => g.name || '—'}
                          isOptionEqualToValue={(a, b) => a.key === b.key}
                          value={groups.filter((g) => d.group_ids.includes(g.key))}
                          onChange={(_e, picked) => setDiscount(i, { group_ids: picked.map((g) => g.key) })}
                          disabled={!isHeadOffice}
                          renderInput={(params) => <TextField {...params} placeholder={d.group_ids.length ? '' : t('customerGroups.pickGroups')} />}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={d.own_branch_only ? 'OWN' : 'ANY'}
                          onChange={(e) => setDiscount(i, { own_branch_only: e.target.value === 'OWN' })}
                          disabled={!isHeadOffice}
                          sx={{ width: 140 }}
                        >
                          <MenuItem value="ANY">{t('customerGroups.anyBranch')}</MenuItem>
                          <MenuItem value="OWN">{t('customerGroups.ownBranch')}</MenuItem>
                        </TextField>
                      </TableCell>
                      <TableCell>{money(i, 'monthly_cap')}</TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          value={d.uses_per_month ?? ''}
                          placeholder={t('customerGroups.noLimit')}
                          onChange={(e) => {
                            const typed = digits(e.target.value).replace('.', '');
                            setDiscount(i, { uses_per_month: typed ? Number(typed) : null });
                          }}
                          disabled={!isHeadOffice}
                          slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
                          sx={{ width: 96 }}
                        />
                      </TableCell>
                      <TableCell>{money(i, 'per_visit_cap')}</TableCell>
                      <TableCell align="right">
                        {isHeadOffice && (
                          <Tooltip title={t('customerGroups.removeDiscount')}>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => setDiscounts((rows) => rows.filter((_, k) => k !== i))}
                              aria-label={t('customerGroups.removeDiscount')}
                            >
                              <Iconify icon="solar:trash-bin-trash-bold" width={18} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {isHeadOffice && (
              <Button
                size="small"
                sx={{ mt: 2 }}
                startIcon={<Iconify icon="mingcute:add-line" />}
                onClick={() =>
                  setDiscounts((rows) => [
                    ...rows,
                    { key: newKey(), name: '', percent: '', group_ids: [], own_branch_only: false, monthly_cap: null, uses_per_month: null, per_visit_cap: null },
                  ])
                }
              >
                {t('customerGroups.addDiscount')}
              </Button>
            )}
          </Card>
        </Stack>
      )}
    </DashboardContent>
  );
}
