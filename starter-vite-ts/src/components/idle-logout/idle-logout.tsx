import { useTranslation } from 'react-i18next';
import { useRef, useState, useEffect, useCallback } from 'react';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';

import { settingsApi } from 'src/api/settingsApi';
import { useAuthStore } from 'src/store/useAuthStore';

// ----------------------------------------------------------------------

/** How long the "still there?" dialog waits before it signs the account out. */
const WARNING_SECONDS = 60;

/**
 * Activity that counts as somebody still being at the terminal. Deliberately not `mousemove`:
 * a till sits under a heat lamp on a shared counter and gets nudged all night, which would
 * keep a walked-away session alive forever.
 */
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'wheel'] as const;

/**
 * Signs an account out after a stretch of no activity, so a register left open at the end of
 * a shift is not somebody else's session to sell on.
 *
 * The delay is `SYSTEM.auto_logout_minutes`, which the tenant sets. Zero, missing, or an
 * unreadable settings call all mean "never" — an idle timer that defaults itself on would
 * throw cashiers out of a busy till over a setting nobody chose.
 */
export function IdleLogout() {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const logout = useAuthStore((state) => state.logout);

  const [idleMinutes, setIdleMinutes] = useState(0);
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WARNING_SECONDS);

  // Held in a ref, not state: every click would otherwise re-render the whole app. Seeded
  // to 0 and stamped in the effect below, because reading the clock during render is not
  // idempotent — React may render twice and get two different starting points.
  const lastActivity = useRef(0);

  useEffect(() => {
    if (!isAuthenticated) {
      setIdleMinutes(0);
      return;
    }
    settingsApi
      .getSettings()
      .then((settings) => {
        const minutes = Number(settings?.SYSTEM?.auto_logout_minutes ?? 0);
        setIdleMinutes(Number.isFinite(minutes) && minutes > 0 ? minutes : 0);
      })
      .catch(() => setIdleMinutes(0));
  }, [isAuthenticated]);

  const signOut = useCallback(async () => {
    setWarning(false);
    await logout();
    // A full reload rather than a route change: it drops any cart, dialog or half-typed
    // order still in memory, which is the point of signing out an unattended till.
    window.location.assign('/login');
  }, [logout]);

  const stayActive = useCallback(() => {
    lastActivity.current = Date.now();
    setWarning(false);
    setSecondsLeft(WARNING_SECONDS);
  }, []);

  // Watch for inactivity.
  useEffect(() => {
    if (!isAuthenticated || idleMinutes <= 0) return undefined;

    // The clock starts when the timer arms, not when the component first rendered.
    if (lastActivity.current === 0) lastActivity.current = Date.now();

    const idleMs = idleMinutes * 60_000;
    const markActive = () => {
      // While the dialog is up, only its own button counts. Otherwise the keystroke that
      // someone happens to make as it appears would silently cancel the warning.
      if (!warning) lastActivity.current = Date.now();
    };

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, markActive, { passive: true }));

    const tick = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= idleMs) setWarning(true);
    }, 5_000);

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, markActive));
      window.clearInterval(tick);
    };
  }, [isAuthenticated, idleMinutes, warning]);

  // Count the warning down, then sign out.
  useEffect(() => {
    if (!warning) return undefined;

    setSecondsLeft(WARNING_SECONDS);
    const countdown = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(countdown);
          void signOut();
          return 0;
        }
        return prev - 1;
      });
    }, 1_000);

    return () => window.clearInterval(countdown);
  }, [warning, signOut]);

  if (!warning) return null;

  return (
    <Dialog open onClose={stayActive} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold' }}>
        {t('auth.idleTitle', 'Are you still there?')}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          {t('auth.idleBody', 'This terminal has been idle. You will be signed out in {{count}} seconds.', {
            count: secondsLeft,
          })}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={() => void signOut()}>
          {t('auth.logout', 'Sign Out')}
        </Button>
        <Button variant="contained" onClick={stayActive} autoFocus>
          {t('auth.idleStay', "I'm still here")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
