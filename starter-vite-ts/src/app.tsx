import 'src/global.css';

import { useEffect } from 'react';

import { usePathname } from 'src/routes/hooks';

import { isKioskHost } from 'src/config/kiosk-host';
import { themeConfig, ThemeProvider } from 'src/theme';
import { BranchProvider } from 'src/contexts/branch-context';

import { Snackbar } from 'src/components/snackbar';
import { IdleLogout } from 'src/components/idle-logout';
import { ProgressBar } from 'src/components/progress-bar';
import { MotionLazy } from 'src/components/animate/motion-lazy';
import { CloudStatusBar } from 'src/components/cloud-status-bar';
import { CalendarSync } from 'src/components/calendar-date-field';
import { SettingsDrawer, defaultSettings, SettingsProvider } from 'src/components/settings';

// ----------------------------------------------------------------------

type AppProps = {
  children: React.ReactNode;
};

export default function App({ children }: AppProps) {
  useScrollToTop();

  return (
    <BranchProvider>
      <SettingsProvider defaultSettings={defaultSettings}>
        <ThemeProvider
          modeStorageKey={themeConfig.modeStorageKey}
          defaultMode={themeConfig.defaultMode}
        >
          <MotionLazy>
            <Snackbar />
            {/* On a branch agent: the Reconnecting bar. Nothing elsewhere. */}
            <CloudStatusBar />
            <ProgressBar />
            <CalendarSync />
            {/* A kiosk sits idle between guests by design, so it is never signed out for it. */}
            {!isKioskHost() && <IdleLogout />}
            <SettingsDrawer defaultSettings={defaultSettings} />
            {children}
          </MotionLazy>
        </ThemeProvider>
      </SettingsProvider>
    </BranchProvider>
  );
}

// ----------------------------------------------------------------------

function useScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
