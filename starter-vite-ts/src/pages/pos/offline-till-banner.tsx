import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import CloudOffIcon from '@mui/icons-material/CloudOff';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import { Card, Alert, Stack, Button, AlertTitle, Typography } from '@mui/material';

import { useCloudUnreachable } from 'src/utils/cloud-reachability';
import { readDeviceTerminal, DEVICE_TERMINAL_CHANGED } from 'src/utils/device-terminal';

import { httpClient } from 'src/api/httpClient';

import { VersionTag } from 'src/components/version-tag';

// ----------------------------------------------------------------------

/** Where the branch agent serves Gnext POS, on the branch PC (agent-protocol.md §13.13). */
export const OFFLINE_TILL_URL = 'http://127.0.0.1:47800/till/';

/**
 * The web POS's way to Gnext POS (§13.14, HANDOFF-offline-pos.md decision 8): once its requests
 * to the cloud have failed for 30 s, it says the internet is down and links to the till on the
 * branch PC. It does not probe the agent, and nothing moves on its own.
 */
export function OfflineTillBanner() {
  const { t } = useTranslation();
  const unreachable = useCloudUnreachable();
  if (!unreachable) return null;
  return (
    <Alert
      severity="error"
      icon={<CloudOffIcon />}
      sx={{ mb: 2.5 }}
      action={
        <Button
          color="inherit"
          variant="outlined"
          size="small"
          href={OFFLINE_TILL_URL}
          target="_blank"
          rel="noopener"
          endIcon={<OpenInNewIcon fontSize="small" />}
          sx={{ whiteSpace: 'nowrap', fontWeight: 700 }}
        >
          {t('pos.offlineTill.open')}
        </Button>
      }
    >
      <AlertTitle sx={{ fontWeight: 700 }}>
        {t('pos.offlineTill.title')} <VersionTag feature="pos.offlineTill" />
      </AlertTitle>
      {t('pos.offlineTill.body')}
    </Alert>
  );
}

// ----------------------------------------------------------------------

const RECHECK_MS = 60_000;

/**
 * Whether this device's register is the branch PC's Gnext POS (§16.10): the branch agent's till
 * is bound to it. One drawer has one screen, so the web POS then does not sell on it. Asked on
 * load and every minute; an error reads as "no", so a failed check never stops a sale.
 */
export function useServedByAgentTill(enabled: boolean): boolean {
  const [terminalId, setTerminalId] = useState(() => readDeviceTerminal()?.id ?? null);
  const [served, setServed] = useState(false);

  useEffect(() => {
    const sync = () => setTerminalId(readDeviceTerminal()?.id ?? null);
    window.addEventListener(DEVICE_TERMINAL_CHANGED, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(DEVICE_TERMINAL_CHANGED, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !terminalId) {
      setServed(false);
      return undefined;
    }
    let live = true;
    const check = () =>
      httpClient
        .get(`/api/v1/terminals/${terminalId}/agent-till`, { headers: { 'X-Skip-Toast': 'true' } })
        .then((res) => {
          if (live) setServed(Boolean(res.data?.served_by_agent));
        })
        .catch(() => {
          if (live) setServed(false);
        });
    check();
    const timer = window.setInterval(check, RECHECK_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [enabled, terminalId]);

  return served;
}

/** In place of the web POS on a register that the branch PC's Gnext POS serves. */
export function AgentTillNotice() {
  const { t } = useTranslation();
  return (
    <Card sx={{ p: { xs: 3, md: 5 }, maxWidth: 640, mx: 'auto', mt: { xs: 2, md: 6 } }}>
      <Stack spacing={2.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
        <PointOfSaleIcon sx={{ fontSize: 56, color: 'primary.main' }} />
        <Typography variant="h5">{t('pos.offlineTill.servedTitle')}</Typography>
        <Typography color="text.secondary">{t('pos.offlineTill.servedBody')}</Typography>
        <Button variant="contained" size="large" href={OFFLINE_TILL_URL} endIcon={<OpenInNewIcon />} sx={{ fontWeight: 700 }}>
          {t('pos.offlineTill.open')}
        </Button>
      </Stack>
    </Card>
  );
}
