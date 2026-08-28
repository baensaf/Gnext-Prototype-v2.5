import React from 'react';
import { useTranslation } from 'react-i18next';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

export interface ConfirmDialogProps {
  action?: React.ReactNode;
  cancelLabel?: string;
  confirmColor?: 'error' | 'info' | 'primary' | 'secondary' | 'success' | 'warning';
  confirmLabel?: string;
  content?: React.ReactNode;
  loading?: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  open: boolean;
  title: string;
}

export function ConfirmDialog({
  title,
  content,
  action,
  open,
  onClose,
  onConfirm,
  confirmLabel,
  cancelLabel,
  confirmColor = 'error',
  loading = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog fullWidth maxWidth="xs" open={open} onClose={onClose}>
      <DialogTitle sx={{ pb: 1, fontWeight: 700 }}>{title}</DialogTitle>

      {content && (
        <DialogContent sx={{ typography: 'body2', color: 'text.secondary' }}>
          {typeof content === 'string' ? <Typography variant="body2">{content}</Typography> : content}
        </DialogContent>
      )}

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        {action || (
          <>
            <Button variant="outlined" color="inherit" onClick={onClose} disabled={loading}>
              {cancelLabel || t('common.cancel', 'Cancel')}
            </Button>

            <Button
              variant="contained"
              color={confirmColor}
              onClick={onConfirm}
              disabled={loading}
              sx={{ fontWeight: 700 }}
            >
              {confirmLabel || t('common.confirm', 'Confirm')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
