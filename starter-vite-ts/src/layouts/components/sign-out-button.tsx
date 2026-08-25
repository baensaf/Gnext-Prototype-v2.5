import type { ButtonProps } from '@mui/material/Button';

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import Button from '@mui/material/Button';

import { useRouter } from 'src/routes/hooks';

import { useAuthStore } from 'src/store/useAuthStore';

// ----------------------------------------------------------------------

type Props = ButtonProps & {
  onClose?: () => void;
};

export function SignOutButton({ onClose, sx, ...other }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const logout = useAuthStore((state) => state.logout);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
      onClose?.();
      router.replace('/login');
    } catch (error) {
      console.error(error);
    }
  }, [logout, onClose, router]);

  return (
    <Button
      fullWidth
      variant="soft"
      size="large"
      color="error"
      onClick={handleLogout}
      sx={sx}
      {...other}
    >
      {t('auth.logout', 'Sign Out')}
    </Button>
  );
}
