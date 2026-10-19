import type { NetworkHost } from 'src/api/agentsApi';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import SearchIcon from '@mui/icons-material/Search';
import { Chip, Stack, Button, Typography, CircularProgress } from '@mui/material';

import { agentsApi, agentQueryMessage } from 'src/api/agentsApi';

// ----------------------------------------------------------------------

type Props = {
  branchId: string;
  port: number;
  /** The address picked from the list. */
  onPick: (host: string) => void;
};

/**
 * Finds network printers through the branch's agent (protocol §20): every address on the branch
 * PC's network that answers on the port. It used to be on the agent's own settings page.
 */
export function PrinterNetworkScan({ branchId, port, onPick }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<NetworkHost[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = async () => {
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      setFound((await agentsApi.scanBranchNetwork(branchId, port || 9100)).found);
    } catch (err: any) {
      setError(agentQueryMessage(t, err) || t('operations.printers.scan.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={busy ? <CircularProgress size={14} /> : <SearchIcon />}
          onClick={scan}
          disabled={busy || !branchId}
        >
          {t('operations.printers.scan.button')}
        </Button>
        <Typography variant="caption" color={error ? 'error' : 'text.secondary'}>
          {busy
            ? t('operations.printers.scan.busy')
            : error
              ? error
              : found
                ? found.length
                  ? t('operations.printers.scan.found', { count: found.length })
                  : t('operations.printers.scan.none')
                : ''}
        </Typography>
      </Stack>
      {found && found.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {found.map((f) => (
            <Chip key={`${f.host}:${f.port}`} label={f.host} onClick={() => onPick(f.host)} dir="ltr" variant="outlined" />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
