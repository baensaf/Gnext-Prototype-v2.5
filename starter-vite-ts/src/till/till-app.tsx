import type { TillUser, TillState } from './agent-client';
import type { BranchContextValue } from 'src/contexts/branch-context';

import { useTranslation } from 'react-i18next';
import { useMemo, useState, useEffect, useCallback } from 'react';

import LogoutIcon from '@mui/icons-material/Logout';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { Box, Chip, Alert, Badge, Stack, Button, Tooltip, Container, Typography, IconButton, CircularProgress } from '@mui/material';

import { PosOrderPage } from 'src/pages/pos/order';
import { useAuthStore } from 'src/store/useAuthStore';
import { BranchContext } from 'src/contexts/branch-context';
import { PosSourceProvider } from 'src/contexts/pos-source';
import { SettingsButton } from 'src/layouts/components/settings-button';

import { toast } from 'src/components/snackbar';
import { useSettingsContext } from 'src/components/settings';

import { TillSignIn } from './sign-in';
import { TillContext } from './till-context';
import { agentPosSource } from './agent-source';
import { useOpenOrders, OpenOrdersDrawer } from './open-orders';
import { tillApi, setTillToken, onTillSignedOut } from './agent-client';

// ----------------------------------------------------------------------

/**
 * The offline till: the web POS's register, selling through the branch agent while the internet
 * is down (HANDOFF-offline-pos.md, decisions 6–9). The agent says who may sign in, which till
 * and shift it sells on, and whether the link is back.
 */
export function TillApp() {
  const [state, setState] = useState<TillState | null>(null);
  const [user, setUser] = useState<TillUser | null>(null);
  const [unreachable, setUnreachable] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await tillApi.state();
      setState(res.state);
      setUser(res.user);
      setUnreachable(null);
    } catch (err: any) {
      setUnreachable(err.detail || err.message);
    }
  }, []);

  useEffect(() => {
    onTillSignedOut(() => setUser(null));
    refresh();
    // The mode changes when the link comes and goes; the shift when a new snapshot arrives.
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      window.clearInterval(timer);
      onTillSignedOut(null);
    };
  }, [refresh]);

  const branch = useMemo<BranchContextValue>(() => {
    const b = state?.branch;
    const selected = b
      ? { id: b.id, tenant_id: '', code: b.code, name: b.name, is_active: true, created_at: '', branch_type: 'RESTAURANT' as const }
      : null;
    return {
      branches: selected ? [selected] : [],
      canChangeScope: false,
      selectedBranchId: selected?.id || '',
      selectedBranch: selected,
      isHeadOffice: false,
      selectedBranchType: selected ? 'RESTAURANT' : null,
      loading: false,
      setSelectedBranchId: () => undefined,
      refreshBranches: async () => undefined,
    };
  }, [state?.branch]);

  if (!state) {
    return (
      <Stack sx={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center', gap: 2, p: 2 }}>
        {unreachable ? <Alert severity="error">{unreachable}</Alert> : <CircularProgress />}
      </Stack>
    );
  }

  if (!user) return <TillSignIn state={state} onSignedIn={setUser} />;

  return (
    <TillContext.Provider value={{ state, refresh }}>
      <BranchContext.Provider value={branch}>
        <PosSourceProvider source={agentPosSource}>
          <SignedInTill state={state} user={user} unreachable={unreachable} refresh={refresh} onSignedOut={() => setUser(null)} />
        </PosSourceProvider>
      </BranchContext.Provider>
    </TillContext.Provider>
  );
}

function SignedInTill({
  state,
  user,
  unreachable,
  refresh,
  onSignedOut,
}: {
  state: TillState;
  user: TillUser;
  unreachable: string | null;
  refresh: () => Promise<void>;
  onSignedOut: () => void;
}) {
  const [ordersOpen, setOrdersOpen] = useState(false);
  const openOrders = useOpenOrders(ordersOpen);
  return (
    <>
      <TillHeader
        state={state}
        user={user}
        openOrders={openOrders.orders.length + openOrders.troubled.length}
        onOpenOrders={() => {
          openOrders.refresh();
          setOrdersOpen(true);
        }}
        onSignedOut={onSignedOut}
      />
      <Container maxWidth={false} sx={{ py: 2 }}>
        {unreachable && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {unreachable}
          </Alert>
        )}
        <ModeBanner
          state={state}
          onHandedOver={async () => {
            await refresh();
            await openOrders.refresh();
          }}
        />
        {state.mode === 'ONLINE' ? null : <PosOrderPage />}
      </Container>
      <OpenOrdersDrawer open={ordersOpen} onClose={() => setOrdersOpen(false)} {...openOrders} />
    </>
  );
}

