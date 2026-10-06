import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import AlertTitle from '@mui/material/AlertTitle';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components/router-link';

import { agentMode } from 'src/utils/agent-mode';

import { isAgentRoute } from 'src/config/agent-routes';

import { Iconify } from 'src/components/iconify';

/**
 * On a branch agent the app serves the cashier's pages only (agent-routes.ts). Any other
 * address, typed, bookmarked or reached from a link, lands on a note and a button that opens
 * the same page on the cloud. Outside agent mode it renders its children and nothing else.
 */
export function AgentGuard({ children }: { children: React.ReactNode }) {
  const { pathname, search } = useLocation();

  if (!agentMode || isAgentRoute(pathname)) {
    return <>{children}</>;
  }

  return <CloudOnlyPage cloudUrl={agentMode.cloud_url} pathAndQuery={`${pathname}${search}`} />;
}

function CloudOnlyPage({ cloudUrl, pathAndQuery }: { cloudUrl: string; pathAndQuery: string }) {
  const { t } = useTranslation();
  const host = new URL(cloudUrl).host;
  // The cloud's address for this very page: the same path and query on the cloud's origin.
  const href = new URL(pathAndQuery, cloudUrl).href;

  return (
    <Box sx={{ p: 3, maxWidth: 640, mx: 'auto' }}>
      <Alert severity="info">
        <AlertTitle>{t('agent.cloudOnly.title', 'This page opens on {{host}}', { host })}</AlertTitle>
        {t(
          'agent.cloudOnly.body',
          'This PC runs the register, orders, delivery and shifts. Management and head-office pages open on Gnext itself, in a new tab.'
        )}
      </Alert>

      <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 2, flexWrap: 'wrap' }}>
        <Button
          component="a"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          variant="contained"
          startIcon={<Iconify width={18} icon="eva:external-link-fill" />}
        >
          {t('agent.cloudOnly.open', 'Open on {{host}}', { host })}
        </Button>
        <Button component={RouterLink} href={paths.app.pos} color="inherit">
          {t('agent.cloudOnly.back', 'Back to the register')}
        </Button>
      </Stack>
    </Box>
  );
}
