import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import {
  Box,
  Alert,
  Stack,
  Button,
  Switch,
  Typography,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';

import { agentsApi, agentQueryMessage } from 'src/api/agentsApi';

// ----------------------------------------------------------------------

type Props = {
  agentId: string;
  /** Live and new enough to answer (capability `agent.query`, agent 2.5.0). */
  canAsk: boolean;
  connected: boolean;
  /** The branch's manager or head office; anyone else at the branch only looks (and reads the logs). */
  canChange?: boolean;
};

/**
 * The branch PC itself, asked live through its agent (protocol §20): what used to be on the
 * agent's own settings page at 127.0.0.1:47800. Nothing here is stored in the cloud.
 */
export function AgentPcPanel({ agentId, canAsk, connected, canChange = true }: Props) {
  const { t } = useTranslation();
  const [atSignIn, setAtSignIn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [logs, setLogs] = useState<string[] | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [message, setMessage] = useState<{ severity: 'success' | 'error' | 'info'; text: string } | null>(null);

  const fail = useCallback(
    (err: any) => setMessage({ severity: 'error', text: agentQueryMessage(t, err) || t('operations.agents.pc.error') }),
    [t]
  );

  useEffect(() => {
    setAtSignIn(null);
    setLogs(null);
    setMessage(null);
    if (!canAsk) return;
    agentsApi
      .pcSettings(agentId)
      .then((s) => setAtSignIn(s.app_at_sign_in))
      .catch(fail);
  }, [agentId, canAsk, fail]);

  if (!connected) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('operations.agents.pc.offline')}
      </Typography>
    );
  }
  if (!canAsk) {
    return <Alert severity="info">{t('operations.agents.pc.tooOld')}</Alert>;
  }

  const changeAtSignIn = async (on: boolean) => {
    setSaving(true);
    setMessage(null);
    try {
      const s = await agentsApi.setPcSettings(agentId, { app_at_sign_in: on });
      setAtSignIn(s.app_at_sign_in);
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const refreshApp = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      const res = await agentsApi.refreshApp(agentId);
      setMessage({ severity: 'success', text: res.changed ? t('operations.agents.pc.appNew') : t('operations.agents.pc.appCurrent') });
    } catch (err) {
      fail(err);
    } finally {
      setRefreshing(false);
    }
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      setLogs((await agentsApi.logs(agentId, 300)).lines);
    } catch (err) {
      fail(err);
    } finally {
      setLogsLoading(false);
    }
  };

  return (
    <Stack spacing={1.5}>
      {message && (
        <Alert severity={message.severity} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}
      <FormControlLabel
        control={
          <Switch
            checked={!!atSignIn}
            disabled={atSignIn === null || saving || !canChange}
            onChange={(e) => changeAtSignIn(e.target.checked)}
          />
        }
        label={t('operations.agents.pc.atSignIn')}
      />
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <Button size="small" variant="outlined" onClick={refreshApp} disabled={refreshing || !canChange}>
          {refreshing ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
          {t('operations.agents.pc.appRefresh')}
        </Button>
        <Button size="small" variant="outlined" onClick={loadLogs} disabled={logsLoading}>
          {logsLoading ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
          {logs ? t('operations.agents.pc.logsReload') : t('operations.agents.pc.logsShow')}
        </Button>
      </Stack>
      {logs && (
        <Box
          component="pre"
          dir="ltr"
          sx={{
            m: 0,
            p: 1.5,
            maxHeight: 320,
            overflow: 'auto',
            fontSize: 11,
            lineHeight: 1.5,
            borderRadius: 1,
            bgcolor: 'background.neutral',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {logs.join('\n') || '—'}
        </Box>
      )}
    </Stack>
  );
}
