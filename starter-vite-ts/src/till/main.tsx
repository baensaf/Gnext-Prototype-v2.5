import './till.css';
import 'src/locales/i18n';

import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { createRoot } from 'react-dom/client';

import { themeConfig, ThemeProvider } from 'src/theme';

import { Snackbar } from 'src/components/snackbar';
import { MotionLazy } from 'src/components/animate/motion-lazy';
import { SettingsDrawer, defaultSettings, SettingsProvider } from 'src/components/settings';

import { TillApp } from './till-app';

// ----------------------------------------------------------------------

// The offline till, served by the branch agent at http://127.0.0.1:47800/till/. It is the web
// POS's own register under the same theme, settings and languages, with nothing loaded from the
// internet. A memory router: the screens link within the app, but the till has one page.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MemoryRouter>
      <SettingsProvider defaultSettings={defaultSettings}>
        <ThemeProvider modeStorageKey={themeConfig.modeStorageKey} defaultMode={themeConfig.defaultMode}>
          <MotionLazy>
            <Snackbar />
            <SettingsDrawer defaultSettings={defaultSettings} />
            <TillApp />
          </MotionLazy>
        </ThemeProvider>
      </SettingsProvider>
    </MemoryRouter>
  </StrictMode>
);
