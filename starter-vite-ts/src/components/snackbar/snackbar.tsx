import type { ToasterProps } from 'sonner';

import { Toaster as SonnerToaster } from 'sonner';

import { useTheme } from '@mui/material/styles';
import GlobalStyles from '@mui/material/GlobalStyles';

import { useSettingsContext } from 'src/components/settings';

import { snackbarClasses } from './classes';

// ----------------------------------------------------------------------

export type SnackbarProps = ToasterProps;

export function Snackbar({ ...other }: SnackbarProps) {
  const theme = useTheme();
  const settings = useSettingsContext();

  const isRtl = settings.state.direction === 'rtl';
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light';

  return (
    <>
      <GlobalStyles
        styles={{
          '.toaster': {
            fontFamily: theme.typography.fontFamily,
          },
          [`.${snackbarClasses.toast}`]: {
            fontFamily: `${theme.typography.fontFamily} !important`,
            borderRadius: '12px !important',
            boxShadow: theme.shadows[8],
          },
        }}
      />
      <SonnerToaster
        dir={isRtl ? 'rtl' : 'ltr'}
        theme={mode}
        position={isRtl ? 'top-left' : 'top-right'}
        richColors
        closeButton
        expand={false}
        duration={4000}
        className={snackbarClasses.root}
        toastOptions={{
          className: snackbarClasses.toast,
          style: {
            fontFamily: theme.typography.fontFamily,
          },
        }}
        {...other}
      />
    </>
  );
}
