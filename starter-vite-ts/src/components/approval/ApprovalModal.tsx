import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import LockIcon from '@mui/icons-material/Lock';
import {
  Box,
  Stack,
  Alert,
  Dialog,
  Button,
  MenuItem,
  TextField,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { serverText } from 'src/utils/server-text';

import { useAuthStore } from 'src/store/useAuthStore';
import { approvalApi, type Approver } from 'src/api/approvalApi';

import { toast } from 'src/components/snackbar';

interface ApprovalModalProps {
  open: boolean;
  onClose: () => void;
  /** `approverId` is the manager picked in the dialog, for calls that send the pin on. */
  onSuccess: (pin: string, requestId?: string, approverId?: string) => void;
  actionName: string;
  detailsText?: string;
  entityType?: string;
  entityId?: string;
  createRequest?: boolean;
}

/** The manager picked last on this device, offered first next time. */
const LAST_APPROVER_KEY = 'gnext.lastApproverId';

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
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = useAuthStore((state) => state.user?.id);

  // The manager is named before the pin: every demo approver shares one pin, so the pin
  // alone cannot say who released the action.
  const [approvers, setApprovers] = useState<Approver[] | null>(null);
  const [approverId, setApproverId] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    approvalApi
      .listApprovers()
      .then((list) => {
        if (cancelled) return;
        setApprovers(list);
        // The manager picked last time on this device, then the signed-in account if it may
        // approve, then the first one at the branch.
        let remembered: string | null = null;
        try {
          remembered = window.localStorage.getItem(LAST_APPROVER_KEY);
        } catch {
          remembered = null;
        }
        const pick =
          list.find((a) => a.id === remembered) || list.find((a) => a.id === userId) || list[0];
        setApproverId(pick?.id || '');
      })
      .catch(() => {
        if (!cancelled) setApprovers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || !approverId) return;
    setLoading(true);
    setError(null);
    try {
      if (createRequest) {
        // Create pending request and approve it with PIN
        const req = await approvalApi.createRequest({
          action: actionName,
          entity_type: entityType,
          entity_id: entityId,
          reason: detailsText || `Manager authorization for ${actionName}`,
          details: { actionName, detailsText },
        });
        const approved = await approvalApi.approveRequest(req.id, pin, 'Manager PIN Authorization', approverId);
        toast.success(t('approval.authorized', 'Manager authorization granted'));
        onSuccess(pin, approved.id, approverId);
      } else {
        await approvalApi.verifyPin(pin, undefined, actionName, approverId);
        toast.success(t('approval.authorized', 'Manager authorization granted'));
        onSuccess(pin, undefined, approverId);
      }
      try {
        window.localStorage.setItem(LAST_APPROVER_KEY, approverId);
      } catch {
        // Remembering the pick is a convenience only.
      }
      setPin('');
      onClose();
    } catch (err: any) {
      const errorMsg = serverText(
        err.response?.data?.message || err.detail || err.message || t('auth.invalidCredentials', 'Invalid Manager PIN'),
        t
      );
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
          {t('approval.title', 'Manager PIN Authorization')}
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

            {approvers && approvers.length === 0 ? (
              <Alert severity="error">{t('approval.noApprovers')}</Alert>
            ) : (
              <TextField
                select
                label={t('approval.approverLabel')}
                value={approverId}
                onChange={(e) => setApproverId(e.target.value)}
                disabled={!approvers}
                fullWidth
              >
                {(approvers || []).map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.display_name}
                    {a.head_office ? ` (${t('approval.headOffice')})` : ''}
                  </MenuItem>
                ))}
              </TextField>
            )}

            <TextField
              label={t('approval.pinLabel', 'Manager PIN')}
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoFocus
              required
              fullWidth
              placeholder={t('approval.pinPlaceholder', 'Manager PIN')}
              slotProps={{ htmlInput: { maxLength: 8, style: { fontSize: 20, textAlign: 'center', letterSpacing: 6 } } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={loading}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="submit" variant="contained" color="primary" disabled={loading || !pin || !approverId}>
            {loading ? t('approval.verifying', 'Verifying...') : t('approval.authorize', 'Authorize')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
