import type { BranchAgent } from 'src/api/agentsApi';

import { useTranslation } from 'react-i18next';
import React, { useMemo, useState } from 'react';

import CopyIcon from '@mui/icons-material/ContentCopy';
import {
  Box,
  Tab,
  Card,
  Chip,
  Tabs,
  Alert,
  Stack,
  Button,
  Divider,
  TextField,
  Typography,
  IconButton,
  CardContent,
  CircularProgress,
} from '@mui/material';

import { agentMode } from 'src/utils/agent-mode';
import { fDateTime } from 'src/utils/format-time';

import { agentAppState } from 'src/api/agentsApi';

import { PrintersPage } from './printers';
import { AgentPcPanel } from './agent-pc-panel';
import { CardTerminalsPage } from './card-terminals';
import { useAgentHealth, AgentHealthView } from './agent-health-drawer';

// ----------------------------------------------------------------------

type Props = {
  branchId: string;
  branchName?: string;
  /** The branch's agents, from the page's list; the active one is shown. */
  agents: BranchAgent[];
  /** The cloud's current app build, to say whether the agent's is behind. */
  cloudBuild: string | null;
  /** The branch's manager or head office: they change devices and this PC's settings. */
  canManage: boolean;
};

type TabKey = 'status' | 'printers' | 'terminals' | 'pc' | 'connect';

/**
 * Everything the agent's own page on the branch PC used to do, in the selling app itself
 * (2026-10-19): the agent's status and the registers' addresses, the branch's printers and card
 * terminals with what the agent says about each, test prints, this PC's settings and the agent's
 * logs, and, on the branch PC, connecting it to a branch. Everyone at the branch sees it; the
 * manager changes things.
 */
export function BranchAgentPanel({ branchId, branchName, agents, cloudBuild, canManage }: Props) {
  const { t } = useTranslation();
  const agent = agents.find((a) => a.branch_id === branchId && a.status === 'ACTIVE') ?? null;
  const { health, deviceNames, error, load } = useAgentHealth(agent?.id ?? null, branchId);
  // The app is open on the branch PC itself: it can talk to the agent there, cloud or not.
  const onAgentPc = !!agentMode && !agentMode.lan;
  const [tab, setTab] = useState<TabKey>(agent ? 'status' : onAgentPc ? 'connect' : 'status');

  const live = useMemo(() => {
    const printers: Record<string, string> = {};
    const terminals: Record<string, string> = {};
    for (const d of health?.connection.devices ?? []) {
      if (d.kind === 'printer') printers[d.id] = d.status;
      else terminals[d.id] = d.status;
    }
    return { printers, terminals };
  }, [health]);

  const connected = !!health?.connection.connected || !!agent?.connected;

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="h6">{t('operations.agents.branch.title', { branch: branchName || '' })}</Typography>
          {agent ? (
            <Chip
              size="small"
              color={connected ? 'success' : 'warning'}
              label={connected ? t('operations.agents.statusOnline', 'Online') : t('operations.agents.statusOffline', 'Offline')}
            />
          ) : (
            <Chip size="small" label={t('operations.agents.branch.noAgent')} />
          )}
          {agent?.hostname && (
            <Typography variant="body2" color="text.secondary">
              {agent.hostname} · {agent.agent_version || '—'}
            </Typography>
          )}
        </Stack>

        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
          <Tab value="status" label={t('operations.agents.branch.tabStatus')} />
          <Tab value="printers" label={t('operations.agents.branch.tabPrinters')} />
          <Tab value="terminals" label={t('operations.agents.branch.tabTerminals')} />
          <Tab value="pc" label={t('operations.agents.branch.tabPc')} disabled={!agent} />
          {onAgentPc && <Tab value="connect" label={t('operations.agents.branch.tabConnect')} />}
        </Tabs>

        {tab === 'status' &&
          (!agent ? (
            <Alert severity="info">{t('operations.agents.branch.noAgentHelp')}</Alert>
          ) : (
            <Stack spacing={2.5}>
              <AppAndAddresses agent={agent} cloudBuild={cloudBuild} />
              <Divider />
              {error && <Alert severity="error">{error}</Alert>}
              {!health && !error && <CircularProgress size={24} />}
              {health && <AgentHealthView health={health} deviceNames={deviceNames} showPc={false} />}
            </Stack>
          ))}

        {tab === 'printers' && <PrintersPage embedded readOnly={!canManage} liveStatus={live.printers} />}

        {tab === 'terminals' && <CardTerminalsPage embedded readOnly={!canManage} liveStatus={live.terminals} />}

        {tab === 'pc' && agent && (
          <AgentPcPanel
            agentId={agent.id}
            connected={connected}
            canAsk={connected && !!(health?.connection.capabilities ?? agent.capabilities)?.includes('agent.query')}
            canChange={canManage}
          />
        )}

        {tab === 'connect' && onAgentPc && <ConnectThisPc enrolled={!!agent} onDone={load} />}
      </CardContent>
    </Card>
  );
}

