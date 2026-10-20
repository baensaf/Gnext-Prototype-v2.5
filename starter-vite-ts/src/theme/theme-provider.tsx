import type { Theme, ThemeProviderProps as MuiThemeProviderProps } from '@mui/material/styles';
import type {} from './extend-theme-types';
import type { ThemeOptions } from './types';

import { useTranslation } from 'react-i18next';

import { faIR, enUS } from '@mui/material/locale';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider as ThemeVarsProvider } from '@mui/material/styles';

import { useSettingsContext } from 'src/components/settings';

import { createTheme } from './create-theme';
import { Rtl } from './with-settings/right-to-left';

// ----------------------------------------------------------------------

export type ThemeProviderProps = Partial<MuiThemeProviderProps<Theme>> & {
  themeOverrides?: ThemeOptions;
};

export function ThemeProvider({ themeOverrides, children, ...other }: ThemeProviderProps) {
  const settings = useSettingsContext();
  // MUI's own words - table paging, breadcrumbs, alerts - follow the app's language, so a
  // Persian page does not say "Rows per page".
  const { i18n } = useTranslation();
  // The layout's direction follows the language on screen. A direction saved separately can
  // disagree with it (sign-in applies the account's language without touching it), and left
  // English text laid out right to left.
  const direction = i18n.language === 'fa' ? 'rtl' : 'ltr';
  const settingsState = { ...settings.state, direction } as const;

  const theme = createTheme({
    settingsState,
    themeOverrides,
    localeComponents: i18n.language === 'fa' ? faIR : enUS,
  });

  return (
    <ThemeVarsProvider disableTransitionOnChange theme={theme} {...other}>
      <CssBaseline />
      <Rtl direction={direction}>{children}</Rtl>
    </ThemeVarsProvider>
  );
}
