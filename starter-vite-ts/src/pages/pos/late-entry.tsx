import type { TFunction } from 'i18next';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Stack,
  Alert,
  Button,
  Dialog,
  Switch,
  TextField,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
} from '@mui/material';

// ----------------------------------------------------------------------

/** What the cashier gives for a late entry; the manager's approval is added when it is sent. */
export type LateEntryInput = { reason: string; servedAt?: string };

/** Today at `HH:mm` on this machine's clock, as an ISO instant. */
const todayAt = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  const at = new Date();
  at.setHours(hours, minutes, 0, 0);
  return at;
};

const LATE_ERRORS: Record<string, string> = {
  APPROVAL_REQUIRED: 'approvalRequired',
  LATE_ENTRY_POS_ONLY: 'posOnly',
  LATE_ENTRY_REASON_REQUIRED: 'reasonRequired',
  LATE_SERVED_IN_FUTURE: 'servedFuture',
  APPROVAL_FOR_OTHER_ENTITY: 'usedElsewhere',
};

/** The words for a refused late entry; null when the error is not one of its own. */
export const lateEntryErrorText = (t: TFunction, err: any) => {
  const key = LATE_ERRORS[err?.code];
  return key ? t(`pos.lateEntry.errors.${key}`) : null;
};

// ----------------------------------------------------------------------

type SwitchProps = { checked: boolean; disabled?: boolean; onChange: (on: boolean) => void };

/** A forgotten order, served and paid for before it was rung up. Asked about when it is sent. */
export function LateEntrySwitch({ checked, disabled, onChange }: SwitchProps) {
  const { t } = useTranslation();
  return (
    <FormControlLabel
      sx={{ mx: 0, alignItems: 'center' }}
      disabled={disabled}
      control={
        <Switch size="small" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid="pos-late-entry-switch" />
      }
      label={
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t('pos.lateEntry.switch')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('pos.lateEntry.hint')}
          </Typography>
        </Stack>
      }
    />
  );
}

// ----------------------------------------------------------------------

type DialogProps = {
  open: boolean;
  onClose: () => void;
  /** The reason and, when given, roughly when it was served (an instant today). */
  onContinue: (input: LateEntryInput) => void;
};

/** The reason and the time it was served, asked as the order is sent; the manager's PIN comes next. */
export function LateEntryDialog({ open, onClose, onContinue }: DialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [time, setTime] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError(t('pos.lateEntry.reasonRequired'));
      return;
    }
    const servedAt = time ? todayAt(time) : null;
    if (servedAt && servedAt.getTime() > Date.now()) {
      setError(t('pos.lateEntry.servedFuture'));
      return;
    }
    onContinue({ reason: reason.trim(), servedAt: servedAt ? servedAt.toISOString() : undefined });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle sx={{ fontWeight: 700 }}>{t('pos.lateEntry.dialogTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {t('pos.lateEntry.dialogHelp')}
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              autoFocus
              required
              fullWidth
              multiline
              minRows={2}
              label={t('pos.lateEntry.reason')}
              placeholder={t('pos.lateEntry.reasonPlaceholder')}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              slotProps={{ htmlInput: { maxLength: 255 } }}
            />
            <TextField
              type="time"
              fullWidth
              label={t('pos.lateEntry.servedAt')}
              value={time}
              onChange={(e) => {
                setTime(e.target.value);
                setError(null);
              }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { dir: 'ltr' } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="submit" variant="contained">
            {t('pos.lateEntry.continue')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
