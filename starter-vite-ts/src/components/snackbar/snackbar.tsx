import Portal from '@mui/material/Portal';

import { Iconify } from '../iconify';
import { SnackbarRoot } from './styles';
import { snackbarClasses } from './classes';
import { useSettingsContext } from '../settings';

// ----------------------------------------------------------------------

export function Snackbar() {
  const settings = useSettingsContext();

  // Minimals pins the stack top-right; in Farsi it mirrors to top-left. The RTL style plugin
  // already moves the close button to the other corner.
  const isRtl = settings.state.direction === 'rtl';

  return (
    <Portal>
      <SnackbarRoot
        expand
        closeButton
        gap={12}
        offset={16}
        visibleToasts={4}
        dir={isRtl ? 'rtl' : 'ltr'}
        position={isRtl ? 'top-left' : 'top-right'}
        className={snackbarClasses.root}
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: snackbarClasses.toast,
            icon: snackbarClasses.icon,
            loader: snackbarClasses.loader,
            loading: snackbarClasses.loading,
            /********/
            content: snackbarClasses.content,
            title: snackbarClasses.title,
            description: snackbarClasses.description,
            /********/
            closeButton: snackbarClasses.closeButton,
            actionButton: snackbarClasses.actionButton,
            cancelButton: snackbarClasses.cancelButton,
            /********/
            info: snackbarClasses.info,
            error: snackbarClasses.error,
            success: snackbarClasses.success,
            warning: snackbarClasses.warning,
          },
        }}
        icons={{
          loading: <span className={snackbarClasses.loadingIcon} />,
          info: <Iconify className={snackbarClasses.iconSvg} icon="solar:info-circle-bold" />,
          success: <Iconify className={snackbarClasses.iconSvg} icon="solar:check-circle-bold" />,
          warning: (
            <Iconify className={snackbarClasses.iconSvg} icon="solar:danger-triangle-bold" />
          ),
          error: <Iconify className={snackbarClasses.iconSvg} icon="solar:danger-bold" />,
        }}
      />
    </Portal>
  );
}
