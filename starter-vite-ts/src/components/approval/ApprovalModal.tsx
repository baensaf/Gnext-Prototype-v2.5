import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import LockIcon from '@mui/icons-material/Lock';
import {
  Box,
  Stack,
  Alert,
  Dialog,
  Button,
  TextField,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { serverText } from 'src/utils/server-text';

import { approvalApi } from 'src/api/approvalApi';

import { toast } from 'src/components/snackbar';

interface ApprovalModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * The action was approved. `requestId` is the approved request when `createRequest` is set;
   * `approverId` is the manager who signed in. The first argument is no longer used (it was the
   * PIN before R-15).
   */
  onSuccess: (unused: string, requestId?: string, approverId?: string) => void;
  actionName: string;
  detailsText?: string;
  entityType?: string;
  entityId?: string;
  createRequest?: boolean;
}

/**
 * A manager approves on the cashier's screen by signing in with their own username and password
 * (R-15). Only this one action is approved: the cashier stays signed in. With `createRequest` the
 * approval becomes a request the server checks when the action is sent.
 */
export function ApprovalModal({
  open,
  onClose,
  onSuccess,
  actionName,
  detailsText,
  entityType = 'ORDER',
  entityId,
  createRequest = false,
}: ApprovalModalProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsername('');
    setPassword('');
    setError(null);
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    setError(null);
    try {
      if (createRequest) {
        const req = await approvalApi.createRequest({
          action: actionName,
          entity_type: entityType,
          entity_id: entityId,
          reason: detailsText || `Manager authorization for ${actionName}`,
          details: { actionName, detailsText },
        });
        const approved = await approvalApi.approveRequestBySignIn(req.id, username, password);
        toast.success(t('approval.authorized', 'Manager authorization granted'));
        onSuccess('', approved.id);
      } else {
        const res = await approvalApi.verifySignIn(username, password, actionName);
        toast.success(t('approval.authorized', 'Manager authorization granted'));
        onSuccess('', undefined, res.approver_user_id);
      }
      setPassword('');
      onClose();
    } catch (err: any) {
      setPassword('');
      const errorMsg =
        err?.code === 'PIN_RATE_LIMITED'
          ? t('approval.signIn.rateLimited')
          : err?.code === 'APPROVAL_SIGN_IN_FAILED'
            ? t('approval.signIn.failed')
            : serverText(err.response?.data?.message || err.detail || err.message || t('approval.signIn.failed'), t);
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LockIcon color="primary" />
        <Typography component="span" variant="h6" sx={{ fontWeight: 'bold' }}>
          {t('approval.signIn.title')}
        </Typography>
      </DialogTitle>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2}>
            <Alert severity="warning">
              {t('approval.warningText', 'This action exceeds cashier operational limits and requires supervisor approval.')} ({actionName})
            </Alert>
            {detailsText && <Typography variant="body2">{detailsText}</Typography>}

            {error && <Alert severity="error">{error}</Alert>}

            <TextField
              label={t('approval.signIn.username')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
              fullWidth
              autoComplete="off"
            />
            <TextField
              label={t('approval.signIn.password')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              fullWidth
              autoComplete="off"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={loading}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="submit" variant="contained" color="primary" disabled={loading || !username || !password}>
            {loading ? t('approval.verifying', 'Verifying...') : t('approval.authorize', 'Authorize')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
