import type {
  ShiftPolicy,
  CashMovement,
  ShiftStatement,
  ShiftCloseCheck,
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

import { MoneyUtil } from 'src/utils/money.util';
import { serverText } from 'src/utils/server-text';
import { useCurrencyLabel } from 'src/utils/currency';
import { readDeviceTerminal } from 'src/utils/device-terminal';
import { amountText, amountFromText } from 'src/utils/amount-input';

import { shiftApi } from 'src/api/shiftApi';
import { paymentApi } from 'src/api/paymentApi';

import { ShiftReport } from 'src/components/shift/shift-summary';
import { CashMovements } from 'src/components/shift/cash-movements';
import { OpenOrderLine } from 'src/components/shift/open-order-line';

import { readHeldCarts, clearHeldCarts } from '../pos/held-carts';

// ----------------------------------------------------------------------

const errorText = (err: any, fallback: string) => err?.detail || err?.response?.data?.message || err?.message || fallback;

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
 * A shift's one page: what the register did and every cash movement on the left, and on the
 * right the steps to end it, in the order they are done, each turning green. Toast's shift
 * review works the same way. While the shift runs the page is its report; after the close it is
 * the shift's statement, read-only.
 *
 * The cashier counts the cash and closes: the report already shows what the drawer should hold,
 * and the difference is stored as a number, with no reason and no manager. Orders the till left
 * open are listed as a notice and do not stop the close. What stays in the drawer for the next
 * shift starts at the policy's float (none, where the drawer is emptied at every close); the
 * rest is handed over.
 */
export function EndShiftPage() {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();
  const navigate = useNavigate();
  const { shiftId = '' } = useParams();

  const [summary, setSummary] = useState<ShiftSalesSummary | null>(null);
  const [check, setCheck] = useState<ShiftCloseCheck | null>(null);
  const [policy, setPolicy] = useState<ShiftPolicy | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [counted, setCounted] = useState('');
  const [left, setLeft] = useState<string | null>(null);
  const [result, setResult] = useState<ShiftStatement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [s, statement] = await Promise.all([shiftApi.getSummary(shiftId), shiftApi.getShiftStatement(shiftId)]);
      setSummary(s);
      setMovements(statement.movements);
      if (!s.closed) {
        setCheck(await shiftApi.getCloseCheck(shiftId));
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
  // Carts on hold at this register for this shift; they go when it closes.
  const terminal = readDeviceTerminal();
  const heldCount = terminal && !closed ? readHeldCarts(terminal.id, shiftId).length : 0;
  const openOrders = check?.openOrders ?? [];
  const pendingCash = check?.pendingCash ?? [];
  const cashDone = !!check && pendingCash.length === 0;

  // What stays starts at the policy's float, never more than what was counted.
  const countedRials = counted || '0';
  const policyFloat = policy?.defaultOpeningFloat || '0';
  const leftRials = left ?? (MoneyUtil.greaterThan(policyFloat, countedRials) ? countedRials : policyFloat);
  const leftTooMuch = MoneyUtil.greaterThan(leftRials, countedRials);
  const handedOver = MoneyUtil.subtract(countedRials, leftRials);

  const countReady = counted !== '' && !leftTooMuch;
  const canClose = !!check && cashDone && countReady && !submitting;

  // The difference the count will leave, from what the report says the drawer should hold.
  const expectedRials = summary?.cash.expectedCash ?? '0';
  const difference = counted === '' ? null : MoneyUtil.subtract(countedRials, expectedRials);

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
      });
      if (terminal) clearHeldCarts(terminal.id);
      setResult(statement);
      setMovements(statement.movements);
      setSummary(await shiftApi.getSummary(shiftId));
    } catch (err: any) {
      setError(serverText(errorText(err, t('shift.close.error', 'Could not close the shift')), t));
      if (err.code === 'SHIFT_HAS_PENDING_CASH') {
        shiftApi.getCloseCheck(shiftId).then(setCheck).catch(() => undefined);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const varianceColor = (value?: string | null) =>
    !value || MoneyUtil.isZero(value) ? undefined : MoneyUtil.greaterThan(value, '0') ? 'info.main' : 'error.main';
  const money = (rials?: string | null) => `${MoneyUtil.formatCurrency(rials || '0')} ${currency}`;

  const renderSteps = () => (
    <Stack spacing={2.5} divider={<Divider flexItem />}>
      <Step n={1} title={t('shift.end.stepOrders', 'Open orders')} done>
        {heldCount > 0 && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {t('shift.end.heldCarts', { count: heldCount })}
          </Alert>
        )}
        {openOrders.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('shift.end.noOpenOrders', 'Nothing rung up at this till is left open.')}
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('shift.close.openOrdersManager', 'Settle them, or close anyway and leave them open for the next shift.')}
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
            </Stack>
          </>
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
          <TextField
            autoFocus
            label={t('shift.close.counted', 'Counted cash ({{currency}})', { currency })}
            value={amountText(counted)}
            placeholder="0"
            onChange={(e) => setCounted(amountFromText(e.target.value) || (e.target.value.trim() ? '0' : ''))}
            slotProps={{ htmlInput: { inputMode: 'numeric', dir: 'ltr', style: { textAlign: 'right' } } }}
          />
          {difference !== null && (
            <Stack spacing={0.75} sx={{ p: 1.5, borderRadius: 1.5, bgcolor: 'background.neutral' }}>
              <Row label={t('cashier.expectedCash', 'Expected Cash')} value={money(expectedRials)} />
              <Row label={t('shift.close.countedLabel', 'Counted')} value={money(countedRials)} />
              <Row
                strong
                label={t('shift.close.variance', 'Over / short')}
                value={money(difference)}
                color={varianceColor(difference)}
              />
            </Stack>
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
        {result && (
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={() => navigate('/app/pos')}>
              {t('shift.end.backToRegister', 'Back to the register')}
            </Button>
          </Stack>
        )}
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
            <Stack spacing={3}>
              <Card sx={{ p: 3, borderRadius: 2 }}>
                <ShiftReport summary={summary} />
              </Card>
              <CashMovements movements={movements} />
            </Stack>
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
