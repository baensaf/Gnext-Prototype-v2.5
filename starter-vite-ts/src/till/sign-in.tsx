import type { TillUser, TillState } from './agent-client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import LockOpenIcon from '@mui/icons-material/LockOpen';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import {
  Box,
  Card,
  Alert,
  Stack,
  Button,
  Select,
  MenuItem,
  TextField,
  InputLabel,
  Typography,
  FormControl,
  CircularProgress,
} from '@mui/material';

import { tillApi, setTillToken } from './agent-client';

// ----------------------------------------------------------------------

type Props = {
  state: TillState;
  onSignedIn: (user: TillUser) => void;
};

/** Who is selling: a name from the branch's staff list and their PIN, checked by the agent. */
export function TillSignIn({ state, onSignedIn }: Props) {
  const { t } = useTranslation();
  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !pin) return;
    setBusy(true);
    setError(null);
    try {
      const res = await tillApi.login(userId, pin);
      setTillToken(res.token);
      setPin('');
      onSignedIn(res.user);
    } catch (err: any) {
      setError(err.detail || err.message);
      setPin('');
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
              {t('till.title')}
            </Typography>
            {(state.branch || state.till) && (
              <Typography variant="body2" color="text.secondary">
                {[state.branch?.name, state.till ? `${state.till.name} (${state.till.code})` : null].filter(Boolean).join(' · ')}
              </Typography>
            )}
          </Stack>

          {state.problems.map((p) => (
            <Alert key={p} severity={p === 'NO_STAFF' || p === 'NO_SNAPSHOT' ? 'error' : 'warning'}>
              {t(`till.problems.${p}`, p)}
            </Alert>
          ))}

          <FormControl fullWidth disabled={state.staff.length === 0}>
            <InputLabel>{t('till.signIn.who')}</InputLabel>
            <Select value={userId} label={t('till.signIn.who')} onChange={(e) => setUserId(e.target.value)}>
              {state.staff.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.display_name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label={t('till.signIn.pin')}
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={!userId}
            slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'off', dir: 'ltr' } }}
            fullWidth
          />

          {error && <Alert severity="error">{error}</Alert>}

          <Button
            type="submit"
            size="large"
            variant="contained"
            disabled={busy || !userId || pin.length < 4}
            startIcon={busy ? <CircularProgress size={20} color="inherit" /> : <LockOpenIcon />}
          >
            {t('till.signIn.submit')}
          </Button>
        </Stack>
      </Card>
    </Box>
  );
}
