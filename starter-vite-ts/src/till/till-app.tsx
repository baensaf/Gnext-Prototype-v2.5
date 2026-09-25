import type { FormEvent, ReactNode } from 'react';
import type { CarriedCart } from 'src/pages/pos/order';
import type { PosSource } from 'src/contexts/pos-source';
import type { TillUser, TillState, TillCloud } from './agent-client';
import type { BranchContextValue } from 'src/contexts/branch-context';

import { useTranslation } from 'react-i18next';
import { useRef, useMemo, useState, useEffect, useCallback } from 'react';

import LogoutIcon from '@mui/icons-material/Logout';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import {
  Box,
  Card,
  Chip,
  Alert,
  Badge,
  Stack,
  Button,
  Tooltip,
  Container,
  TextField,
  Typography,
  IconButton,
  AlertTitle,
  CircularProgress,
} from '@mui/material';

import { PosOrderPage } from 'src/pages/pos/order';
import { useAuthStore } from 'src/store/useAuthStore';
import { BranchContext } from 'src/contexts/branch-context';
import { PosSourceProvider } from 'src/contexts/pos-source';
import { SettingsButton } from 'src/layouts/components/settings-button';

import { toast } from 'src/components/snackbar';
import { useSettingsContext } from 'src/components/settings';

import { carryTo } from './carry';
import { TillSignIn } from './sign-in';
import { TillContext } from './till-context';
import { agentPosSource } from './agent-source';
import { useOpenOrders, OpenOrdersDrawer } from './open-orders';
import { tillApi, setTillToken, onTillSignedOut } from './agent-client';
import { adoptCloudSession, TILL_CLOUD_CHANGED, tillCloudPosSource, forgetCloudSession } from './cloud-source';

// ----------------------------------------------------------------------

/**
 * The till on the branch PC: the web POS's register, all the time (agent-protocol.md §16).
 * While the cloud answers it sells through the cloud, its calls passed on by the agent; while
 * it does not, through the agent itself (§13). The agent says who may sign in, which till and
 * shift it sells on, and which of the two it is now.
 */
