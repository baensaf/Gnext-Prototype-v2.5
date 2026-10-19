import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import LockIcon from '@mui/icons-material/Lock';
import {
  Alert,
  Stack,
  Button,
  Dialog,
  TextField,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { approvalApi } from 'src/api/approvalApi';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  /** The approving manager, once their sign-in is accepted. */
  onApproved: (approver: { id: string; name: string }) => void;
  /** Recorded with the approval, e.g. ASSIGN_DEVICE_TERMINAL. */
  actionName: string;
  /** What the manager is approving, in a sentence. */
  detailsText?: string;
};

/**
 * A manager approves on the cashier's screen by signing in with their own username and password
 * (R-15). Only this one action is approved: the cashier stays signed in, and nothing is kept.
 */
export function ManagerSignInDialog({ open, onClose, onApproved, actionName, detailsText }: Props) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsername('');
    setPassword('');
    setError(null);
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await approvalApi.verifySignIn(username, password, actionName);
      setPassword('');
      onApproved({ id: res.approver_user_id, name: res.display_name });
    } catch (err: any) {
      setPassword('');
      setError(
        err?.code === 'PIN_RATE_LIMITED'
          ? t('approval.signIn.rateLimited')
          : err?.code === 'APPROVAL_SIGN_IN_FAILED'
            ? t('approval.signIn.failed')
            : err?.detail || err?.message || t('approval.signIn.failed')
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
          <LockIcon fontSize="small" />
          {t('approval.signIn.title')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {detailsText && <Typography variant="body2">{detailsText}</Typography>}
            <Typography variant="body2" color="text.secondary">
              {t('approval.signIn.help')}
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label={t('approval.signIn.username')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              autoFocus
              required
              fullWidth
              slotProps={{ htmlInput: { dir: 'ltr' } }}
            />
            <TextField
              label={t('approval.signIn.password')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              required
              fullWidth
              slotProps={{ htmlInput: { dir: 'ltr' } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button type="submit" variant="contained" disabled={busy || !username || !password}>
            {t('approval.signIn.approve')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
