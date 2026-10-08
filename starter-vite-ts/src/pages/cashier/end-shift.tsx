import type {
  ShiftPolicy,
  ShiftStatement,
  ShiftCloseCheck,
  ShiftCountSignoff,
  ShiftSalesSummary,
} from 'src/api/shiftApi';

import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router';
import { useState, useEffect, useCallback } from 'react';

import LockIcon from '@mui/icons-material/Lock';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import {
  Box,
  Card,
  Grid,
  Alert,
  Stack,
  Button,
  Divider,
  TextField,
  IconButton,
  Typography,
  CircularProgress,
} from '@mui/material';

import { fDate } from 'src/utils/format-time';
import { MoneyUtil } from 'src/utils/money.util';
import { serverText } from 'src/utils/server-text';
import { useCurrencyLabel } from 'src/utils/currency';
import { amountText, amountFromText } from 'src/utils/amount-input';

import { shiftApi } from 'src/api/shiftApi';
import { paymentApi } from 'src/api/paymentApi';
import { useAuthStore } from 'src/store/useAuthStore';
import { isApproverRole } from 'src/config/role-access';

import { VersionTag } from 'src/components/version-tag';
import { ShiftReport } from 'src/components/shift/shift-summary';
import { OpenOrderLine } from 'src/components/shift/day-close-orders';

// ----------------------------------------------------------------------

const errorText = (err: any, fallback: string) => err?.detail || err?.response?.data?.message || err?.message || fallback;

const pinProps = { maxLength: 8, style: { textAlign: 'center' as const, letterSpacing: 6 } };

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
      {done ? (
        <CheckCircleIcon color="success" sx={{ mt: 0.25 }} />
      ) : (
        <RadioButtonUncheckedIcon color="disabled" sx={{ mt: 0.25 }} />
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ mb: children ? 1 : 0 }}>
          {n}. {title}
        </Typography>
        {children}
      </Box>
    </Stack>
  );
}

function Row({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
      <Typography variant={strong ? 'subtitle2' : 'body2'} color={strong ? 'text.primary' : 'text.secondary'}>
        {label}
      </Typography>
      <Typography variant={strong ? 'subtitle2' : 'body2'} sx={{ fontWeight: 700, color }} dir="ltr">
        {value}
      </Typography>
    </Stack>
  );
}

/**
 * Ending a shift, on one page: what the register did on the left, and on the right the steps
 * in the order they are done, each turning green. Toast's shift review works the same way. The
 * steps never move: the difference, the reason and the PIN a count may need appear under the
 * count, not on a new screen. While the shift runs the page is its report; after the close it
 * shows the result.
 *
 * The count is blind where the branch's policy says so: the expected cash shows once the
 * cashier has entered what they counted. What stays in the drawer for the next shift starts at
 * the policy's float (none, where the drawer is emptied at every close); the rest is handed over.
 */
