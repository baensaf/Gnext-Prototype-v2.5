import React, { useState } from 'react';

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

import { approvalApi } from 'src/api/approvalApi';

interface ApprovalModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (pin: string) => void;
  actionName: string;
  detailsText?: string;
}

export function ApprovalModal({ open, onClose, onSuccess, actionName, detailsText }: ApprovalModalProps) {
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin) return;
    setLoading(true);
    setError(null);
    try {
      await approvalApi.verifyPin(pin, undefined, actionName);
      onSuccess(pin);
      setPin('');
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || err.detail || 'Invalid Manager PIN');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LockIcon color="primary" />
        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
          Manager PIN Authorization
        </Typography>
      </DialogTitle>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2}>
            <Alert severity="warning">
              This action (<strong>{actionName}</strong>) exceeds cashier operational limits and requires supervisor approval.
            </Alert>
            {detailsText && <Typography variant="body2">{detailsText}</Typography>}

            {error && <Alert severity="error">{error}</Alert>}

            <TextField
              label="Manager PIN"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoFocus
              required
              fullWidth
              placeholder="Enter 4-digit PIN (e.g. 1234)"
              slotProps={{ htmlInput: { maxLength: 8, style: { fontSize: 20, textAlign: 'center', letterSpacing: 6 } } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" color="primary" disabled={loading || !pin}>
            {loading ? 'Verifying...' : 'Authorize'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
