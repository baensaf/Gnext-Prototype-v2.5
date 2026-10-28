import type { SnappfoodMode, SnappfoodSetup } from 'src/api/snappfoodApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  Box,
  Card,
  Chip,
  Alert,
  Stack,
  Button,
  Select,
  MenuItem,
  TextField,
  Typography,
  CardHeader,
  IconButton,
  CardContent,
  CircularProgress,
} from '@mui/material';

import { fDateTime } from 'src/utils/format-time';

import { snappfoodApi } from 'src/api/snappfoodApi';
import { useIsHeadOffice } from 'src/store/useAuthStore';
import { useBranchContext } from 'src/contexts/branch-context';

import { toast } from 'src/components/snackbar';
import { SettingScopeNotice } from 'src/components/setting-scope';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

const errorText = (err: any, fallback: string) => err?.detail || err?.message || fallback;

type Draft = {
  mode: SnappfoodMode;
  vendorCode: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
};

const MODES: SnappfoodMode[] = ['SIMULATED', 'STAGING', 'PRODUCTION'];

/**
 * Snappfood for real (V2), set up at head office: the one webhook address the chain gives
 * Snappfood, and for each branch which Snappfood it talks to (the simulator, staging or
 * production), its vendor code and the API account Snappfood made for it.
 */
