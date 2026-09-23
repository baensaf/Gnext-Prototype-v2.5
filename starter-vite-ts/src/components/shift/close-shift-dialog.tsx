import type { ShiftStatement, ShiftCloseCheck, ShiftCountSignoff, DayCloseOpenOrders } from 'src/api/shiftApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import LockIcon from '@mui/icons-material/Lock';
import RefreshIcon from '@mui/icons-material/Refresh';
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

import { fDate } from 'src/utils/format-time';
import { MoneyUtil } from 'src/utils/money.util';

import { shiftApi } from 'src/api/shiftApi';
import { paymentApi } from 'src/api/paymentApi';
import { useAuthStore } from 'src/store/useAuthStore';
import { isApproverRole } from 'src/config/role-access';

import { OpenOrderLine, DayCloseOrders } from './day-close-orders';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  shiftId: string;
  shiftNumber?: string;
  /** Called once the closer has seen the result and dismissed it. */
  onClosed: () => void;
};

type Step = 'count' | 'signoff' | 'done' | 'day';

const errorText = (err: any, fallback: string) => err?.detail || err?.response?.data?.message || err?.message || fallback;

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
 * Counting a drawer down at the end of a shift — one register's shift.
 *
 * Before the count it says what the till leaves behind. A cash payment begun at this drawer
 * and never finished has to be taken or cancelled first: once the drawer closes it could never
 * go through. Held, unpaid or unaccepted orders this till rang up may stay open for the next
 * shift, but only on a manager's PIN.
 *
 * The count is blind: the closer types what is in the drawer before learning what should be
 * there. If it does not balance, the server says by how much, and the count is then locked —
 * any difference needs a reason, and one beyond the branch's tolerance a manager's pin.
 *
 * Closing the last drawer open at the branch offers a manager the day close straight after.
 */
