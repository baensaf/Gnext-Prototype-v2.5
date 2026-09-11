import type { ShiftStatement, ShiftCountSignoff } from 'src/api/shiftApi';

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

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  shiftId: string;
  shiftNumber?: string;
  /** Called once the closer has seen the result and dismissed it. */
  onClosed: () => void;
};

type Step = 'count' | 'signoff' | 'done';

function Row({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
      <Typography variant={strong ? 'subtitle2' : 'body2'} color={strong ? 'text.primary' : 'text.secondary'}>
        {label}
      </Typography>
      <Typography variant={strong ? 'subtitle2' : 'body2'} sx={{ fontWeight: 'bold', color }} dir="ltr">
        {value}
      </Typography>
    </Stack>
  );
}

/**
 * Counting a drawer down at the end of a shift — one register's shift. The branch's day is
 * closed separately, on Business Days, once every drawer is counted.
 *
 * The count is blind: the closer types what is in the drawer before learning what should be
 * there. If it does not balance, the server says by how much, and the count is then locked —
 * any difference needs a reason, and one beyond the branch's tolerance a manager's pin.
 */
export function CloseShiftDialog({ open, onClose, shiftId, shiftNumber, onClosed }: Props) {
  const { t } = useTranslation();
  const [statement, setStatement] = useState<ShiftStatement | null>(null);
  const [step, setStep] = useState<Step>('count');
  const [actualCash, setActualCash] = useState('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [signoff, setSignoff] = useState<ShiftCountSignoff | null>(null);
  const [result, setResult] = useState<ShiftStatement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('count');
    setActualCash('');
    setReason('');
    setPin('');
    setSignoff(null);
    setResult(null);
    setError(null);
    setStatement(null);
    shiftApi
      .getShiftStatement(shiftId)
      .then(setStatement)
      .catch((err: any) => setError(err.detail || err.message));
  }, [open, shiftId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const closed = await shiftApi.closeShift(shiftId, {
        actualCash: actualCash || '0',
        reason: reason.trim() || undefined,
        pin: pin || undefined,
      });
      setResult(closed);
      setStep('done');
    } catch (err: any) {
      if (err.code === 'SHIFT_COUNT_NEEDS_SIGNOFF' && err.context) {
        setSignoff(err.context as ShiftCountSignoff);
        setStep('signoff');
      } else {
        setError(err.detail || err.message || t('shift.close.error', 'Could not close the shift'));
      }
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  const finish = () => {
    onClosed();
    onClose();
  };

  const varianceColor = (value?: string | null) =>
    !value || MoneyUtil.isZero(value) ? undefined : MoneyUtil.greaterThan(value, '0') ? 'info.main' : 'error.main';

  const blind = !statement || statement.blind || statement.expectedCash === null;
  const canSubmit =
    step === 'count'
      ? actualCash !== ''
      : !!signoff && (!signoff.needsReason || !!reason.trim()) && (!signoff.needsApproval || !!pin);

  return (
    <Dialog open={open} onClose={step === 'done' ? finish : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold' }}>
        {t('shift.close.title', 'Close shift')} {shiftNumber && <span dir="ltr">#{shiftNumber}</span>}
      </DialogTitle>

      {step === 'done' && result ? (
        <>
          <DialogContent>
            <Stack spacing={2}>
              <Alert severity={MoneyUtil.isZero(result.shortOver || '0') ? 'success' : 'warning'}>
                {MoneyUtil.isZero(result.shortOver || '0')
                  ? t('shift.close.balanced', 'Shift closed. The drawer balanced.')
                  : t('shift.close.closedWithDifference', 'Shift closed with a difference.')}
              </Alert>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Stack spacing={1}>
                  <Row label={t('cashier.openingFloat', 'Opening Float')} value={MoneyUtil.formatCurrency(result.openingFloat)} />
                  <Row label={t('shift.close.cashSales', 'Cash sales')} value={MoneyUtil.formatCurrency(result.cashSales)} />
                  <Row label={t('shift.close.cashRefunds', 'Cash refunds')} value={MoneyUtil.formatCurrency(result.cashRefunds)} />
                  <Row label={t('shift.close.paidInOut', 'Paid in / out')} value={`${MoneyUtil.formatCurrency(result.paidIn)} / ${MoneyUtil.formatCurrency(result.paidOut)}`} />
                  <Divider />
                  <Row label={t('cashier.expectedCash', 'Expected Cash')} value={MoneyUtil.formatCurrency(result.expectedCash)} />
                  <Row label={t('shift.close.countedLabel', 'Counted')} value={MoneyUtil.formatCurrency(result.actualCash)} />
                  <Row
                    strong
                    label={t('shift.close.variance', 'Over / short')}
                    value={MoneyUtil.formatCurrency(result.shortOver || '0')}
                    color={varianceColor(result.shortOver)}
                  />
                </Stack>
              </Paper>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={finish}>
              {t('shift.close.done', 'Done')}
            </Button>
          </DialogActions>
        </>
      ) : (
        <Box component="form" onSubmit={submit}>
          <DialogContent>
            {!statement && !error ? (
              <Stack sx={{ alignItems: 'center', py: 3 }}>
                <CircularProgress size={28} />
              </Stack>
            ) : (
              <Stack spacing={2}>
                {error && <Alert severity="error">{error}</Alert>}

                {step === 'count' &&
                  (blind ? (
                    <Alert severity="info">
                      {t(
                        'shift.close.blindHelp',
                        'Count the cash in the drawer and enter the total. What it should hold is shown after you have counted.'
                      )}
                    </Alert>
                  ) : (
                    statement && (
                      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                        <Row label={t('cashier.expectedCash', 'Expected Cash')} value={MoneyUtil.formatCurrency(statement.expectedCash)} />
                      </Paper>
                    )
                  ))}

                {step === 'signoff' && signoff && (
                  <>
                    <Alert severity={signoff.needsApproval ? 'error' : 'warning'}>
                      {signoff.needsApproval
                        ? t('shift.close.needsApproval', 'The drawer is out by more than {{tolerance}}. A reason and a manager PIN are needed to close.', {
                            tolerance: MoneyUtil.formatCurrency(signoff.varianceTolerance),
                          })
                        : t('shift.close.needsReason', 'The drawer does not balance. Give a reason to close.')}
                    </Alert>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                      <Stack spacing={1}>
                        <Row label={t('cashier.expectedCash', 'Expected Cash')} value={MoneyUtil.formatCurrency(signoff.expectedCash)} />
                        <Row label={t('shift.close.countedLabel', 'Counted')} value={MoneyUtil.formatCurrency(signoff.actualCash)} />
                        <Divider />
                        <Row
                          strong
                          label={t('shift.close.variance', 'Over / short')}
                          value={MoneyUtil.formatCurrency(signoff.shortOver)}
                          color={varianceColor(signoff.shortOver)}
                        />
                      </Stack>
                    </Paper>
                  </>
                )}

                <TextField
                  label={t('shift.close.counted', 'Counted cash (IRR)')}
                  type="number"
                  required
                  fullWidth
                  autoFocus={step === 'count'}
                  value={actualCash}
                  onChange={(e) => setActualCash(e.target.value)}
                  // Locked once the difference is known: a recount starts the close again.
                  disabled={step === 'signoff'}
                  slotProps={{ htmlInput: { min: 0, dir: 'ltr' } }}
                />

                {(step === 'signoff' ? signoff?.needsReason : true) && (
                  <TextField
                    label={t('shift.close.notes', 'Notes / reason for a difference')}
                    fullWidth
                    multiline
                    rows={2}
                    required={step === 'signoff'}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                )}

                {step === 'signoff' && signoff?.needsApproval && (
                  <TextField
                    label={t('approval.pinLabel', 'Manager PIN')}
                    type="password"
                    required
                    fullWidth
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    slotProps={{ htmlInput: { maxLength: 8, style: { textAlign: 'center', letterSpacing: 6 } } }}
                  />
                )}
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
              disabled={submitting || !statement || !canSubmit}
            >
              {step === 'count' ? t('shift.close.submitCount', 'Submit count') : t('shift.close.confirm', 'Close shift')}
            </Button>
          </DialogActions>
        </Box>
      )}
    </Dialog>
  );
}
