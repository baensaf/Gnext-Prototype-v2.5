import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import AlertTitle from '@mui/material/AlertTitle';

import { usePathname } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components/router-link';

import { useAuthStore } from 'src/store/useAuthStore';

import { canReachPath, homePathForRole } from 'src/config/role-access';

/**
 * Hiding a link in the sidebar is a courtesy, not a rule — the address bar is still there.
 * This applies the same table to whatever route actually rendered, so a typed URL lands
 * on an explanation rather than on a page the account was never meant to open.
 */
export function RoleGuard({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const role = useAuthStore((state) => state.user?.role);

  if (canReachPath(role, pathname)) {
    return <>{children}</>;
  }

  return (
    <Box sx={{ p: 3, maxWidth: 640, mx: 'auto' }}>
      <Alert
        severity="warning"
        action={
          <Button
            component={RouterLink}
            href={homePathForRole(role)}
            color="inherit"
            size="small"
          >
            {t('access.backHome', 'Go to my start page')}
          </Button>
        }
      >
        <AlertTitle>{t('access.deniedTitle', 'Not available for your role')}</AlertTitle>
        {t('access.deniedBody', 'This page belongs to another part of the organization. Your account does not have access to it.')}
      </Alert>
    </Box>
  );
}
