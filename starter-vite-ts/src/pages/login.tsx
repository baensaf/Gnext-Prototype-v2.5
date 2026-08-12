import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import LanguageIcon from '@mui/icons-material/Language';
import {
  Box,
  Chip,
  Alert,
  Stack,
  Button,
  TextField,
  Typography,
  IconButton,
} from '@mui/material';

import { AuthSplitLayout } from 'src/layouts/auth-split';

import { useAuthStore } from 'src/store/useAuthStore';
import { useSettingsContext } from 'src/components/settings';

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { login, isLoading, error, locale, setLocale, clearError, isAuthenticated, fetchMe } = useAuthStore();
  const settings = useSettingsContext();

  const [username, setUsername] = useState('admin@gnext.local');
  const [password, setPassword] = useState('GnextDemo!2026');

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/app/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    const success = await login(username, password);
    if (success) {
      navigate('/app/dashboard');
    }
  };

  const handleToggleLanguage = () => {
    const activeLang = document.documentElement.lang || i18n.language || locale || 'fa';
    const nextLang = activeLang === 'fa' ? 'en' : 'fa';
    setLocale(nextLang);
    settings.setField('direction', nextLang === 'fa' ? 'rtl' : 'ltr');
  };

  return (
    <AuthSplitLayout
      slotProps={{
        section: {
          title: t('app.welcome'),
          subtitle: `${t('app.title')} - Multi-Tenant Operations & Master Catalog`,
        },
      }}
    >
      <Box sx={{ width: '100%' }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Chip
            label={t('app.simulatedBadge')}
            color="warning"
            size="small"
            sx={{ fontWeight: 'bold' }}
          />
          <IconButton id="login-language-toggle-btn" onClick={handleToggleLanguage} color="primary">
            <LanguageIcon />
          </IconButton>
        </Stack>

        <Box sx={{ mb: 3 }}>
          <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 1 }}>
            {t('auth.loginTitle')}
          </Typography>
        </Box>

        <Alert severity="info" sx={{ mb: 3, fontSize: '0.85rem' }}>
          <strong>{t('app.sharedAdminNotice')}</strong>
          <br />
          Username: <code>admin@gnext.local</code> | Password: <code>GnextDemo!2026</code>
        </Alert>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            <strong>{error.title}</strong>
            <div>{error.detail}</div>
            {error.correlationId && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Correlation ID: {error.correlationId}
              </Typography>
            )}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <Stack spacing={2.5}>
            <TextField
              label={t('auth.username')}
              fullWidth
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />

            <TextField
              label={t('auth.password')}
              type="password"
              fullWidth
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />

            <Button
              type="submit"
              variant="contained"
              size="large"
              fullWidth
              disabled={isLoading}
              sx={{ py: 1.2, fontWeight: 'bold', fontSize: '1rem' }}
            >
              {isLoading ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
          </Stack>
        </form>
      </Box>
    </AuthSplitLayout>
  );
}
