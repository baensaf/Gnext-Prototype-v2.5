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

  const theme = createTheme({
    settingsState: settings.state,
    themeOverrides,
    localeComponents: i18n.language === 'fa' ? faIR : enUS,
  });

  return (
    <ThemeVarsProvider disableTransitionOnChange theme={theme} {...other}>
      <CssBaseline />
      <Rtl direction={settings.state.direction}>{children}</Rtl>
    </ThemeVarsProvider>
  );
}
