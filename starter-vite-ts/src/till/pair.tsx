import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import LinkIcon from '@mui/icons-material/Link';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import { Box, Card, Alert, Stack, Button, TextField, Typography, CircularProgress } from '@mui/material';

import { tillApi } from './agent-client';

// ----------------------------------------------------------------------

/** A short name for this device, from what the browser says it is; the manager may change it. */
function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Windows/i.test(ua)) return 'Windows PC';
  return 'Device';
}

/**
 * A device on the branch LAN that has not been paired yet (agent-protocol.md §18.5): the manager
 * types the code the branch PC's settings page gave for a register, and this device sells as it.
 */
export function TillPair({ branchName, onPaired }: { branchName?: string; onPaired: () => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [name, setName] = useState(guessDeviceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await tillApi.pair(code, name);
      onPaired();
    } catch (err: any) {
      setError(err.detail || err.message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, bgcolor: 'background.neutral' }}>
      <Card component="form" onSubmit={submit} sx={{ width: '100%', maxWidth: 420, p: 4, borderRadius: 3 }}>
        <Stack spacing={2.5}>
          <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <PointOfSaleIcon color="primary" sx={{ fontSize: 48 }} />
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {t('till.pair.title')}
            </Typography>
            {branchName && (
              <Typography variant="body2" color="text.secondary">
                {branchName}
              </Typography>
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t('till.pair.body')}
          </Typography>
          <TextField
            autoFocus
            label={t('till.pair.code')}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d۰-۹]/g, '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).slice(0, 6))}
            slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'off', dir: 'ltr', style: { letterSpacing: 8, textAlign: 'center' } } }}
            fullWidth
          />
          <TextField label={t('till.pair.deviceName')} value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} fullWidth />
          {error && <Alert severity="error">{error}</Alert>}
          <Button
            type="submit"
            size="large"
            variant="contained"
            disabled={busy || code.length !== 6}
            startIcon={busy ? <CircularProgress size={20} color="inherit" /> : <LinkIcon />}
          >
            {t('till.pair.submit')}
          </Button>
        </Stack>
      </Card>
    </Box>
  );
}
