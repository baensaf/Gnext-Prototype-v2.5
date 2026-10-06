import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

import { Logo } from 'src/components/logo';

// ----------------------------------------------------------------------

/**
 * Shown in place of the app when it is opened or reloaded while Gnext cannot be reached and a
 * session may be there: whether the person is signed in is not known yet, so nothing is said
 * either way. The caller asks again until it gets a real answer. On a branch agent the
 * Reconnecting bar sits above this.
 */
export function ConnectingPage() {
  const { t } = useTranslation();

  return (
    <Box
      role="status"
      aria-live="polite"
      data-testid="connecting-page"
      sx={{
        minHeight: 'calc(100vh - var(--gnext-bar-h, 0px))',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        px: 3,
        textAlign: 'center',
        bgcolor: 'background.default',
      }}
    >
      <Logo disabled sx={{ mb: 1 }} />
      <CircularProgress size={28} />
      <Typography variant="h5">{t('auth.connecting.title', 'Connecting to Gnext…')}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 420 }}>
        {t(
          'auth.connecting.body',
          'You stay signed in. This screen continues as soon as Gnext answers.'
        )}
      </Typography>
    </Box>
  );
}
