import type { ShiftStatement } from 'src/api/shiftApi';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import LockIcon from '@mui/icons-material/Lock';
import {
  Box,
  Alert,
  Paper,
  Stack,
  Button,
  Dialog,
  Divider,
  TextField,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';

import { shiftApi } from 'src/api/shiftApi';
import { cashDrawerApi } from 'src/api/cashDrawerApi';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  shiftId: string;
  shiftNumber?: string;
  onClosed: () => void;
};

/**
 * Counting a drawer down at the end of a shift. This closes one register's shift; the
 * branch's day is closed separately, on Business Days, once every drawer is counted.
 */
export function CloseShiftDialog({ open, onClose, shiftId, shiftNumber, onClosed }: Props) {
  const { t } = useTranslation();
  const [statement, setStatement] = useState<ShiftStatement | null>(null);
  const [actualCash, setActualCash] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNotes('');
    shiftApi
      .getShiftStatement(shiftId)
      .then((stmt) => {
        setStatement(stmt);
        setActualCash(stmt.expectedCash || '0');
      })
      .catch((err: any) => setError(err.detail || err.message));
  }, [open, shiftId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await cashDrawerApi.closeShift(shiftId, { actual_cash: actualCash, notes: notes || undefined });
      onClosed();
      onClose();
    } catch (err: any) {
      setError(err.detail || err.message || t('shift.close.error', 'Could not close the shift'));
    } finally {
      setSubmitting(false);
    }
  };

  const variance = statement ? MoneyUtil.subtract(actualCash || '0', statement.expectedCash || '0', 2) : '0';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold' }}>
        {t('shift.close.title', 'Close shift')} {shiftNumber && <span dir="ltr">#{shiftNumber}</span>}
      </DialogTitle>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent>
          {!statement && !error ? (
            <Stack sx={{ alignItems: 'center', py: 3 }}>
              <CircularProgress size={28} />
            </Stack>
          ) : (
            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}
              {statement && (
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      {t('cashier.expectedCash', 'Expected Cash')}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      {MoneyUtil.formatCurrency(statement.expectedCash)}
                    </Typography>
                  </Stack>
                  <Divider sx={{ my: 1 }} />
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="subtitle2">{t('shift.close.variance', 'Over / short')}</Typography>
                    <Typography
                      variant="subtitle2"
                      sx={{ color: MoneyUtil.greaterThanOrEqual(variance, '0') ? 'success.main' : 'error.main' }}
                    >
                      {MoneyUtil.formatCurrency(variance)}
                    </Typography>
                  </Stack>
                </Paper>
              )}
              <TextField
                label={t('shift.close.counted', 'Counted cash (IRR)')}
                type="number"
                required
                fullWidth
                value={actualCash}
                onChange={(e) => setActualCash(e.target.value)}
                slotProps={{ htmlInput: { min: 0, dir: 'ltr' } }}
              />
              <TextField
                label={t('shift.close.notes', 'Notes / reason for a difference')}
                fullWidth
                multiline
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={submitting}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            type="submit"
            variant="contained"
            color="error"
            startIcon={<LockIcon />}
            disabled={submitting || !statement}
          >
            {t('shift.close.confirm', 'Close shift')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