export function TillApp() {
  const [state, setState] = useState<TillState | null>(null);
  const [user, setUser] = useState<TillUser | null>(null);
  const [cloud, setCloud] = useState<TillCloud | null>(null);
  const [unreachable, setUnreachable] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await tillApi.state();
      setState(res.state);
      setUser(res.user);
      setCloud(res.cloud ?? null);
      setUnreachable(null);
    } catch (err: any) {
      setUnreachable(err.detail || err.message);
    }
  }, []);

  useEffect(() => {
    onTillSignedOut(() => {
      setUser(null);
      forgetCloudSession();
    });
    refresh();
    // The mode changes when the link comes and goes (§16.6 asks every 5 s), and at once when a
    // cloud call finds the cloud gone or the session ended; the shift when a snapshot arrives.
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener(TILL_CLOUD_CHANGED, refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(TILL_CLOUD_CHANGED, refresh);
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

  if (!user) {
    return (
      <TillSignIn
        state={state}
        onSignedIn={(signedIn) => {
          setUser(signedIn);
          refresh();
        }}
      />
    );
  }

  return (
    <TillContext.Provider value={{ state, refresh }}>
      <BranchContext.Provider value={branch}>
        <SignedInTill
          state={state}
          user={user}
          cloud={cloud}
          unreachable={unreachable}
          refresh={refresh}
          onSignedOut={() => {
            setUser(null);
            forgetCloudSession();
          }}
        />
      </BranchContext.Provider>
    </TillContext.Provider>
  );
}

function SignedInTill({
  state,
  user,
  cloud,
  unreachable,
  refresh,
  onSignedOut,
}: {
  state: TillState;
  user: TillUser;
  cloud: TillCloud | null;
  unreachable: string | null;
  refresh: () => Promise<void>;
  onSignedOut: () => void;
}) {
  const { t } = useTranslation();
  const [ordersOpen, setOrdersOpen] = useState(false);
  const openOrders = useOpenOrders(ordersOpen);

  // Through the cloud whenever it answers and the cashier has a session there (§16.5); through
  // the agent otherwise. Online without a session, the PIN is asked for first (§16.6).
  const online = state.mode !== 'OFFLINE';
  const session = online ? (cloud?.session ?? null) : null;
  const sessionUser = session?.user.id ?? null;
  const [adopted, setAdopted] = useState<string | null>(null);
  useEffect(() => {
    if (session) adoptCloudSession(session, state);
    setAdopted(sessionUser);
    // The session's user and the bound till are what the web app's screens read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUser, state.till?.id, state.branch?.id]);

  const source = session ? tillCloudPosSource : agentPosSource;
  const ready = !session || adopted === sessionUser;

  // §16.6: on a switch the register is a new screen on the other side, starting from the cart
  // the old one had, made ready for the new side.
  const lastCart = useRef<CarriedCart | null>(null);
  const onCartChange = useCallback((cart: CarriedCart) => {
    lastCart.current = cart;
  }, []);
  const [mounted, setMounted] = useState<{ kind: PosSource['kind']; carried: CarriedCart | null }>(() => ({
    kind: source.kind,
    carried: null,
  }));
  useEffect(() => {
    if (mounted.kind === source.kind) return undefined;
    let live = true;
    const next = source.kind === 'agent' ? 'agent' : 'till';
    carryTo(next, lastCart.current).then((carried) => {
      if (!live) return;
      lastCart.current = null;
      setMounted({ kind: source.kind, carried });
    });
    return () => {
      live = false;
    };
  }, [source.kind, mounted.kind]);

  // Said each time the till changes side (§16.7).
  const lastMode = useRef(state.mode);
  useEffect(() => {
    const was = lastMode.current;
    lastMode.current = state.mode;
    if (was === state.mode) return;
    if (state.mode === 'OFFLINE') toast.warning(t('till.wentOffline'), { duration: 10000 });
    else if (was === 'OFFLINE') toast.success(t('till.backOnline'), { duration: 10000 });
  }, [state.mode, t]);

  let register: ReactNode = null;
  if (online && !session) register = <CloudPin onDone={refresh} />;
  else if (ready && mounted.kind === source.kind) {
    register = (
      <PosSourceProvider source={source}>
        {/* A new screen for each source: its data and its shift hook are the source's own. */}
        <PosOrderPage key={source.kind} carried={mounted.carried} onCartChange={onCartChange} />
      </PosSourceProvider>
    );
  } else {
    register = (
      <Stack sx={{ alignItems: 'center', py: 6 }}>
        <CircularProgress />
      </Stack>
    );
  }

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
          pendingUploads={cloud?.pending_uploads ?? 0}
          onHandedOver={async () => {
            await refresh();
            await openOrders.refresh();
          }}
        />
        {register}
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
 * Which side a new order goes to (§16.7). OFFLINE: this PC, with what it cannot do paused.
 * ONLINE: the cloud, nothing to say. HANDOVER: the cloud, while the orders taken offline are
 * finished here or handed over.
 */
function ModeBanner({
  state,
  pendingUploads,
  onHandedOver,
}: {
  state: TillState;
  pendingUploads: number;
  onHandedOver: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  if (state.mode === 'ONLINE') {
    // Back online: the orders taken offline are on their way to the cloud, until none are left.
    return pendingUploads > 0 ? (
      <Alert severity="success" icon={<CloudDoneIcon />} sx={{ mb: 2 }}>
        {t('till.sending', { count: pendingUploads })}
      </Alert>
    ) : null;
  }
  if (state.mode === 'OFFLINE') {
    return (
      <Alert severity="warning" icon={<CloudOffIcon />} sx={{ mb: 2 }}>
        {t('till.offline')}
      </Alert>
    );
  }

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

  return (
    <Alert
      severity="info"
      sx={{ mb: 2 }}
      action={
        <Button color="inherit" size="small" variant="outlined" disabled={busy} onClick={handOver}>
          {t('till.handoverButton')}
        </Button>
      }
    >
      {t('till.handover')}
    </Alert>
  );
}

/**
 * The cloud answers again but the cashier has no session there: signed in while offline, or the
 * session ended. The agent never keeps a PIN, so it asks for it once (§16.6).
 */
function CloudPin({ onDone }: { onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pin) return;
    setBusy(true);
    setError(null);
    try {
      await tillApi.cloudLogin(pin);
      await onDone();
    } catch (err: any) {
      setError(err.detail || err.message);
    } finally {
      setPin('');
      setBusy(false);
    }
  };

  return (
    <Stack sx={{ alignItems: 'center', pt: 6 }}>
      <Card component="form" onSubmit={submit} sx={{ width: '100%', maxWidth: 420, p: 4, borderRadius: 3 }}>
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <CloudDoneIcon color="success" />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {t('till.cloudPin.title')}
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t('till.cloudPin.body')}
          </Typography>
          {error && (
            <Alert severity="error">
              <AlertTitle sx={{ mb: 0 }}>{error}</AlertTitle>
            </Alert>
          )}
          <TextField
            autoFocus
            label={t('till.signIn.pin')}
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 8, dir: 'ltr' } }}
          />
          <Button type="submit" variant="contained" size="large" disabled={busy || pin.length < 4}>
            {busy ? <CircularProgress size={22} /> : t('till.cloudPin.submit')}
          </Button>
        </Stack>
      </Card>
    </Stack>
  );
}
