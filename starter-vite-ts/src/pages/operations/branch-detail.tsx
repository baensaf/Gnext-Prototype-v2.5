import type { WeekHours } from 'src/utils/opening-hours';
import type { BranchDetails } from 'src/components/branch';
import type { Pin } from 'src/components/branch/branch-location-map';
import type { Branch, BranchOperatingHour } from 'src/api/tenantApi';

import { useTranslation } from 'react-i18next';
import { useParams, useLocation } from 'react-router';
import { lazy, useState, Suspense, useEffect, useCallback } from 'react';

import SaveIcon from '@mui/icons-material/Save';
import RestoreIcon from '@mui/icons-material/Restore';
import ArchiveIcon from '@mui/icons-material/Inventory2Outlined';
import {
  Box,
  Tab,
  Card,
  Chip,
  List,
  Tabs,
  Alert,
  Stack,
  Button,
  Dialog,
  ListItem,
  AlertTitle,
  Typography,
  CardContent,
  DialogTitle,
  ListItemText,
  DialogActions,
  DialogContent,
  CircularProgress,
} from '@mui/material';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components/router-link';

import { formatCalendarDate } from 'src/utils/calendar';
import { weekFromRows, rowsFromWeek, weekProblems } from 'src/utils/opening-hours';

import { tenantApi } from 'src/api/tenantApi';
import { useBranchContextOptional } from 'src/contexts/branch-context';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import { BranchOpenChip, BranchHoursEditor, BranchDetailsFields, useBranchOpenStatus } from 'src/components/branch';

// Leaflet is only loaded when a map is on screen.
const BranchLocationMap = lazy(() =>
  import('src/components/branch/branch-location-map').then((m) => ({ default: m.BranchLocationMap }))
);

type TabKey = 'overview' | 'hours' | 'location';

const detailsOf = (branch: Branch): BranchDetails => ({
  name: branch.name,
  address: branch.address || '',
  phone: branch.phone || '',
  time_zone: branch.time_zone || 'Asia/Tehran',
  branch_type: branch.branch_type || 'RESTAURANT',
});

const pinOf = (branch: Branch): Pin | null =>
  branch.latitude !== null && branch.latitude !== undefined && branch.longitude !== null && branch.longitude !== undefined
    ? { latitude: Number(branch.latitude), longitude: Number(branch.longitude) }
    : null;

/** What the server says stops the archive: one entry per shift, order, delivery or settlement. */
type ArchiveBlocker = {
  kind: 'SHIFT' | 'ORDER' | 'REFUND_DUE' | 'DELIVERY' | 'COURIER_PAY' | 'SETTLEMENT' | 'HELD_ORDER';
  label: string;
};

type ArchiveRefusal = { detail: string; items: ArchiveBlocker[] };

/**
 * One branch: its details, weekly hours and pin, each on a tab and saved on its own. Head
 * office archives a branch that has closed for good from here, and restores it.
 */