export function CloseShiftDialog({ open, onClose, shiftId, shiftNumber, onClosed }: Props) {
  const { t } = useTranslation();
  const approver = isApproverRole(useAuthStore((state) => state.user?.role));

  const [statement, setStatement] = useState<ShiftStatement | null>(null);
  const [check, setCheck] = useState<ShiftCloseCheck | null>(null);
  const [step, setStep] = useState<Step>('count');
  const [actualCash, setActualCash] = useState('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [openOrdersPin, setOpenOrdersPin] = useState('');
  const [signoff, setSignoff] = useState<ShiftCountSignoff | null>(null);
  const [result, setResult] = useState<ShiftStatement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // What the branch's day would do once this was the last drawer open.
  const [afterClose, setAfterClose] = useState<ShiftCloseCheck | null>(null);
  const [dayOrders, setDayOrders] = useState<DayCloseOpenOrders | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [carryOver, setCarryOver] = useState(false);
  const [carryOverReason, setCarryOverReason] = useState('');
  const [dayClosed, setDayClosed] = useState(false);

  const loadCheck = useCallback(async () => {
    try {
      setCheck(await shiftApi.getCloseCheck(shiftId));
    } catch (err: any) {
      setError(errorText(err, t('shift.close.checkFailed', 'Could not check what this till leaves open')));
    }
  }, [shiftId, t]);

  useEffect(() => {
    if (!open) return;
    setStep('count');
    setActualCash('');
    setReason('');
    setPin('');
    setOpenOrdersPin('');
    setSignoff(null);
    setResult(null);
    setError(null);
    setStatement(null);
    setCheck(null);
    setAfterClose(null);
    setDayOrders(null);
    setCarryOver(false);
    setCarryOverReason('');
    setDayClosed(false);
    shiftApi
      .getShiftStatement(shiftId)
      .then(setStatement)
      .catch((err: any) => setError(err.detail || err.message));
    loadCheck();
  }, [open, shiftId, loadCheck]);

  const pendingCash = check?.pendingCash ?? [];
  const openOrders = check?.openOrders ?? [];

  const settlePayment = async (paymentId: string, action: 'take' | 'cancel') => {
    setPaymentBusy(paymentId);
    setError(null);
    try {
      if (action === 'take') await paymentApi.processPayment(paymentId);
      else await paymentApi.voidPayment(paymentId);
    } catch (err: any) {
      setError(errorText(err, t('shift.close.paymentFailed', 'Could not settle the payment')));
    } finally {
      setPaymentBusy(null);
      loadCheck();
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const closed = await shiftApi.closeShift(shiftId, {
        actualCash: actualCash || '0',
        reason: reason.trim() || undefined,
        pin: pin || undefined,
        openOrdersPin: openOrdersPin || undefined,
      });
      setResult(closed);
      setStep('done');
      shiftApi
        .getCloseCheck(shiftId)
        .then(setAfterClose)
        .catch(() => setAfterClose(null));
    } catch (err: any) {
      if (err.code === 'SHIFT_COUNT_NEEDS_SIGNOFF' && err.context) {
        setSignoff(err.context as ShiftCountSignoff);
        setStep('signoff');
      } else {
        setError(errorText(err, t('shift.close.error', 'Could not close the shift')));
        // An order may have been rung up, or a payment begun, since the list was read.
        if (err.code === 'SHIFT_HAS_OPEN_ORDERS' || err.code === 'SHIFT_HAS_PENDING_CASH') loadCheck();
        if (step === 'count') setOpenOrdersPin('');
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

  const lastTill = !!afterClose && afterClose.otherOpenTills === 0 && !afterClose.dayClosed;

  // Read again after a refused close, which keeps its error on screen.
  const reviewDay = async () => {
    if (!afterClose) return;
    setStep('day');
    setDayLoading(true);
    try {
      setDayOrders(
        await shiftApi.getDayCloseOpenOrders({
          branchId: afterClose.branchId,
          businessDate: afterClose.businessDate,
          currencyCode: afterClose.currencyCode,
        })
      );
    } catch (err: any) {
      setError(errorText(err, t('cashier.openOrders.loadFailed', 'Could not check the open orders')));
    } finally {
      setDayLoading(false);
    }
  };

  const needsDecision = dayOrders?.needsDecision ?? [];
  const canCloseDay =
    !dayLoading && !!dayOrders && (needsDecision.length === 0 || (carryOver && carryOverReason.trim().length > 0));

  const closeDay = async () => {
    if (!afterClose) return;
    setSubmitting(true);
    setError(null);
    try {
      await shiftApi.closeBusinessDay({
        branchId: afterClose.branchId,
        businessDate: afterClose.businessDate,
        currencyCode: afterClose.currencyCode,
        ...(needsDecision.length > 0 ? { carryOverReason: carryOverReason.trim() } : {}),
      });
      setDayClosed(true);
    } catch (err: any) {
      setError(errorText(err, t('shift.close.dayFailed', 'Could not close the business day')));
      reviewDay();
    } finally {
      setSubmitting(false);
    }
  };

  const varianceColor = (value?: string | null) =>
    !value || MoneyUtil.isZero(value) ? undefined : MoneyUtil.greaterThan(value, '0') ? 'info.main' : 'error.main';

  const blind = !statement || statement.blind || statement.expectedCash === null;
  const leftBehindSettled =
    !!check && pendingCash.length === 0 && (openOrders.length === 0 || approver || !!openOrdersPin);
  const canSubmit =
    step === 'count'
      ? actualCash !== '' && leftBehindSettled
      : !!signoff && (!signoff.needsReason || !!reason.trim()) && (!signoff.needsApproval || !!pin);

  const dayDate = afterClose ? <span dir="ltr">{fDate(afterClose.businessDate)}</span> : null;

  return (
    <Dialog open={open} onClose={step === 'done' || step === 'day' ? finish : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold' }}>
        {step === 'day'
          ? t('cashier.closeBusinessDayTitle', 'Close Business Day (EOD)')
          : t('shift.close.title', 'Close shift')}{' '}
        {step !== 'day' && shiftNumber && <span dir="ltr">#{shiftNumber}</span>}
      </DialogTitle>

      {step === 'day' ? (
        <>
          <DialogContent>
            <Stack spacing={2}>
              {dayClosed ? (
                <Alert severity="success">
                  {t('shift.close.dayClosedDone', 'Business day closed.')} {dayDate}
                </Alert>
              ) : (
                <>
                  <Typography variant="body2" color="text.secondary">
                    {t('shift.close.dayHelp', 'Every drawer at the branch is counted. Closing the day fixes its sales for')}{' '}
                    {dayDate}
                  </Typography>
                  <DayCloseOrders
                    openOrders={dayOrders}
                    loading={dayLoading}
                    carryOver={carryOver}
                    onCarryOverChange={setCarryOver}
                    carryOverReason={carryOverReason}
                    onCarryOverReasonChange={setCarryOverReason}
                  />
                </>
              )}
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            {dayClosed ? (
              <Button variant="contained" onClick={finish}>
                {t('shift.close.done', 'Done')}
              </Button>
            ) : (
              <>
                <Button onClick={finish} disabled={submitting}>
                  {t('shift.close.skipDay', 'Not now')}
                </Button>
                <Button
                  variant="contained"
                  startIcon={<LockIcon />}
                  disabled={submitting || !canCloseDay}
                  onClick={closeDay}
                >
                  {needsDecision.length > 0
                    ? t('cashier.openOrders.closeAndCarryOver', 'Close day and carry over')
                    : t('cashier.confirmClose', 'Confirm Close')}
                </Button>
              </>
            )}
          </DialogActions>
        </>
      ) : step === 'done' && result ? (
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
                  {/* Without the drops the lines above did not add up to the expected cash. */}
                  <Row label={t('shift.movement.safeDrop', 'Safe drop')} value={MoneyUtil.formatCurrency(result.safeDrops || '0')} />
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
              {lastTill && (
                <Alert severity="info">
                  {approver
                    ? t('shift.close.lastTillManager', 'This was the last drawer open at the branch. You can close the business day now:')
                    : t('shift.close.lastTillCashier', 'This was the last drawer open at the branch. A manager can now close the business day:')}{' '}
                  {dayDate}
                </Alert>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            {lastTill && approver && (
              <Button
                onClick={() => {
                  setError(null);
                  reviewDay();
                }}
              >
                {t('shift.close.reviewDay', 'Close the day')}
              </Button>
            )}
            <Button variant="contained" onClick={finish}>
              {t('shift.close.done', 'Done')}
            </Button>
          </DialogActions>
        </>
      ) : (
        <Box component="form" onSubmit={submit}>
          <DialogContent>
            {(!statement || !check) && !error ? (
              <Stack sx={{ alignItems: 'center', py: 3 }}>
                <CircularProgress size={28} />
              </Stack>
            ) : (
              <Stack spacing={2}>
                {error && <Alert severity="error">{error}</Alert>}

                {step === 'count' && pendingCash.length > 0 && (
                  <Box>
                    <Alert severity="error" sx={{ mb: 1 }}>
                      <Typography variant="subtitle2">
                        {t('shift.close.pendingCash', '{{count}} cash payment(s) were started and never finished', {
                          count: pendingCash.length,
                        })}
                      </Typography>
                      <Typography variant="body2">
                        {t(
                          'shift.close.pendingCashHelp',
                          'Take the cash into this drawer or cancel the payment. Once the drawer is closed they can no longer go through.'
                        )}
                      </Typography>
                    </Alert>
                    {pendingCash.map((payment) => (
                      <Stack key={payment.id} direction="row" sx={{ alignItems: 'center', gap: 1, py: 0.5, flexWrap: 'wrap' }}>
                        <Typography variant="subtitle2" dir="ltr">
                          {payment.orderNumber || payment.paymentNumber}
                        </Typography>
                        <Typography variant="body2" dir="ltr">
                          {MoneyUtil.formatCurrency(payment.amount)}
                        </Typography>
                        <Box sx={{ flexGrow: 1 }} />
                        <Button
                          size="small"
                          variant="contained"
                          disabled={!!paymentBusy}
                          onClick={() => settlePayment(payment.id, 'take')}
                        >
                          {t('shift.close.takeCash', 'Take cash')}
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          disabled={!!paymentBusy || payment.status !== 'PENDING'}
                          onClick={() => settlePayment(payment.id, 'cancel')}
                        >
                          {t('shift.close.cancelPayment', 'Cancel payment')}
                        </Button>
                      </Stack>
                    ))}
                  </Box>
                )}

                {step === 'count' && openOrders.length > 0 && (
                  <Box>
                    <Alert
                      severity="warning"
                      sx={{ mb: 1 }}
                      action={
                        <Button color="inherit" size="small" startIcon={<RefreshIcon />} onClick={loadCheck}>
                          {t('shift.close.recheck', 'Check again')}
                        </Button>
                      }
                    >
                      <Typography variant="subtitle2">
                        {t('shift.close.openOrders', '{{count}} order(s) from this till are still open', {
                          count: openOrders.length,
                        })}
                      </Typography>
                      <Typography variant="body2">
                        {approver
                          ? t(
                              'shift.close.openOrdersManager',
                              'Settle them, or close anyway and leave them open for the next shift.'
                            )
                          : t(
                              'shift.close.openOrdersHelp',
                              'Settle them, or a manager PIN leaves them open for the next shift.'
                            )}
                      </Typography>
                    </Alert>
                    <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                      {openOrders.map((order) => (
                        <OpenOrderLine key={order.id} order={order} />
                      ))}
                    </Box>
                    {!approver && (
                      <TextField
                        label={t('shift.close.openOrdersPin', 'Manager PIN to leave them open')}
                        type="password"
                        fullWidth
                        sx={{ mt: 1 }}
                        value={openOrdersPin}
                        onChange={(e) => setOpenOrdersPin(e.target.value)}
                        slotProps={{ htmlInput: { maxLength: 8, style: { textAlign: 'center', letterSpacing: 6 } } }}
                      />
                    )}
                  </Box>
                )}

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
