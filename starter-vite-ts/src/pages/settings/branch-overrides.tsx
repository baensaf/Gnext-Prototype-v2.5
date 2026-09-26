import type { Branch } from 'src/api/tenantApi';
import type { ScopedSettings, ScopedSettingGroup } from 'src/api/settingsApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Box,
  Card,
  Chip,
  Stack,
  Table,
  Alert,
  Switch,
  Button,
  Dialog,
  Tooltip,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  DialogTitle,
  DialogActions,
  DialogContent,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { tenantApi } from 'src/api/tenantApi';
import { settingsApi } from 'src/api/settingsApi';
import { useScopedBranchId } from 'src/contexts/branch-context';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

// ----------------------------------------------------------------------

/** A jsonb setting value can be an object of fields or a bare scalar; both are edited here. */
function isFieldMap(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `cashierEditWindowMinutes` and `edit_window_minutes` both read as `Cashier Edit Window Minutes`. */
function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function summarize(value: unknown): string {
  if (!isFieldMap(value)) return String(value);
  const parts = Object.entries(value).map(([k, v]) => `${humanize(k)}: ${String(v)}`);
  return parts.join(' · ');
}

type Row = {
  key: string;
  group?: ScopedSettingGroup;
};

// ----------------------------------------------------------------------

/**
 * One page for the whole override layer at a single site.
 *
 * The chain's rules are decided at head office and inherited; a short list of groups may
 * be diverged from locally. Until this screen existed that layer was only reachable one
 * group at a time, on the one screen that had been built for it, so four of the five
 * overridable groups had no way in at all and nothing anywhere answered the actual
 * question — what does this branch do differently, and what is it not allowed to touch.
 */
export function BranchOverridesPage() {
  const { t } = useTranslation();

  // The branch comes from the header's switcher; at head office there is none to show.
  const [branchId] = useScopedBranchId();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [scoped, setScoped] = useState<ScopedSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [scalarDraft, setScalarDraft] = useState<string>('');
  const [draftIsScalar, setDraftIsScalar] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [scopedRows, branchRows] = await Promise.all([
        settingsApi.getScopedSettings(branchId || undefined),
        tenantApi.getBranches(),
      ]);
      setScoped(scopedRows);
      setBranches(branchRows);
    } catch (err: any) {
      setError(
        err?.response?.data?.detail ||
          err?.response?.data?.message ||
          err.message ||
          t('settings.branchOverrides.loadError', 'Failed to load this branch’s settings')
      );
    } finally {
      setLoading(false);
    }
  }, [branchId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = scoped?.groups || {};
  // The server sends what a branch is allowed to diverge on, including groups nobody has
  // written yet — those have no row to resolve and would otherwise be invisible here.
  const overridableKeys: string[] = scoped?.overridable_groups || [];
  const overridableRows: Row[] = overridableKeys.map((key) => ({ key, group: groups[key] }));
  const chainRows: Row[] = Object.entries(groups)
    .filter(([key, group]) => !group.overridable && !overridableKeys.includes(key))
    .map(([key, group]) => ({ key, group }));

  const groupLabel = (key: string) => t(`settings.groupNames.${key}`, humanize(key));

  const handleOpenEdit = (row: Row) => {
    const value = row.group?.value;
    if (isFieldMap(value)) {
      setDraft({ ...value });
      setDraftIsScalar(false);
    } else {
      setScalarDraft(value === undefined ? '' : String(value));
      setDraftIsScalar(true);
    }
    setEditingKey(row.key);
  };

  const handleSave = async () => {
    if (!editingKey || !branchId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      // Always written with a branch id, so this creates or updates that location's own
      // row and leaves the organization value — and every other site — untouched.
      await settingsApi.updateSetting(editingKey, draftIsScalar ? scalarDraft : draft, branchId);
      setSuccess(
        t('settings.branchOverrides.saved', '{{group}} now overrides head office at this branch.', {
          group: groupLabel(editingKey),
        })
      );
      setEditingKey(null);
      await load();
    } catch (err: any) {
      setError(
        err?.response?.data?.detail ||
          err?.response?.data?.message ||
          err.message ||
          t('settings.branchOverrides.saveError', 'Failed to save the override')
      );
    } finally {
      setBusy(false);
    }
  };

  const handleFollowHeadOffice = async (key: string) => {
    if (!branchId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await settingsApi.clearBranchOverride(key, branchId);
      setSuccess(
        t('settings.branchOverrides.cleared', '{{group}} follows head office again.', {
          group: groupLabel(key),
        })
      );
      await load();
    } catch (err: any) {
      setError(
        err?.response?.data?.detail ||
          err?.response?.data?.message ||
          err.message ||
          t('settings.branchOverrides.clearError', 'Failed to remove the override')
      );
    } finally {
      setBusy(false);
    }
  };

  const renderSourceChip = (row: Row) => {
    if (!row.group) {
      return (
        <Chip
          size="small"
          variant="outlined"
          label={t('settings.branchOverrides.notSet', 'Not set anywhere')}
        />
      );
    }
    return row.group.source === 'BRANCH' ? (
      <Chip
        size="small"
        color="warning"
        label={t('settings.branchOverrides.overridden', 'Overridden here')}
      />
    ) : (
      <Chip
        size="small"
        color="default"
        label={t('settings.branchOverrides.inherited', 'Inherited from head office')}
      />
    );
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const selectedBranchName = branches.find((b) => b.id === branchId)?.name || '';

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('settings.branchOverrides.title', 'Branch Overrides')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.branchOverrides.title', 'Branch Overrides') },
        ]}
        action={
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={busy}>
              {t('common.refresh', 'Refresh')}
            </Button>
          </Stack>
        }
      />

      {!branchId ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          {t(
            'settings.branchOverrides.pickBranch',
            'Pick a branch in the header to see what it does differently from head office.'
          )}
        </Alert>
      ) : (
        <Alert severity="info" sx={{ mb: 3 }}>
          {t(
            'settings.branchOverrides.intro',
            'Every value here comes from head office unless {{branch}} has its own. Saving a group creates an override for this branch alone; the rest of the chain keeps following head office.',
            { branch: selectedBranchName }
          )}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <Card sx={{ mb: 3, borderRadius: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, p: 2.5, pb: 1.5 }}>
          {t('settings.branchOverrides.canDiverge', 'What this branch may decide for itself')}
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('settings.branchOverrides.group', 'Setting group')}</TableCell>
                <TableCell>{t('settings.branchOverrides.source', 'Comes from')}</TableCell>
                <TableCell>{t('settings.branchOverrides.value', 'Value in force here')}</TableCell>
                <TableCell align="right">{t('common.actions', 'Actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {overridableRows.map((row) => (
                <TableRow key={row.key} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{groupLabel(row.key)}</TableCell>
                  <TableCell>{renderSourceChip(row)}</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>
                    {row.group
                      ? summarize(row.group.value)
                      : t(
                          'settings.branchOverrides.notSetHelp',
                          'Head office has not set this yet, so there is nothing to inherit.'
                        )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                      {row.group?.source === 'BRANCH' && (
                        <Button
                          size="small"
                          color="inherit"
                          disabled={busy || !branchId}
                          onClick={() => handleFollowHeadOffice(row.key)}
                        >
                          {t('settings.scope.resetToOrg', 'Follow head office')}
                        </Button>
                      )}
                      <Tooltip
                        title={
                          branchId
                            ? ''
                            : t(
                                'settings.branchOverrides.pickBranchFirst',
                                'Choose a branch first'
                              )
                        }
                      >
                        <span>
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={busy || !branchId || !row.group}
                            onClick={() => handleOpenEdit(row)}
                          >
                            {t('settings.branchOverrides.edit', 'Set for this branch')}
                          </Button>
                        </span>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {chainRows.length > 0 && (
        <Card sx={{ borderRadius: 2 }}>
          <Box sx={{ p: 2.5, pb: 1.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {t('settings.branchOverrides.chainWide', 'What head office decides for everyone')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t(
                'settings.branchOverrides.chainWideHelp',
                'These groups have no per-branch version. Changing one changes the whole chain, from head office.'
              )}
            </Typography>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('settings.branchOverrides.group', 'Setting group')}</TableCell>
                  <TableCell>{t('settings.branchOverrides.value', 'Value in force here')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {chainRows.map((row) => (
                  <TableRow key={row.key} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{groupLabel(row.key)}</TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>
                      {summarize(row.group?.value)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      <Dialog open={Boolean(editingKey)} onClose={() => !busy && setEditingKey(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {t('settings.branchOverrides.editTitle', '{{group}} at {{branch}}', {
            group: editingKey ? groupLabel(editingKey) : '',
            branch: selectedBranchName,
          })}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t(
                'settings.branchOverrides.editHelp',
                'Saving writes these values for this branch only. Head office keeps its own.'
              )}
            </Typography>

            {draftIsScalar ? (
              <TextField
                fullWidth
                label={t('settings.branchOverrides.singleValue', 'Value')}
                value={scalarDraft}
                onChange={(e) => setScalarDraft(e.target.value)}
              />
            ) : (
              Object.entries(draft).map(([field, value]) =>
                typeof value === 'boolean' ? (
                  <Stack
                    key={field}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Typography variant="body2">{humanize(field)}</Typography>
                    <Switch
                      checked={value}
                      onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.checked }))}
                    />
                  </Stack>
                ) : (
                  <TextField
                    key={field}
                    fullWidth
                    label={humanize(field)}
                    type={typeof value === 'number' ? 'number' : 'text'}
                    value={value ?? ''}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [field]:
                          typeof value === 'number' ? Number(e.target.value) : e.target.value,
                      }))
                    }
                  />
                )
              )
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={busy} onClick={() => setEditingKey(null)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="contained" startIcon={<SaveIcon />} disabled={busy} onClick={handleSave}>
            {busy ? t('common.saving', 'Saving...') : t('common.saveChanges', 'Save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