export function EndShiftPage() {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();
  const navigate = useNavigate();
  const { shiftId = '' } = useParams();
  const approver = isApproverRole(useAuthStore((state) => state.user?.role));

  const [summary, setSummary] = useState<ShiftSalesSummary | null>(null);
  const [check, setCheck] = useState<ShiftCloseCheck | null>(null);
  const [policy, setPolicy] = useState<ShiftPolicy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [counted, setCounted] = useState('');
  const [left, setLeft] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [openOrdersPin, setOpenOrdersPin] = useState('');
  const [signoff, setSignoff] = useState<ShiftCountSignoff | null>(null);
  // A blind count already on record: counting again needs a manager's PIN (rials).
  const [recordedCount, setRecordedCount] = useState<string | null>(null);
  const [result, setResult] = useState<ShiftStatement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const s = await shiftApi.getSummary(shiftId);
      setSummary(s);
      if (!s.closed) {
        const [c, statement] = await Promise.all([shiftApi.getCloseCheck(shiftId), shiftApi.getShiftStatement(shiftId)]);
        setCheck(c);
        setPolicy(await shiftApi.getPolicy(statement.branchId).catch(() => null));
      }
    } catch (err: any) {
      setLoadError(errorText(err, t('shift.summary.loadError', 'Could not load the shift summary')));
    }
  }, [shiftId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const closed = !!result || !!summary?.closed;
  const openOrders = check?.openOrders ?? [];
  const carriedOrders = check?.carriedOrders ?? [];
  const pendingCash = check?.pendingCash ?? [];
  const ordersDone = openOrders.length === 0 || approver || !!openOrdersPin;
  const cashDone = !!check && pendingCash.length === 0;

  // What stays starts at the policy's float, never more than what was counted.
  const countedRials = counted || '0';
  const policyFloat = policy?.defaultOpeningFloat || '0';
  const leftRials = left ?? (MoneyUtil.greaterThan(policyFloat, countedRials) ? countedRials : policyFloat);
  const leftTooMuch = MoneyUtil.greaterThan(leftRials, countedRials);
  const handedOver = MoneyUtil.subtract(countedRials, leftRials);

  const countReady =
    counted !== '' &&
    !leftTooMuch &&
    (recordedCount === null || !!pin) &&
    (!signoff || ((!signoff.needsReason || !!reason.trim()) && (!signoff.needsApproval || !!pin)));
  const canClose = !!check && ordersDone && cashDone && countReady && !submitting;

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
      shiftApi.getCloseCheck(shiftId).then(setCheck).catch(() => undefined);
    }
  };

  const submit = async () => {
    if (!canClose) return;
    setSubmitting(true);
    setError(null);
    try {
      const statement = await shiftApi.closeShift(shiftId, {
        actualCash: countedRials,
        leftInDrawer: leftRials,
        reason: reason.trim() || undefined,
        pin: pin || undefined,
        openOrdersPin: openOrdersPin || undefined,
      });
      setResult(statement);
      const [s, c] = await Promise.all([shiftApi.getSummary(shiftId), shiftApi.getCloseCheck(shiftId).catch(() => null)]);
      setSummary(s);
      setCheck(c);
    } catch (err: any) {
      if (err.code === 'SHIFT_COUNT_NEEDS_SIGNOFF' && err.context) {
        // The count is on record; what it should have been, and what closing it needs, show here.
        setSignoff(err.context as ShiftCountSignoff);
      } else if (err.code === 'BLIND_COUNT_RECORDED') {
        setRecordedCount(String(err.context?.recordedCount ?? '0'));
      } else {
        setError(serverText(errorText(err, t('shift.close.error', 'Could not close the shift')), t));
        if (err.code === 'SHIFT_HAS_OPEN_ORDERS' || err.code === 'SHIFT_HAS_PENDING_CASH') {
          shiftApi.getCloseCheck(shiftId).then(setCheck).catch(() => undefined);
          setOpenOrdersPin('');
        }
      }
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  const varianceColor = (value?: string | null) =>
    !value || MoneyUtil.isZero(value) ? undefined : MoneyUtil.greaterThan(value, '0') ? 'info.main' : 'error.main';
  const money = (rials?: string | null) => `${MoneyUtil.formatCurrency(rials || '0')} ${currency}`;

  const lastTill = closed && !!check && check.otherOpenTills === 0 && !check.dayClosed;

  const renderSteps = () => (
    <Stack spacing={2.5} divider={<Divider flexItem />}>
      <Step n={1} title={t('shift.end.stepOrders', 'Open orders')} done={ordersDone}>
        {openOrders.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('shift.end.noOpenOrders', 'Nothing rung up at this till is left open.')}
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {approver
                ? t('shift.close.openOrdersManager', 'Settle them, or close anyway and leave them open for the next shift.')
                : t('shift.close.openOrdersHelp', 'Settle them, or a manager PIN leaves them open for the next shift.')}{' '}
              <VersionTag feature="shift.openOrdersPin" />
            </Typography>
            <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
              {openOrders.map((order) => (
                <OpenOrderLine key={order.id} order={order} />
              ))}
            </Box>
            <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center' }}>
              <Button size="small" startIcon={<RefreshIcon />} onClick={load}>
                {t('shift.close.recheck', 'Check again')}
              </Button>
              {!approver && (
                <TextField
                  size="small"
                  type="password"
                  label={t('shift.close.openOrdersPin', 'Manager PIN to leave them open')}
                  value={openOrdersPin}
                  onChange={(e) => setOpenOrdersPin(e.target.value)}
                  slotProps={{ htmlInput: pinProps }}
                  sx={{ flex: 1 }}
                />
              )}
            </Stack>
          </>
        )}
        {carriedOrders.length > 0 && (
          <Alert severity="info" sx={{ mt: 1 }}>
            {t('shift.close.carriedOrders', { count: carriedOrders.length })}
          </Alert>
        )}
      </Step>

      <Step n={2} title={t('shift.end.stepCash', 'Unfinished cash payments')} done={cashDone}>
        {pendingCash.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('shift.end.noPendingCash', 'Every cash payment was finished.')}
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              {t(
                'shift.close.pendingCashHelp',
                'Take the cash into this drawer or cancel the payment. Once the drawer is closed they can no longer go through.'
              )}
            </Typography>
            {pendingCash.map((payment) => (
              <Stack key={payment.id} direction="row" sx={{ alignItems: 'center', gap: 1, py: 0.5, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" dir="ltr">
                  {payment.orderNumber || payment.paymentNumber}
                </Typography>
                <Typography variant="body2" dir="ltr">
                  {MoneyUtil.formatCurrency(payment.amount)}
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" variant="contained" disabled={!!paymentBusy} onClick={() => settlePayment(payment.id, 'take')}>
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
          </>
        )}
      </Step>

      <Step n={3} title={t('shift.end.stepCount', 'Count the cash')} done={countReady}>
        <Stack spacing={1.5}>
          {summary?.blind && !signoff && (
            <Typography variant="body2" color="text.secondary">
              {t(
                'shift.close.blindHelp',
                'Count the cash in the drawer and enter the total. What it should hold is shown after you have counted.'
              )}{' '}
              <VersionTag feature="shift.blindCount" />
            </Typography>
          )}
          <TextField
            autoFocus
            label={t('shift.close.counted', 'Counted cash ({{currency}})', { currency })}
            value={amountText(counted)}
            placeholder="0"
            onChange={(e) => setCounted(amountFromText(e.target.value) || (e.target.value.trim() ? '0' : ''))}
            // Once the difference is known the count is on record; changing it is a recount.
            disabled={!!signoff}
            slotProps={{ htmlInput: { inputMode: 'numeric', dir: 'ltr', style: { textAlign: 'right' } } }}
          />
          {signoff && (
            <Box>
              <Stack spacing={0.75} sx={{ p: 1.5, borderRadius: 1.5, bgcolor: 'background.neutral' }}>
                <Row label={t('cashier.expectedCash', 'Expected Cash')} value={money(signoff.expectedCash)} />
                <Row label={t('shift.close.countedLabel', 'Counted')} value={money(signoff.actualCash)} />
                <Row
                  strong
                  label={t('shift.close.variance', 'Over / short')}
                  value={money(signoff.shortOver)}
                  color={varianceColor(signoff.shortOver)}
                />
              </Stack>
              <Button
                size="small"
                sx={{ mt: 0.5 }}
                onClick={() => {
                  setSignoff(null);
                  setReason('');
                  setPin('');
                }}
              >
                {t('shift.end.recount', 'Count again')}
              </Button>
            </Box>
          )}
          {recordedCount !== null && (
            <Alert severity="warning">
              {t('shift.close.recountNeedsPin', { amount: MoneyUtil.formatCurrency(recordedCount), currency })}
            </Alert>
          )}
          {signoff?.needsReason && (
            <TextField
              required
              multiline
              rows={2}
              label={t('shift.close.notes', 'Notes / reason for a difference')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              slotProps={{ input: { endAdornment: <VersionTag feature="shift.differenceSignoff" /> } }}
            />
          )}
          {(signoff?.needsApproval || recordedCount !== null) && (
            <TextField
              required
              type="password"
              label={t('approval.pinLabel', 'Manager PIN')}
              helperText={
                signoff?.needsApproval
                  ? t('shift.end.overTolerance', 'Out by more than {{tolerance}}: a manager signs it off.', {
                      tolerance: money(signoff.varianceTolerance),
                    })
                  : undefined
              }
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              slotProps={{ htmlInput: pinProps }}
            />
          )}
          {counted !== '' && (
            <Stack spacing={0.75}>
              <TextField
                size="small"
                label={t('shift.end.leaveInDrawer', 'Leave in the drawer for the next shift ({{currency}})', { currency })}
                value={amountText(leftRials)}
                placeholder="0"
                error={leftTooMuch}
                helperText={leftTooMuch ? t('shift.end.leftTooMuch', 'More than was counted.') : undefined}
                onChange={(e) => setLeft(amountFromText(e.target.value) || '0')}
                slotProps={{ htmlInput: { inputMode: 'numeric', dir: 'ltr', style: { textAlign: 'right' } } }}
              />
              {!leftTooMuch && <Row label={t('shift.end.handOver', 'To hand over')} value={money(handedOver)} />}
            </Stack>
          )}
        </Stack>
      </Step>

      <Box>
        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {error}
          </Alert>
        )}
        <Button
          fullWidth
          size="large"
          variant="contained"
          color="error"
          startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : <LockIcon />}
          disabled={!canClose}
          onClick={submit}
        >
          {t('shift.close.title', 'Close shift')}
        </Button>
      </Box>
    </Stack>
  );

  const renderResult = () => {
    const shortOver = result?.shortOver ?? summary?.cash.shortOver ?? '0';
    const handed = result?.handedOver ?? summary?.cash.handedOver;
    const kept = result?.leftInDrawer ?? summary?.cash.leftInDrawer;
    return (
      <Stack spacing={2}>
        <Alert severity={MoneyUtil.isZero(shortOver || '0') ? 'success' : 'warning'}>
          {MoneyUtil.isZero(shortOver || '0')
            ? t('shift.close.balanced', 'Shift closed. The drawer balanced.')
            : t('shift.close.closedWithDifference', 'Shift closed with a difference.')}
        </Alert>
        {handed !== null && handed !== undefined && (
          <Stack spacing={0.75}>
            <Row strong label={t('shift.end.handedOver', 'Handed over')} value={money(handed)} />
            <Row label={t('shift.end.leftInDrawer', 'Left in the drawer')} value={money(kept)} />
          </Stack>
        )}
        {lastTill && (
          <Alert severity="info">
            {approver
              ? t('shift.close.lastTillManager', 'This was the last drawer open at the branch. You can close the business day now:')
              : t('shift.close.lastTillCashier', 'This was the last drawer open at the branch. A manager can now close the business day:')}{' '}
            {check && <span dir="ltr">{fDate(check.businessDate)}</span>}
          </Alert>
        )}
        <Stack direction="row" spacing={1}>
          <Button variant="contained" onClick={() => navigate('/app/pos')}>
            {t('shift.end.backToRegister', 'Back to the register')}
          </Button>
          {lastTill && approver && (
            <Button variant="outlined" onClick={() => navigate('/app/cashier/business-days')}>
              {t('shift.close.reviewDay', 'Close the day')}
            </Button>
          )}
        </Stack>
      </Stack>
    );
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
        <IconButton onClick={() => navigate(-1)} aria-label={t('common.back', 'Back')}>
          <ArrowBackIcon sx={{ transform: (theme) => (theme.direction === 'rtl' ? 'scaleX(-1)' : undefined) }} />
        </IconButton>
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
          {closed ? t('shift.end.reportTitle', 'Shift report') : t('shift.end.title', 'End shift')}
        </Typography>
        <IconButton onClick={load} title={t('common.refresh', 'Refresh')}>
          <RefreshIcon />
        </IconButton>
      </Stack>

      {loadError && <Alert severity="error">{loadError}</Alert>}
      {!loadError && !summary && (
        <Stack sx={{ alignItems: 'center', py: 6 }}>
          <CircularProgress />
        </Stack>
      )}

      {summary && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 7 }}>
            <Card sx={{ p: 3, borderRadius: 2 }}>
              <ShiftReport summary={summary} />
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <Card sx={{ p: 3, borderRadius: 2, position: { md: 'sticky' }, top: { md: 88 } }}>
              {closed ? renderResult() : check ? renderSteps() : <CircularProgress />}
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
}
