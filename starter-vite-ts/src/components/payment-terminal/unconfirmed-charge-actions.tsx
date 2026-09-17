import type { Payment } from 'src/api/paymentApi';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Stack,
  Alert,
  Button,
  Dialog,
  Select,
  MenuItem,
  TextField,
  InputLabel,
  DialogTitle,
  FormControl,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { paymentApi } from 'src/api/paymentApi';
import { useAuthStore } from 'src/store/useAuthStore';

import { toast, showErrorToast } from 'src/components/snackbar';

// ----------------------------------------------------------------------

/** Mirrors the server: only a manager may settle a charge by hand. */
const RESOLVER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OWNER', 'MANAGER'];

type Props = {
  payment: Payment;
  onChanged: () => void;
};

/**
 * For a card charge the terminal never confirmed: ask the terminal again, or (a manager)
 * settle it from the terminal's own receipt or report. The customer may have been charged,
 * so nothing here charges again.
 */
export function UnconfirmedChargeActions({ payment, onChanged }: Props) {
  const { t } = useTranslation();
  const role = useAuthStore((state) => state.user?.role);
  const canResolve = RESOLVER_ROLES.includes((role || '').toUpperCase());

  const [busy, setBusy] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [outcome, setOutcome] = useState<'APPROVED' | 'NOT_CHARGED'>('APPROVED');
  const [rrn, setRrn] = useState('');
  const [reason, setReason] = useState('');

  const handleCheck = async () => {
    setBusy(true);
    try {
      const res = await paymentApi.checkTerminal(payment.id);
      toast.info(
        res.queued
          ? t('payments.unconfirmed.checkSent', 'Asked the card terminal. The result appears here in a moment.')
          : t('payments.unconfirmed.checkPending', 'The terminal has already been asked; waiting for its answer.')
      );
      // The answer comes back through the agent; look again shortly.
      window.setTimeout(onChanged, 4000);
    } catch (err: any) {
      showErrorToast(err, t('payments.unconfirmed.checkError', 'Could not ask the terminal'));
    } finally {
      setBusy(false);
    }
  };

  const handleResolve = async () => {
    setBusy(true);
    try {
      await paymentApi.resolveTerminal(payment.id, {
        outcome,
        rrn: outcome === 'APPROVED' ? rrn.trim() : undefined,
        reason: reason.trim(),
      });
      setResolveOpen(false);
      toast.success(t('payments.unconfirmed.resolved', 'Payment settled'));
      onChanged();
    } catch (err: any) {
      showErrorToast(err, t('payments.unconfirmed.resolveError', 'Could not settle the payment'));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = reason.trim() && (outcome === 'NOT_CHARGED' || rrn.trim());

  return (
    <>
      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
        <Button size="small" color="warning" onClick={handleCheck} disabled={busy}>
          {t('payments.unconfirmed.check', 'Check terminal')}
        </Button>
        {canResolve && (
          <Button size="small" onClick={() => setResolveOpen(true)} disabled={busy}>
            {t('payments.unconfirmed.resolve', 'Resolve')}
          </Button>
        )}
      </Stack>

      <Dialog open={resolveOpen} onClose={() => setResolveOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>
          {t('payments.unconfirmed.resolveTitle', 'Settle unconfirmed card charge')} — {payment.payment_number}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning">
              {t(
                'payments.unconfirmed.resolveHelp',
                "Check the terminal's receipt or its transaction report first. Mark it charged only if the terminal shows this charge."
              )}
            </Alert>
            <FormControl fullWidth>
              <InputLabel>{t('payments.unconfirmed.outcome', 'What the terminal shows')}</InputLabel>
              <Select
                value={outcome}
                label={t('payments.unconfirmed.outcome', 'What the terminal shows')}
                onChange={(e) => setOutcome(e.target.value as 'APPROVED' | 'NOT_CHARGED')}
              >
                <MenuItem value="APPROVED">{t('payments.unconfirmed.approved', 'The card was charged')}</MenuItem>
                <MenuItem value="NOT_CHARGED">{t('payments.unconfirmed.notCharged', 'The card was not charged')}</MenuItem>
              </Select>
            </FormControl>
            {outcome === 'APPROVED' && (
              <TextField
                label={t('payments.unconfirmed.rrn', 'Reference number (RRN)')}
                value={rrn}
                onChange={(e) => setRrn(e.target.value)}
                slotProps={{ htmlInput: { dir: 'ltr', maxLength: 160 } }}
                required
                fullWidth
              />
            )}
            <TextField
              label={t('payments.unconfirmed.reason', 'How you checked')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 500 } }}
              required
              fullWidth
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResolveOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleResolve} disabled={busy || !canSubmit}>
            {t('payments.unconfirmed.confirm', 'Settle payment')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