/** The app build the agent serves and the addresses the branch's other registers open it on. */
function AppAndAddresses({ agent, cloudBuild }: { agent: BranchAgent; cloudBuild: string | null }) {
  const { t } = useTranslation();
  const state = agentAppState(agent, cloudBuild);
  const appLabel: Record<string, string> = {
    UP_TO_DATE: t('operations.agents.appUpToDate', 'Up to date'),
    BEHIND: t('operations.agents.appBehind', 'Behind the cloud'),
    NO_BUILD: t('operations.agents.appNoBuild', 'No build yet'),
    NOT_SERVED: t('operations.agents.appNotServed', 'No app on this agent'),
    UNKNOWN: t('operations.agents.appServes', 'Serves the app'),
  };
  const copy = (url: string) => navigator.clipboard?.writeText(url).catch(() => undefined);

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 160 }}>
          {t('operations.agents.colApp', 'Cashier app')}
        </Typography>
        <Chip size="small" color={state === 'UP_TO_DATE' ? 'success' : state === 'BEHIND' || state === 'NO_BUILD' ? 'warning' : 'default'} label={appLabel[state]} />
        {agent.app_build_id && (
          <Typography variant="caption" color="text.secondary" dir="ltr" sx={{ fontFamily: 'monospace' }}>
            {agent.app_build_id}
          </Typography>
        )}
      </Stack>
      <Box>
        <Typography variant="body2" color="text.secondary">
          {t('operations.agents.branch.lanHelp')}
        </Typography>
        {agent.lan_urls?.length ? (
          agent.lan_urls.map((u) => (
            <Stack key={u} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" dir="ltr" sx={{ fontFamily: 'monospace' }}>
                {u}
              </Typography>
              <IconButton size="small" onClick={() => copy(u)} aria-label={t('operations.agents.branch.copy')}>
                <CopyIcon fontSize="inherit" />
              </IconButton>
            </Stack>
          ))
        ) : (
          <Typography variant="body2">{t('operations.agents.lanNone', 'No address')}</Typography>
        )}
      </Box>
      {agent.last_seen_at && (
        <Typography variant="caption" color="text.secondary">
          {t('operations.agents.colLastSeen', 'Last seen')}: {fDateTime(agent.last_seen_at)}
        </Typography>
      )}
    </Stack>
  );
}

/**
 * Connects this PC (the one the app is open on, through its agent) to a branch with a one-time
 * code from head office. The agent's own page did this before; it still does when no app has been
 * downloaded yet, since this page needs one.
 */
function ConnectThisPc({ enrolled, onDone }: { enrolled: boolean; onDone: () => void }) {
  const { t } = useTranslation();
  const [server, setServer] = useState(agentMode?.cloud_url || 'https://gnext.top');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enrolled && !window.confirm(t('operations.agents.branch.reenrolConfirm'))) return;
    setBusy(true);
    setMessage(null);
    try {
      // Same origin as the app: the agent's local API, which takes a write only with this header.
      const res = await fetch('/agent/api/enrol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Gnext-Local': '1' },
        body: JSON.stringify({ server, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setCode('');
      setMessage({ severity: 'success', text: t('operations.agents.branch.enrolled') });
      onDone();
    } catch (err: any) {
      setMessage({ severity: 'error', text: err?.message || t('operations.agents.branch.enrolError') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box component="form" onSubmit={submit} sx={{ maxWidth: 440 }}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {enrolled ? t('operations.agents.branch.reenrolHelp') : t('operations.agents.branch.enrolHelp')}
        </Typography>
        {message && <Alert severity={message.severity}>{message.text}</Alert>}
        <TextField
          label={t('operations.agents.branch.server')}
          value={server}
          onChange={(e) => setServer(e.target.value)}
          required
          slotProps={{ htmlInput: { dir: 'ltr' } }}
        />
        <TextField
          label={t('operations.agents.branch.code')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          placeholder="XXXX-XXXX"
          autoComplete="off"
          slotProps={{ htmlInput: { dir: 'ltr' } }}
        />
        <Box>
          <Button type="submit" variant="contained" disabled={busy || !code.trim()}>
            {t('operations.agents.branch.connect')}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}
