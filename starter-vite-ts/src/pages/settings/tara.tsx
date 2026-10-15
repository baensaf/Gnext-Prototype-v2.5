import type { TaraSetup, TaraDemoCustomer } from 'src/api/taraApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import SyncIcon from '@mui/icons-material/Sync';
import {
  Box,
  Card,
  Chip,
  Alert,
  Stack,
  Table,
  Button,
  Select,
  TableRow,
  MenuItem,
  TextField,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  CardHeader,
  CardContent,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyLabel } from 'src/utils/currency';

import { taraApi } from 'src/api/taraApi';
import { useIsHeadOffice } from 'src/store/useAuthStore';
import { useBranchContext } from 'src/contexts/branch-context';

import { toast } from 'src/components/snackbar';
import { VersionTag } from 'src/components/version-tag';
import { SettingScopeNotice } from 'src/components/setting-scope';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

const errorText = (err: any, fallback: string) => err?.detail || err?.message || fallback;

/**
 * Tara at the till (V3), set up once at head office in three steps: the chain's Tara login, the
 * code Tara gave each branch (its terminals come with it, one per till), and the Tara product
 * group each menu category is sent under on the invoice.
 */
export function TaraSettingsPage() {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();
  const isHeadOffice = useIsHeadOffice();
  const { selectedBranch } = useBranchContext();

  const [setup, setSetup] = useState<TaraSetup | null>(null);
  const [demo, setDemo] = useState<TaraDemoCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [defaultGroup, setDefaultGroup] = useState<number | ''>('');
  const [categoryGroups, setCategoryGroups] = useState<Record<string, number | ''>>({});

  /** The page's fields follow what the server holds after every change. */
  const show = useCallback((s: TaraSetup) => {
    setSetup(s);
    setUsername(s.connection?.username ?? '');
    setPassword('');
    setCodes(Object.fromEntries(s.branches.map((b) => [b.branch_id, b.branch_code ?? ''])));
    setDefaultGroup(s.connection?.default_group_id ?? '');
    setCategoryGroups(Object.fromEntries(s.categories.map((c) => [c.id, s.connection?.category_groups?.[c.id] ?? ''])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d] = await Promise.all([taraApi.getSetup(), taraApi.demoCustomers().catch(() => [])]);
      show(s);
      setDemo(d);
    } catch (err: any) {
      toast.error(errorText(err, t('settings.tara.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [show, t]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, call: () => Promise<TaraSetup>, done?: string) => {
    setBusy(key);
    try {
      show(await call());
      if (done) toast.success(done);
    } catch (err: any) {
      toast.error(errorText(err, t('settings.tara.saveFailed')));
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

  const connected = !!setup.connection?.connected;
  const groups = setup.connection?.groups ?? [];
  const locked = !isHeadOffice || !!busy;

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('settings.tara.title')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.tara.title') },
        ]}
      />

      <SettingScopeNotice kind="CHAIN" isHeadOffice={isHeadOffice} branchName={selectedBranch?.name} />

      <Stack spacing={3}>
        {/* 1. The chain's Tara account */}
        <Card>
          <CardHeader
            title={t('settings.tara.connection.title')}
            subheader={t('settings.tara.connection.subtitle')}
            action={
              <Chip
                size="small"
                color={connected ? 'success' : 'default'}
                label={connected ? t('settings.tara.connection.connected') : t('settings.tara.connection.notConnected')}
              />
            }
          />
          <CardContent>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
              <TextField
                size="small"
                label={t('settings.tara.connection.username')}
                value={username}
                disabled={locked}
                onChange={(e) => setUsername(e.target.value)}
                slotProps={{ htmlInput: { dir: 'ltr', autoComplete: 'off' } }}
              />
              <TextField
                size="small"
                type="password"
                label={t('settings.tara.connection.password')}
                value={password}
                disabled={locked}
                placeholder={connected ? '••••••' : ''}
                helperText={connected ? t('settings.tara.connection.passwordKept') : undefined}
                onChange={(e) => setPassword(e.target.value)}
                slotProps={{ htmlInput: { dir: 'ltr', autoComplete: 'new-password' } }}
              />
              <Button
                variant="contained"
                disabled={locked || !username.trim() || (!connected && !password)}
                onClick={() =>
                  run('connect', () => taraApi.connect({ username: username.trim(), password: password || undefined }), t('settings.tara.connection.done'))
                }
              >
                {connected ? t('settings.tara.connection.reconnect') : t('settings.tara.connection.connect')}
              </Button>
              {connected && (
                <Button color="error" disabled={locked} onClick={() => run('disconnect', taraApi.disconnect)}>
                  {t('settings.tara.connection.disconnect')}
                </Button>
              )}
            </Stack>
          </CardContent>
        </Card>

        {/* 2. Each branch's Tara code, and the terminals Tara gives it */}
        <Card>
          <CardHeader title={t('settings.tara.branches.title')} subheader={t('settings.tara.branches.subtitle')} />
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('settings.tara.branches.branch')}</TableCell>
                  <TableCell sx={{ width: 260 }}>{t('settings.tara.branches.code')}</TableCell>
                  <TableCell>{t('settings.tara.branches.terminals')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {setup.branches.map((b) => {
                  const typed = codes[b.branch_id] ?? '';
                  const changed = typed.trim() !== (b.branch_code ?? '');
                  return (
                    <TableRow key={b.branch_id} sx={{ verticalAlign: 'top' }}>
                      <TableCell sx={{ fontWeight: 600, pt: 2 }}>{b.name}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <TextField
                            size="small"
                            value={typed}
                            disabled={locked || !connected}
                            placeholder={t('settings.tara.branches.codePlaceholder')}
                            onChange={(e) => setCodes((prev) => ({ ...prev, [b.branch_id]: e.target.value }))}
                            slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric', maxLength: 40 } }}
                            sx={{ width: 140 }}
                          />
                          <Button
                            size="small"
                            disabled={locked || !connected || (!changed && !typed.trim())}
                            onClick={() => run(`branch-${b.branch_id}`, () => taraApi.setBranchCode(b.branch_id, typed.trim()))}
                          >
                            {changed || !b.branch_code ? t('common.save', 'Save') : t('settings.tara.branches.refetch')}
                          </Button>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {b.terminals.length === 0 ? (
                          <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
                            {b.branch_code ? t('settings.tara.branches.noTerminals') : t('settings.tara.branches.addCodeFirst')}
                          </Typography>
                        ) : (
                          <Stack spacing={1}>
                            {b.terminals.map((term) => (
                              <Stack key={term.id} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                                <Typography variant="body2" sx={{ minWidth: 150 }}>
                                  {term.terminal_title || term.terminal_code}{' '}
                                  <Box component="span" sx={{ color: 'text.secondary', direction: 'ltr', unicodeBidi: 'embed' }}>
                                    ({term.terminal_code})
                                  </Box>
                                </Typography>
                                <Select
                                  size="small"
                                  displayEmpty
                                  value={term.register_id ?? ''}
                                  disabled={locked}
                                  onChange={(e) =>
                                    run(`term-${term.id}`, () => taraApi.assignTerminal(term.id, (e.target.value as string) || null))
                                  }
                                  sx={{ minWidth: 180 }}
                                >
                                  <MenuItem value="">
                                    <em>{t('settings.tara.branches.noTill')}</em>
                                  </MenuItem>
                                  {b.registers.map((r) => (
                                    <MenuItem key={r.id} value={r.id}>
                                      {r.name}
                                    </MenuItem>
                                  ))}
                                </Select>
                              </Stack>
                            ))}
                          </Stack>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>

        {/* 3. Tara's product groups for the menu's categories */}
        <Card>
          <CardHeader
            title={t('settings.tara.groups.title')}
            subheader={t('settings.tara.groups.subtitle')}
            action={
              <Button
                size="small"
                startIcon={<SyncIcon />}
                disabled={locked || !connected}
                onClick={() => run('groups-refresh', taraApi.refreshGroups, t('settings.tara.groups.refreshed'))}
              >
                {t('settings.tara.groups.refresh')}
              </Button>
            }
          />
          <CardContent>
            {!connected ? (
              <Alert severity="info">{t('settings.tara.groups.connectFirst')}</Alert>
            ) : (
              <Stack spacing={2}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ minWidth: 200, fontWeight: 600 }}>
                    {t('settings.tara.groups.default')}
                  </Typography>
                  <Select
                    size="small"
                    value={defaultGroup}
                    disabled={locked}
                    onChange={(e) => setDefaultGroup(e.target.value ? Number(e.target.value) : '')}
                    sx={{ minWidth: 220 }}
                  >
                    {groups.map((g) => (
                      <MenuItem key={g.id} value={g.id}>
                        {g.title}
                      </MenuItem>
                    ))}
                  </Select>
                </Stack>
                {setup.categories.map((c) => (
                  <Stack key={c.id} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ minWidth: 200 }}>
                      {c.name}
                    </Typography>
                    <Select
                      size="small"
                      displayEmpty
                      value={categoryGroups[c.id] ?? ''}
                      disabled={locked}
                      onChange={(e) =>
                        setCategoryGroups((prev) => ({ ...prev, [c.id]: e.target.value ? Number(e.target.value) : '' }))
                      }
                      sx={{ minWidth: 220 }}
                    >
                      <MenuItem value="">
                        <em>{t('settings.tara.groups.useDefault')}</em>
                      </MenuItem>
                      {groups.map((g) => (
                        <MenuItem key={g.id} value={g.id}>
                          {g.title}
                        </MenuItem>
                      ))}
                    </Select>
                  </Stack>
                ))}
                <Box>
                  <Button
                    variant="contained"
                    disabled={locked || defaultGroup === ''}
                    onClick={() =>
                      run(
                        'groups',
                        () =>
                          taraApi.saveGroups({
                            defaultGroupId: defaultGroup === '' ? null : defaultGroup,
                            categoryGroups: Object.fromEntries(
                              Object.entries(categoryGroups).map(([id, g]) => [id, g === '' ? null : g])
                            ),
                          }),
                        t('settings.tara.groups.saved')
                      )
                    }
                  >
                    {t('common.save', 'Save')}
                  </Button>
                </Box>
              </Stack>
            )}
          </CardContent>
        </Card>

        {/* The simulated Tara knows these customers: a prototype aid, not part of the product. */}
        <Card>
          <CardHeader
            title={
              <>
                {t('settings.tara.demo.title')} <VersionTag feature="tara.simulated" />
              </>
            }
            subheader={t('settings.tara.demo.subtitle')}
          />
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('settings.tara.demo.barcode')}</TableCell>
                  <TableCell>{t('settings.tara.demo.outcome')}</TableCell>
                  <TableCell>{t('settings.tara.demo.limit')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {demo.map((d) => (
                  <TableRow key={d.barcode}>
                    <TableCell sx={{ fontFamily: 'monospace', direction: 'ltr' }}>{d.barcode}</TableCell>
                    <TableCell>{t(`settings.tara.demo.outcomes.${d.outcome}`)}</TableCell>
                    <TableCell>{MoneyUtil.isZero(d.limit) ? '—' : `${MoneyUtil.formatCurrency(d.limit)} ${currency}`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      </Stack>
    </Box>
  );
}
