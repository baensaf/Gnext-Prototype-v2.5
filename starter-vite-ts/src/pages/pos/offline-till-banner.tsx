import { useTranslation } from 'react-i18next';

import CloudOffIcon from '@mui/icons-material/CloudOff';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Alert, Button, AlertTitle } from '@mui/material';

import { useCloudUnreachable } from 'src/utils/cloud-reachability';

// ----------------------------------------------------------------------

/** Where the branch agent serves the offline till, on the branch PC (agent-protocol.md §13.13). */
export const OFFLINE_TILL_URL = 'http://127.0.0.1:47800/till/';

/**
 * The web POS's way to the offline till (§13.14, HANDOFF-offline-pos.md decision 8): once its
 * requests to the cloud have failed for 30 s, it says the internet is down and links to the till
 * on the branch PC. It does not probe the agent, and nothing moves on its own: the cashier opens
 * the till, so two screens never take orders at once.
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
      <AlertTitle sx={{ fontWeight: 700 }}>{t('pos.offlineTill.title')}</AlertTitle>
      {t('pos.offlineTill.body')}
    </Alert>
  );
}