export function BranchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { t } = useTranslation();
  const branchScope = useBranchContextOptional();

  const [tab, setTab] = useState<TabKey>('overview');
  const [branch, setBranch] = useState<Branch | null>(null);
  const [rows, setRows] = useState<BranchOperatingHour[]>([]);
  const [details, setDetails] = useState<BranchDetails | null>(null);
  const [week, setWeek] = useState<WeekHours | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(
    (location.state as { created?: boolean } | null)?.created ? 'created' : null
  );
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [refusal, setRefusal] = useState<ArchiveRefusal | null>(null);

  const status = useBranchOpenStatus(branch?.id, branch?.time_zone, rows);

  const blockerKindLabel = (kind: ArchiveBlocker['kind']) =>
    ({
      SHIFT: t('branchMgmt.archive.kinds.shift', 'Cash shift not closed'),
      ORDER: t('branchMgmt.archive.kinds.order', 'Order unpaid or in progress'),
      REFUND_DUE: t('branchMgmt.archive.kinds.refundDue', 'Cancelled order, money not given back'),
      DELIVERY: t('branchMgmt.archive.kinds.delivery', 'Delivery not finished'),
      COURIER_PAY: t('branchMgmt.archive.kinds.courierPay', 'Delivered, courier not settled yet'),
      SETTLEMENT: t('branchMgmt.archive.kinds.settlement', 'Courier settlement open'),
      HELD_ORDER: t('branchMgmt.archive.kinds.heldOrder', 'Held order (discard it first)'),
    })[kind] || kind;

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [b, h] = await Promise.all([tenantApi.getBranchById(id), tenantApi.getBranchHours(id)]);
      setBranch(b);
      setRows(h);
      setDetails(detailsOf(b));
      setWeek(weekFromRows(h));
      setPin(pinOf(b));
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.branchDetail.loadError', 'Failed to load branch details'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!branch || !details || !week) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">{error || t('operations.branchDetail.notFound', 'Branch not found')}</Alert>
      </Box>
    );
  }

  const archived = !!branch.deleted_at || !branch.is_active;
  const original = detailsOf(branch);
  const detailsChanged = JSON.stringify(details) !== JSON.stringify(original);
  const hoursChanged = JSON.stringify(week) !== JSON.stringify(weekFromRows(rows));
  const savedPin = pinOf(branch);
  const pinChanged = !!pin && (pin.latitude !== savedPin?.latitude || pin.longitude !== savedPin?.longitude);

  const run = async (work: () => Promise<void>, done: string) => {
    setSaving(true);
    setError(null);
    try {
      await work();
      setSuccess(done);
      await branchScope?.refreshBranches();
    } catch (err: any) {
      if (err.code === 'BRANCH_TITLE_TAKEN') {
        setNameError(t('branchMgmt.details.titleTaken', 'Another branch of the chain already has this title.'));
      } else {
        setError(err.detail || err.message || t('operations.branches.updateError', 'Failed to update branch'));
      }
    } finally {
      setSaving(false);
    }
  };

  const saveDetails = () =>
    run(async () => {
      const updated = await tenantApi.updateBranch(branch.id, {
        name: details.name.trim(),
        address: details.address.trim(),
        phone: details.phone.trim(),
        time_zone: details.time_zone,
        branch_type: details.branch_type,
      });
      setBranch(updated);
      setDetails(detailsOf(updated));
    }, t('branchMgmt.saved.details', 'Details saved.'));

  const saveHours = () =>
    run(async () => {
      const saved = await tenantApi.updateBranchHours(branch.id, rowsFromWeek(week));
      setRows(saved);
      setWeek(weekFromRows(saved));
    }, t('branchMgmt.saved.hours', 'Opening hours saved. They apply now.'));

  const savePin = () =>
    run(async () => {
      if (!pin) return;
      const updated = await tenantApi.updateBranch(branch.id, { latitude: pin.latitude, longitude: pin.longitude });
      setBranch(updated);
      setPin(pinOf(updated));
    }, t('branchMgmt.saved.location', 'Location saved.'));

  const archive = async () => {
    setSaving(true);
    try {
      const result = await tenantApi.archiveBranch(branch.id);
      setArchiveOpen(false);
      await load();
      await branchScope?.refreshBranches();
      setSuccess(
        t('branchMgmt.archive.done', {
          defaultValue: 'Branch archived. Its history stays. {{staff}} staff now have no branch until you give them another.',
          staff: result.staffWithoutBranch,
        })
      );
    } catch (err: any) {
      setArchiveOpen(false);
      setRefusal({ detail: err.detail || err.message, items: err.context?.items || [] });
    } finally {
      setSaving(false);
    }
  };

  const restore = () =>
    run(async () => {
      const restored = await tenantApi.restoreBranch(branch.id);
      setBranch(restored);
    }, t('branchMgmt.restore.done', 'Branch restored. Enrol its branch agent again to print and take card payments.'));

  const successText =
    success === 'created'
      ? t('branchMgmt.new.created', 'Branch added. Next: enrol its branch agent, add its tills and printers, and give staff this branch.')
      : success;

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={branch.name}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('operations.branches.title', 'Branches'), href: paths.app.operations.branches },
          { name: branch.name },
        ]}
        action={
          archived ? (
            <Button variant="contained" startIcon={<RestoreIcon />} onClick={restore} disabled={saving}>
              {t('branchMgmt.restore.action', 'Restore branch')}
            </Button>
          ) : (
            <Button color="error" variant="outlined" startIcon={<ArchiveIcon />} onClick={() => setArchiveOpen(true)}>
              {t('branchMgmt.archive.action', 'Archive branch')}
            </Button>
          )
        }
      />

      <Stack direction="row" spacing={1} sx={{ mb: 2, mt: -2, flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
        <Chip
          size="small"
          color={archived ? 'default' : 'success'}
          variant={archived ? 'outlined' : 'filled'}
          label={archived ? t('operations.branches.archived', 'Archived') : t('operations.branches.active', 'Active')}
        />
        {!archived && <BranchOpenChip status={status} />}
        {!savedPin && (
          <Chip size="small" color="warning" variant="outlined" label={t('branchMgmt.location.missing', 'No pin on the map')} />
        )}
      </Stack>

      {archived && (
        <Alert severity="info" sx={{ mb: 3 }}>
          <AlertTitle>
            {branch.deleted_at
              ? t('branchMgmt.archived.titleOn', { defaultValue: 'Archived on {{date}}', date: formatCalendarDate(branch.deleted_at) })
              : t('operations.branches.archived', 'Archived')}
          </AlertTitle>
          {t(
            'branchMgmt.archived.body',
            'No till can sell here and its branch agent is no longer accepted. Its orders, payments, shifts and reports stay. Restore it to use it again; the agent then has to be enrolled again.'
          )}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {successText && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
          {successText}
          {success === 'created' && (
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
              <Button size="small" component={RouterLink} href={paths.app.operations.agents}>
                {t('branchMgmt.next.agent', 'Enrol branch agent')}
              </Button>
              <Button size="small" component={RouterLink} href={paths.app.operations.terminals}>
                {t('branchMgmt.next.tills', 'Add tills')}
              </Button>
              <Button size="small" component={RouterLink} href={paths.app.operations.printers}>
                {t('branchMgmt.next.printers', 'Add printers')}
              </Button>
              <Button size="small" component={RouterLink} href={paths.app.settings.users}>
                {t('branchMgmt.next.staff', 'Assign staff')}
              </Button>
            </Stack>
          )}
        </Alert>
      )}

      <Card sx={{ borderRadius: 3 }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="overview" label={t('branchMgmt.tabs.overview', 'Overview')} />
          <Tab value="hours" label={t('branchMgmt.tabs.hours', 'Opening hours')} />
          <Tab value="location" label={t('branchMgmt.tabs.location', 'Location')} />
        </Tabs>

        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
          {tab === 'overview' && (
            <Box sx={{ maxWidth: 720 }}>
              <BranchDetailsFields
                value={details}
                onChange={(d) => {
                  setDetails(d);
                  setNameError(null);
                }}
                showErrors
                nameError={nameError}
                disabled={archived || saving}
              />
              {!archived && (
                <SaveBar
                  changed={detailsChanged}
                  disabled={!details.name.trim()}
                  saving={saving}
                  onSave={saveDetails}
                  onReset={() => setDetails(original)}
                />
              )}
            </Box>
          )}

          {tab === 'hours' && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t(
                  'branchMgmt.hours.help',
                  'Outside these hours the till still sells: it shows a warning, and the order is marked after hours in the orders list and reports.'
                )}
              </Typography>
              <BranchHoursEditor value={week} onChange={setWeek} disabled={archived || saving} />
              {!archived && (
                <SaveBar
                  changed={hoursChanged}
                  disabled={Object.keys(weekProblems(week)).length > 0}
                  saving={saving}
                  onSave={saveHours}
                  onReset={() => setWeek(weekFromRows(rows))}
                />
              )}
            </>
          )}

          {tab === 'location' && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t(
                  'branchMgmt.location.help',
                  'Delivery zones are drawn around this pin, and couriers will use it. The pin can be moved but not removed.'
                )}
              </Typography>
              <Suspense
                fallback={
                  <Box sx={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CircularProgress size={28} />
                  </Box>
                }
              >
                <BranchLocationMap value={pin} onChange={archived ? undefined : setPin} />
              </Suspense>
              {!archived && (
                <SaveBar changed={pinChanged} saving={saving} onSave={savePin} onReset={() => setPin(savedPin)} />
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={archiveOpen} onClose={() => !saving && setArchiveOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('branchMgmt.archive.title', { defaultValue: 'Archive {{name}}?', name: branch.name })}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            {t('branchMgmt.archive.intro', 'For a branch that has closed for good. Once archived:')}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 3, '& li': { mb: 0.5 } }}>
            <Typography component="li" variant="body2">
              {t('branchMgmt.archive.point1', 'No till can sell there, and it leaves the branch picker.')}
            </Typography>
            <Typography component="li" variant="body2">
              {t('branchMgmt.archive.point2', 'Its branch agent is no longer accepted.')}
            </Typography>
            <Typography component="li" variant="body2">
              {t(
                'branchMgmt.archive.point3',
                'Staff whose only branch it is keep their accounts, with no branch until you give them another.'
              )}
            </Typography>
            <Typography component="li" variant="body2">
              {t('branchMgmt.archive.point4', 'Its orders, payments, shifts and reports stay. You can restore it later.')}
            </Typography>
          </Box>
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t('branchMgmt.archive.refusedWhen', 'Not possible while a shift is open there or an order is unpaid or unfinished.')}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setArchiveOpen(false)} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button color="error" variant="contained" onClick={archive} disabled={saving}>
            {t('branchMgmt.archive.confirm', 'Archive')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!refusal} onClose={() => setRefusal(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('branchMgmt.archive.refusedTitle', 'The branch cannot be archived yet')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {refusal?.detail}
          </Typography>
          {!!refusal?.items.length && (
            <List dense disablePadding>
              {refusal.items.map((item) => (
                <ListItem key={`${item.kind}-${item.label}`} disableGutters>
                  <ListItemText primary={item.label} secondary={blockerKindLabel(item.kind)} />
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRefusal(null)}>{t('common.close', 'Close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function SaveBar({
  changed,
  saving,
  disabled,
  onSave,
  onReset,
}: {
  changed: boolean;
  saving: boolean;
  disabled?: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack direction="row" spacing={1} sx={{ mt: 3, justifyContent: 'flex-end' }}>
      {changed && (
        <Button color="inherit" onClick={onReset} disabled={saving}>
          {t('branchMgmt.discard', 'Discard changes')}
        </Button>
      )}
      <Button
        variant="contained"
        startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
        onClick={onSave}
        disabled={!changed || saving || disabled}
      >
        {t('common.save', 'Save')}
      </Button>
    </Stack>
  );
}
