import type { ReasonCode } from 'src/api/settingsApi';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Box,
  Alert,
  Stack,
  Button,
  Dialog,
  MenuItem,
  TextField,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { shiftApi } from 'src/api/shiftApi';
import { settingsApi } from 'src/api/settingsApi';

// ----------------------------------------------------------------------

export type MovementType = 'PAID_IN' | 'PAID_OUT' | 'SAFE_DROP';

type Props = {
  open: boolean;
  onClose: () => void;
  shiftId: string;
  type: MovementType;
  onPosted: () => void;
};

/**
 * Cash in or out of a drawer between sales. A pay-out is money spent and needs a reason; a
 * safe drop only lifts cash into the safe, so the drawer holds less without anything being
 * spent; a pay-in tops the drawer up.
 */
export function MovementDialog({ open, onClose, shiftId, type, onPosted }: Props) {
  const { t } = useTranslation();
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);
  const [amount, setAmount] = useState('');
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount('');
    setReasonCodeId('');
    setNote('');
    setError(null);
    settingsApi
      .getReasonCodes()
      .then((codes) =>
        setReasonCodes(
          codes.filter((c) => c.is_active && (!c.applies_to?.length || c.applies_to.includes('SHIFT_CLOSE')))
        )
      )
      .catch(() => setReasonCodes([]));
  }, [open]);

  const needsReason = type === 'PAID_OUT' && !reasonCodeId && !note.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await shiftApi.recordMovement(shiftId, {
        type,
        amount,
        reasonCodeId: reasonCodeId || undefined,
        reason: note.trim() || undefined,
      });
      onPosted();
      onClose();
    } catch (err: any) {
      setError(err.detail || err.message || t('shift.movement.error', 'Could not record the movement'));
    } finally {
      setSubmitting(false);
    }
  };

  const title = {
    PAID_IN: t('shift.movement.paidIn', 'Pay in'),
    PAID_OUT: t('shift.movement.paidOut', 'Pay out'),
    SAFE_DROP: t('shift.movement.safeDrop', 'Safe drop'),
  }[type];

  const help = {
    PAID_IN: t('shift.movement.paidInHelp', 'Cash put into the drawer that is not a sale, such as extra change.'),
    PAID_OUT: t('shift.movement.paidOutHelp', 'Cash taken from the drawer and spent. Say what on.'),
    SAFE_DROP: t('shift.movement.safeDropHelp', 'Cash lifted from the drawer into the safe to keep the drawer light.'),
  }[type];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold' }}>{title}</DialogTitle>
      <Box component="form" onSubmit={submit}>
        <DialogContent>
          <Stack spacing={2}>
            <Alert severity="info">{help}</Alert>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label={t('shift.movement.amount', 'Amount (IRR)')}
              type="number"
              required
              fullWidth
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              slotProps={{ htmlInput: { min: 1, dir: 'ltr' } }}
            />
            {type !== 'PAID_IN' && reasonCodes.length > 0 && (
              <TextField
                select
                label={t('shift.movement.reasonCode', 'Reason code')}
                fullWidth
                value={reasonCodeId}
                onChange={(e) => setReasonCodeId(e.target.value)}
              >
                <MenuItem value="">{t('common.none', 'None')}</MenuItem>
                {reasonCodes.map((r) => (
                  <MenuItem key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              label={t('shift.movement.note', 'Note')}
              fullWidth
              multiline
              rows={2}
              required={type === 'PAID_OUT' && !reasonCodeId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={submitting}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="submit" variant="contained" disabled={submitting || !amount || needsReason}>
            {t('shift.movement.post', 'Record')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
