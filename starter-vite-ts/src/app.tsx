import 'src/global.css';

import { useEffect } from 'react';

import { usePathname } from 'src/routes/hooks';

import { themeConfig, ThemeProvider } from 'src/theme';
import { BranchProvider } from 'src/contexts/branch-context';

import { Snackbar } from 'src/components/snackbar';
import { IdleLogout } from 'src/components/idle-logout';
import { ProgressBar } from 'src/components/progress-bar';
import { MotionLazy } from 'src/components/animate/motion-lazy';
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
            <ProgressBar />
            <CalendarSync />
            <IdleLogout />
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
