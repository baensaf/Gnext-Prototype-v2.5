import { useTranslation } from 'react-i18next';
import { useRef, useState, useEffect } from 'react';

import Box from '@mui/material/Box';
import GlobalStyles from '@mui/material/GlobalStyles';
import CircularProgress from '@mui/material/CircularProgress';

import { agentMode } from 'src/utils/agent-mode';
import { BACK_FOR_MS } from 'src/utils/cloud-link';
import { useCloudBarPhase } from 'src/utils/agent-link';
import { dispatchCloudBack } from 'src/utils/cloud-back';

import { layoutClasses } from 'src/layouts/core/classes';

import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------

/** The bar's height. The page is moved down by it while the bar shows, so nothing hides behind it. */
const BAR_HEIGHT = 28;

/**
 * The thin bar across the top of the screen on a branch agent (agent-protocol.md §19.10): amber
 * *Reconnecting* when the cloud has been out of reach for more than 2 s, a different line after 2
 * minutes, and green *Connected again* for 3 s once it is back, when it also sends the
 * `gnext:cloud-back` event that makes the screens read their data again. Renders nothing outside
 * agent mode.
 */
export function CloudStatusBar() {
  if (!agentMode) return null;
  return <Bar />;
}

function Bar() {
  const { t } = useTranslation();
  const phase = useCloudBarPhase();

  // "Back" is shown once the bar has been up and the cloud answers again.
  const [back, setBack] = useState(false);
  const wasShown = useRef(false);
  useEffect(() => {
    if (phase !== 'hidden') {
      wasShown.current = true;
      setBack(false);
      return undefined;
    }
    if (!wasShown.current) return undefined;
    wasShown.current = false;
    setBack(true);
    dispatchCloudBack();
    const timer = setTimeout(() => setBack(false), BACK_FOR_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const visible = phase !== 'hidden' || back;

  // The layout under the bar (a sticky header, a fixed side menu, the register that measures its
  // own height) reads the window's size, so tell it when the room above it changed.
  useEffect(() => {
    window.dispatchEvent(new Event('resize'));
  }, [visible]);

  if (!visible) return null;

  const isBack = phase === 'hidden';
  const message = isBack
    ? t('agent.reconnect.back', 'Connected again')
    : phase === 'offline'
      ? t('agent.reconnect.offline', "No internet. Orders can't be sent until it is back.")
      : t('agent.reconnect.reconnecting', 'Reconnecting to Gnext… your screen and cart are kept');

  return (
    <>
      <GlobalStyles
        styles={{
          ':root': { '--gnext-bar-h': `${BAR_HEIGHT}px` },
          body: { paddingTop: 'var(--gnext-bar-h)' },
          // The header sticks under the bar, and the side menu starts under it.
          [`.${layoutClasses.header}`]: { top: 'var(--gnext-bar-h)' },
          [`.${layoutClasses.nav.vertical}`]: {
            top: 'var(--gnext-bar-h)',
            height: 'calc(100% - var(--gnext-bar-h))',
          },
        }}
      />
      <Box
        role="status"
        aria-live="polite"
        data-testid="cloud-status-bar"
        data-phase={isBack ? 'back' : phase}
        sx={(theme) => ({
          position: 'fixed',
          top: 0,
          insetInline: 0,
          height: BAR_HEIGHT,
          zIndex: theme.zIndex.modal + 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          px: 2,
          typography: 'caption',
          fontWeight: 600,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          bgcolor: isBack ? 'success.main' : 'warning.main',
          color: isBack ? 'success.contrastText' : 'warning.contrastText',
          boxShadow: theme.shadows[2],
        })}
      >
        {isBack ? (
          <Iconify width={16} icon="solar:check-circle-bold" />
        ) : (
          <CircularProgress size={12} thickness={6} color="inherit" />
        )}
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {message}
        </Box>
      </Box>
    </>
  );
}
