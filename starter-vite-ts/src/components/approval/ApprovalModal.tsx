import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

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

import { usePosSource } from 'src/contexts/pos-source';

import { toast, showErrorToast } from 'src/components/snackbar';

interface ApprovalModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (pin: string, requestId?: string) => void;
  actionName: string;
  detailsText?: string;
  entityType?: string;
  entityId?: string;
  createRequest?: boolean;
}

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
  const pos = usePosSource();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin) return;
    setLoading(true);
    setError(null);
    try {
      if (createRequest) {
        // Create pending request and approve it with PIN
        const req = await pos.approvals.createRequest({
          action: actionName,
          entity_type: entityType,
          entity_id: entityId,
          reason: detailsText || `Manager authorization for ${actionName}`,
          details: { actionName, detailsText },
        });
        const approved = await pos.approvals.approveRequest(req.id, pin, 'Manager PIN Authorization');
        toast.success(t('approval.authorized', 'Manager authorization granted'));
        onSuccess(pin, approved.id);
      } else {
        await pos.approvals.verifyPin(pin, undefined, actionName);
        toast.success(t('approval.authorized', 'Manager authorization granted'));
        onSuccess(pin);
      }
      setPin('');
      onClose();
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || err.detail || err.message || t('auth.invalidCredentials', 'Invalid Manager PIN');
      setError(errorMsg);
      showErrorToast(err, errorMsg);
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

            <TextField
              label={t('approval.pinLabel', 'Manager PIN')}
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoFocus
              required
              fullWidth
              placeholder={t('approval.pinPlaceholder', 'Enter 4-digit PIN (e.g. 1234)')}
              slotProps={{ htmlInput: { maxLength: 8, style: { fontSize: 20, textAlign: 'center', letterSpacing: 6 } } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={loading}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="submit" variant="contained" color="primary" disabled={loading || !pin}>
            {loading ? t('approval.verifying', 'Verifying...') : t('approval.authorize', 'Authorize')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
