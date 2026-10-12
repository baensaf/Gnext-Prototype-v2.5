import type { Payment } from 'src/api/paymentApi';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Box,
  Stack,
  Alert,
  Button,
  Dialog,
  TextField,
  Typography,
  AlertTitle,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { paymentApi } from 'src/api/paymentApi';

import { toast, showErrorToast } from 'src/components/snackbar';

import { paymentErrorText } from './payment-errors';

// ----------------------------------------------------------------------

type Props = {
  payment: Payment;
  /** The charge's amount with its currency, as the pay dialog shows money. */
  amountText: string;
  onChanged: () => void;
};

/**
 * A card charge that has not been answered, shown at the top of the pay dialog. While the
 * terminal is still working it only says so. Once the terminal never confirmed it, the cashier
 * settles it from the slip: "the card was charged" (with the slip's RRN) or "not charged"; or
 * asks the terminal again. Nothing here charges again, and nothing else on the order can be paid
 * until this is answered.
 */
export function UnconfirmedChargeActions({ payment, amountText, onChanged }: Props) {
  const { t } = useTranslation();
  const unconfirmed = !!payment.needs_terminal_check;

  const [busy, setBusy] = useState(false);
  // Which answer the small form is for; null while it is closed.
  const [outcome, setOutcome] = useState<'APPROVED' | 'NOT_CHARGED' | null>(null);
  const [rrn, setRrn] = useState('');
  const [note, setNote] = useState('');

  const handleCheck = async () => {
    setBusy(true);
    try {
      const res = await paymentApi.checkTerminal(payment.id);
      toast.info(res.queued ? t('payments.unconfirmed.checkSent') : t('payments.unconfirmed.checkPending'));
      // The answer comes back through the agent; look again shortly.
      window.setTimeout(onChanged, 4000);
    } catch (err: any) {
      showErrorToast(err, paymentErrorText(t, err, t('payments.unconfirmed.checkError')));
    } finally {
      setBusy(false);
    }
  };

  const closeForm = () => {
    setOutcome(null);
    setRrn('');
    setNote('');
  };

  const handleResolve = async () => {
    if (!outcome) return;
    setBusy(true);
    try {
      await paymentApi.resolveTerminal(payment.id, {
        outcome,
        rrn: outcome === 'APPROVED' ? rrn.trim() : undefined,
        reason: note.trim() || undefined,
      });
      closeForm();
      toast.success(t('payments.unconfirmed.resolved'));
      onChanged();
    } catch (err: any) {
      toast.error(paymentErrorText(t, err, t('payments.unconfirmed.resolveError')));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = outcome === 'NOT_CHARGED' || (outcome === 'APPROVED' && !!rrn.trim());

  return (
    <>
      <Alert severity={unconfirmed ? 'warning' : 'info'} sx={{ mb: 2 }}>
        <AlertTitle sx={{ fontWeight: 700 }}>
          {t('payments.unconfirmed.title')} · {amountText}
        </AlertTitle>
        <Typography variant="body2">
          {unconfirmed ? t('payments.unconfirmed.help') : t('payments.unconfirmed.waiting')}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.5 }}>
          {t('pos.pay.answerFirst')}
        </Typography>

        {unconfirmed && (
          <Box sx={{ mt: 1.5 }}>
            <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
              <Button variant="contained" color="success" disabled={busy} onClick={() => setOutcome('APPROVED')}>
                {t('payments.unconfirmed.approved')}
              </Button>
              <Button variant="outlined" color="error" disabled={busy} onClick={() => setOutcome('NOT_CHARGED')}>
                {t('payments.unconfirmed.notCharged')}
              </Button>
            </Stack>
            <Button size="small" color="warning" disabled={busy} onClick={handleCheck} sx={{ mt: 0.5 }}>
              {t('payments.unconfirmed.check')}
            </Button>
          </Box>
        )}
      </Alert>

      <Dialog open={!!outcome} onClose={closeForm} fullWidth maxWidth="xs">
        <DialogTitle>
          {outcome === 'APPROVED' ? t('payments.unconfirmed.approved') : t('payments.unconfirmed.notCharged')} ·{' '}
          {amountText}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {outcome === 'APPROVED' ? t('payments.unconfirmed.approvedHelp') : t('payments.unconfirmed.notChargedHelp')}
            </Typography>
            {outcome === 'APPROVED' && (
              <TextField
                label={t('payments.unconfirmed.rrn')}
                value={rrn}
                onChange={(e) => setRrn(e.target.value)}
                slotProps={{ htmlInput: { dir: 'ltr', maxLength: 160 } }}
                required
                autoFocus
                fullWidth
              />
            )}
            <TextField
              label={t('payments.unconfirmed.note')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 500 } }}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={closeForm}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="contained" onClick={handleResolve} disabled={busy || !canSubmit}>
            {t('payments.unconfirmed.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