export function SnappfoodSettingsPage() {
  const { t } = useTranslation();
  const isHeadOffice = useIsHeadOffice();
  const { selectedBranch } = useBranchContext();

  const [setup, setSetup] = useState<SnappfoodSetup | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [hmac, setHmac] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const show = useCallback((s: SnappfoodSetup) => {
    setSetup(s);
    setHmac('');
    setDrafts(
      Object.fromEntries(
        s.branches.map((b) => [
          b.branch_id,
          {
            mode: b.mode,
            vendorCode: b.vendor_code ?? '',
            clientId: b.client_id ?? '',
            clientSecret: '',
            username: b.username ?? '',
            password: '',
          },
        ])
      )
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      show(await snappfoodApi.getSetup());
    } catch (err: any) {
      toast.error(errorText(err, t('settings.snappfood.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [show, t]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, call: () => Promise<SnappfoodSetup>, done?: string) => {
    setBusy(key);
    try {
      show(await call());
      if (done) toast.success(done);
    } catch (err: any) {
      toast.error(errorText(err, t('settings.snappfood.saveFailed')));
    } finally {
      setBusy(null);
    }
  };

  const test = async (branchId: string) => {
    setBusy(`test-${branchId}`);
    try {
      const res = await snappfoodApi.testBranch(branchId);
      if (res.ok) {
        toast.success(t('settings.snappfood.branches.testOk', { title: res.vendor_title ?? '', status: res.status ?? '' }));
      } else {
        toast.error(t('settings.snappfood.branches.testFailed', { message: res.message }));
      }
    } catch (err: any) {
      toast.error(errorText(err, t('settings.snappfood.saveFailed')));
    } finally {
      setBusy(null);
    }
  };

  if (loading || !setup) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const locked = !isHeadOffice || !!busy;
  const webhookUrl = `${window.location.origin}${setup.webhook.path}`;
  const setDraft = (branchId: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [branchId]: { ...prev[branchId], ...patch } }));

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('settings.snappfood.title')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.snappfood.title') },
        ]}
      />

      <SettingScopeNotice kind="CHAIN" isHeadOffice={isHeadOffice} branchName={selectedBranch?.name} />

      <Stack spacing={3}>
        {/* 1. The address Snappfood sends orders to */}
        <Card>
          <CardHeader title={t('settings.snappfood.webhook.title')} subheader={t('settings.snappfood.webhook.subtitle')} />
          <CardContent>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  fullWidth
                  size="small"
                  label={t('settings.snappfood.webhook.url')}
                  value={webhookUrl}
                  slotProps={{ htmlInput: { dir: 'ltr', readOnly: true } }}
                />
                <IconButton
                  aria-label={t('settings.snappfood.webhook.copy')}
                  onClick={() => {
                    navigator.clipboard?.writeText(webhookUrl);
                    toast.success(t('settings.snappfood.webhook.copied'));
                  }}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {setup.webhook.last_received_at
                  ? t('settings.snappfood.webhook.lastReceived', { at: fDateTime(setup.webhook.last_received_at) })
                  : t('settings.snappfood.webhook.neverReceived')}
              </Typography>
              <Box>
                <Button
                  color="warning"
                  disabled={locked}
                  onClick={() =>
                    window.confirm(t('settings.snappfood.webhook.rotateConfirm')) &&
                    run('rotate', snappfoodApi.rotateWebhook, t('settings.snappfood.webhook.rotated'))
                  }
                >
                  {t('settings.snappfood.webhook.rotate')}
                </Button>
              </Box>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
                <TextField
                  size="small"
                  type="password"
                  label={t('settings.snappfood.webhook.hmac')}
                  value={hmac}
                  disabled={locked}
                  placeholder={setup.webhook.hmac_set ? '••••••' : ''}
                  helperText={
                    setup.webhook.hmac_set ? t('settings.snappfood.webhook.hmacOn') : t('settings.snappfood.webhook.hmacOff')
                  }
                  onChange={(e) => setHmac(e.target.value)}
                  slotProps={{ htmlInput: { dir: 'ltr', autoComplete: 'new-password' } }}
                  sx={{ minWidth: 280 }}
                />
                <Button
                  variant="contained"
                  disabled={locked || !hmac.trim()}
                  onClick={() => run('hmac', () => snappfoodApi.setHmac(hmac.trim()), t('settings.snappfood.webhook.hmacSaved'))}
                >
                  {t('common.save', 'Save')}
                </Button>
                {setup.webhook.hmac_set && (
                  <Button color="error" disabled={locked} onClick={() => run('hmac-clear', () => snappfoodApi.setHmac(null))}>
                    {t('settings.snappfood.webhook.hmacClear')}
                  </Button>
                )}
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {/* 2. Each branch as a Snappfood vendor */}
        <Card>
          <CardHeader title={t('settings.snappfood.branches.title')} subheader={t('settings.snappfood.branches.subtitle')} />
          <CardContent>
            <Stack spacing={3}>
              {setup.branches.map((b) => {
                const d = drafts[b.branch_id];
                if (!d) return null;
                const real = d.mode !== 'SIMULATED';
                const complete =
                  !!d.vendorCode.trim() &&
                  (!real ||
                    (!!d.clientId.trim() &&
                      !!d.username.trim() &&
                      (b.has_client_secret || !!d.clientSecret) &&
                      (b.has_password || !!d.password)));
                return (
                  <Box key={b.branch_id} sx={{ p: 2, borderRadius: 1, border: (theme) => `1px solid ${theme.palette.divider}` }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
                      <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
                        {b.name}
                      </Typography>
                      <Chip
                        size="small"
                        color={b.live ? (b.mode === 'PRODUCTION' ? 'success' : 'info') : 'default'}
                        label={t(`settings.snappfood.modes.${b.mode}`)}
                      />
                    </Stack>
                    <Stack spacing={2}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <Select
                          size="small"
                          value={d.mode}
                          disabled={locked}
                          onChange={(e) => setDraft(b.branch_id, { mode: e.target.value as SnappfoodMode })}
                          sx={{ minWidth: 200 }}
                        >
                          {MODES.map((m) => (
                            <MenuItem key={m} value={m}>
                              {t(`settings.snappfood.modes.${m}`)}
                            </MenuItem>
                          ))}
                        </Select>
                        <TextField
                          size="small"
                          label={t('settings.snappfood.branches.vendorCode')}
                          value={d.vendorCode}
                          disabled={locked}
                          onChange={(e) => setDraft(b.branch_id, { vendorCode: e.target.value })}
                          slotProps={{ htmlInput: { dir: 'ltr', maxLength: 40 } }}
                        />
                      </Stack>
                      {real && (
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                          <TextField
                            size="small"
                            label={t('settings.snappfood.branches.clientId')}
                            value={d.clientId}
                            disabled={locked}
                            onChange={(e) => setDraft(b.branch_id, { clientId: e.target.value })}
                            slotProps={{ htmlInput: { dir: 'ltr', autoComplete: 'off' } }}
                          />
                          <TextField
                            size="small"
                            type="password"
                            label={t('settings.snappfood.branches.clientSecret')}
                            value={d.clientSecret}
                            disabled={locked}
                            placeholder={b.has_client_secret ? '••••••' : ''}
                            onChange={(e) => setDraft(b.branch_id, { clientSecret: e.target.value })}
                            slotProps={{ htmlInput: { dir: 'ltr', autoComplete: 'new-password' } }}
                          />
                          <TextField
                            size="small"
                            label={t('settings.snappfood.branches.username')}
                            value={d.username}
                            disabled={locked}
                            onChange={(e) => setDraft(b.branch_id, { username: e.target.value })}
                            slotProps={{ htmlInput: { dir: 'ltr', autoComplete: 'off' } }}
                          />
                          <TextField
                            size="small"
                            type="password"
                            label={t('settings.snappfood.branches.password')}
                            value={d.password}
                            disabled={locked}
                            placeholder={b.has_password ? '••••••' : ''}
                            onChange={(e) => setDraft(b.branch_id, { password: e.target.value })}
                            slotProps={{ htmlInput: { dir: 'ltr', autoComplete: 'new-password' } }}
                          />
                        </Stack>
                      )}
                      {real && (b.has_client_secret || b.has_password) && (
                        <Typography variant="caption" color="text.secondary">
                          {t('settings.snappfood.branches.secretsKept')}
                        </Typography>
                      )}
                      <Stack direction="row" spacing={1}>
                        <Button
                          variant="contained"
                          disabled={locked || !complete}
                          onClick={() =>
                            run(
                              `save-${b.branch_id}`,
                              () =>
                                snappfoodApi.saveBranch(b.branch_id, {
                                  mode: d.mode,
                                  vendorCode: d.vendorCode.trim() || null,
                                  clientId: d.clientId.trim() || null,
                                  clientSecret: d.clientSecret || undefined,
                                  username: d.username.trim() || null,
                                  password: d.password || undefined,
                                }),
                              t('settings.snappfood.branches.saved', { name: b.name })
                            )
                          }
                        >
                          {t('common.save', 'Save')}
                        </Button>
                        <Button disabled={locked || !b.live} onClick={() => test(b.branch_id)}>
                          {t('settings.snappfood.branches.test')}
                        </Button>
                      </Stack>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          </CardContent>
        </Card>

        <Alert severity="info">{t('settings.snappfood.menuNote')}</Alert>
      </Stack>
    </Box>
  );
}
