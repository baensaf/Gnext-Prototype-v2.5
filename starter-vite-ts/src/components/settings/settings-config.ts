import type { SettingsState } from './types';

import { CONFIG } from 'src/global-config';
import { themeConfig } from 'src/theme/theme-config';

// ----------------------------------------------------------------------

export const SETTINGS_STORAGE_KEY: string = 'app-settings';

const savedLang = typeof window !== 'undefined' ? (localStorage.getItem('gnext_locale') || 'fa') : 'fa';

export const defaultSettings: SettingsState = {
  mode: themeConfig.defaultMode,
  direction: savedLang === 'fa' ? 'rtl' : 'ltr',
  contrast: 'default',
  navLayout: 'vertical',
  primaryColor: 'default',
  navColor: 'integrate',
  compactLayout: true,
  fontSize: 16,
  fontFamily: themeConfig.fontFamily.primary,
  version: CONFIG.appVersion,
};