/** Where the web POS has its dashboard header: the till, the mode, who is selling, and the switches. */
function TillHeader({
  state,
  user,
  openOrders,
  onOpenOrders,
  onSignedOut,
}: {
  state: TillState;
  user: TillUser;
  openOrders: number;
  onOpenOrders: () => void;
  onSignedOut: () => void;
}) {
  const { t } = useTranslation();
  const signOut = async () => {
    try {
      await tillApi.logout();
    } catch {
      // Signed out here either way.
    } finally {
      setTillToken(null);
      onSignedOut();
    }
  };
  return (
    <Box
      component="header"
      sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
    >
      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        {t('till.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
        {[state.branch?.name, state.till?.name].filter(Boolean).join(' · ')}
      </Typography>
      <Chip
        size="small"
        color={state.mode === 'OFFLINE' ? 'warning' : 'success'}
        icon={state.mode === 'OFFLINE' ? <CloudOffIcon /> : <CloudDoneIcon />}
        label={t(`till.mode.${state.mode}`)}
      />
      <Box sx={{ flexGrow: 1 }} />
      <Button
        size="small"
        variant="outlined"
        onClick={onOpenOrders}
        startIcon={
          <Badge badgeContent={openOrders} color="warning">
            <ReceiptLongIcon fontSize="small" />
          </Badge>
        }
        sx={{ fontWeight: 600 }}
      >
        {t('till.orders.title')}
      </Button>
      <Chip size="small" variant="outlined" label={user.display_name} />
      <LanguageToggle />
      <SettingsButton />
      <Tooltip title={t('till.signOut')}>
        <IconButton onClick={signOut} aria-label={t('till.signOut')}>
          <LogoutIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/** fa ⇄ en, as the web POS's language menu does it, without the flags it loads from the internet. */
function LanguageToggle() {
  const { t } = useTranslation();
  const { locale, setLocale } = useAuthStore();
  const settings = useSettingsContext();
  const next = locale === 'fa' ? 'en' : 'fa';
  return (
    <Tooltip title={t('common.languages', 'Languages')}>
      <Button
        size="small"
        variant="outlined"
        color="inherit"
        onClick={() => {
          setLocale(next);
          settings.setField('direction', next === 'fa' ? 'rtl' : 'ltr');
        }}
        sx={{ minWidth: 48 }}
      >
        {next === 'fa' ? 'فا' : 'EN'}
      </Button>
    </Tooltip>
  );
}

/**
 * The link is back (§13.5). ONLINE: the till takes nothing; the web POS sells. HANDOVER: orders
 * still open here are finished here or handed over, and nothing new starts.
 */
function ModeBanner({ state, onHandedOver }: { state: TillState; onHandedOver: () => Promise<void> }) {
  const { t } = useTranslation();
  const [webPos, setWebPos] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.mode === 'OFFLINE') return;
    tillApi
      .status()
      .then((s) => setWebPos(s.server ? `${s.server.replace(/\/$/, '')}/app/pos` : null))
      .catch(() => setWebPos(null));
  }, [state.mode]);

  if (state.mode === 'OFFLINE') return null;

  const handOver = async () => {
    setBusy(true);
    try {
      const res = await tillApi.handover();
      toast.success(t('till.handedOver', { handed: res.handed, dropped: res.dropped }));
      await onHandedOver();
    } catch (err: any) {
      toast.error(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  };

  const openWebPos = webPos ? (
    <Button color="inherit" size="small" href={webPos} target="_blank" rel="noopener">
      {t('till.openWebPos')}
    </Button>
  ) : null;

  return state.mode === 'ONLINE' ? (
    <Alert severity="success" sx={{ mb: 2 }} action={openWebPos}>
      {t('till.online')}
    </Alert>
  ) : (
    <Alert
      severity="warning"
      sx={{ mb: 2 }}
      action={
        <Stack direction="row" spacing={1}>
          <Button color="inherit" size="small" variant="outlined" disabled={busy} onClick={handOver}>
            {t('till.handoverButton')}
          </Button>
          {openWebPos}
        </Stack>
      }
    >
      {t('till.handover')}
    </Alert>
  );
}
