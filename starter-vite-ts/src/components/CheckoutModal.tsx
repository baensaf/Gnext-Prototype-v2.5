import type { Payment } from 'src/api/paymentApi';
import type { OrderHeader } from 'src/api/orderApi';
import type { PaymentMethod } from 'src/api/settingsApi';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useRef, useState, useEffect, useCallback } from 'react';

import PrintIcon from '@mui/icons-material/Print';
import LoyaltyIcon from '@mui/icons-material/Loyalty';
import PaymentIcon from '@mui/icons-material/Payment';
import PaymentsIcon from '@mui/icons-material/Payments';
import BackspaceIcon from '@mui/icons-material/Backspace';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import {
  Box,
  Chip,
  Grid,
  Menu,
  Stack,
  Alert,
  Paper,
  Dialog,
  Button,
  Divider,
  MenuItem,
  TextField,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { toToman, fromToman, useCurrencyLabel } from 'src/utils/currency';

import { kdsApi } from 'src/api/kdsApi';
import { orderApi } from 'src/api/orderApi';
import { paymentApi } from 'src/api/paymentApi';
import { settingsApi } from 'src/api/settingsApi';
import { customerApi } from 'src/api/customerApi';

import { VersionTag } from 'src/components/version-tag';
import { toast, showErrorToast } from 'src/components/snackbar';
import { UnconfirmedChargeActions } from 'src/components/payment-terminal/unconfirmed-charge-actions';

/** The API sends "42292000.0000"; the keypad works on whole rials. */
const wholeRials = (amount?: string | null) => String(amount || '0').replace(/\.0*$/, '');

/** The counter's card terminal. Falling back to any other method recorded card sales wrongly. */
const CARD_KINDS = ['CARD_POS', 'CARD', 'POS', 'NETWORK_POS'];
/** A courier's reader is settled with the courier, never taken at the counter. */
const COURIER_KINDS = ['MOBILE_POS', 'MOBILE'];

/** How long the settled order stays on screen before the panel closes itself. */
const CLOSE_AFTER_MS = 2500;

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0'];

/** A payment that needs a reference, or one taken on another reader, before it is recorded. */
type ReferencePrompt = {
  method: PaymentMethod;
  offTerminal: boolean;
  /** Rials. */
  amount: string;
  /** The failed charge this one replaces. */
  replaces?: string;
};

interface CheckoutModalProps {
  open: boolean;
  orderId: string | null;
  onClose: () => void;
  onPaymentComplete?: () => void;
}

export function CheckoutModal({ open, orderId, onClose, onPaymentComplete }: CheckoutModalProps) {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderHeader | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  // The amount on the keypad, in tomans as typed. `fresh` is the remainder put there for the
  // cashier: the first digit typed replaces it rather than adding to it.
  const [entry, setEntry] = useState({ value: '', fresh: true });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // The method being taken right now; the card terminal can hold this for minutes.
  const [payingId, setPayingId] = useState<string | null>(null);
  const [otherAnchor, setOtherAnchor] = useState<HTMLElement | null>(null);
  const [prompt, setPrompt] = useState<ReferencePrompt | null>(null);
  const [reference, setReference] = useState('');
  // Cash handed over beyond what is due: the drawer keeps only the due amount, and the
  // cashier gives this back.
  const [changeDue, setChangeDue] = useState<string | null>(null);
  // What the order's customer holds as club credit, in rials. Below zero is money owed, not credit.
  const [clubCredit, setClubCredit] = useState('0');

  const offerRemainder = (o: OrderHeader | null) =>
    setEntry({ value: toToman(wholeRials(o?.due_amount || o?.outstanding_total)), fresh: true });

  const loadClubCredit = useCallback(async (customerId?: string) => {
    const customer = customerId ? await customerApi.getCustomer(customerId).catch(() => null) : null;
    setClubCredit(wholeRials(customer?.wallet_balance));
  }, []);

  const loadData = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const o = await orderApi.getOrderById(orderId);
      setOrder(o);
      offerRemainder(o);

      const pms = await settingsApi.getPaymentMethods();
      setPaymentMethods(pms.filter((m) => m.is_active));

      setPayments(await paymentApi.getOrderPayments(orderId));
      await loadClubCredit(o.customer_id);
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('pos.pay.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [orderId, t, loadClubCredit]);

  useEffect(() => {
    if (open && orderId) {
      loadData();
    }
  }, [open, orderId, loadData]);

  // The change shown is the last cash payment's on this order; the next order starts without it.
  useEffect(() => {
    setChangeDue(null);
  }, [orderId]);

  const cashMethod = paymentMethods.find((m) => m.kind === 'CASH');
  const cardMethod = paymentMethods.find((m) => CARD_KINDS.includes(m.kind));
  const creditMethod = paymentMethods.find((m) => m.kind === 'CUSTOMER_CREDIT');
  const hasClubCredit = MoneyUtil.greaterThan(clubCredit, '0');
  // Shown for any order with a customer, greyed out when there is nothing to spend, so the
  // cashier sees the customer has no credit rather than wondering where the button went.
  const showClubCredit = !!creditMethod && !!order?.customer_id;
  const otherMethods = paymentMethods.filter(
    (m) => m.id !== cashMethod?.id && m.id !== cardMethod?.id && !COURIER_KINDS.includes(m.kind)
  );
  const canUseOtherReader = !!cardMethod;

  const due = order?.due_amount || '0';
  const isFullyPaid = order ? MoneyUtil.isZero(order.due_amount) : false;
  const amountRials = fromToman(entry.value) || '0';
  const busy = loading || !!payingId;

  const pay = async (
    method: PaymentMethod | undefined,
    opts: { amount?: string; offTerminal?: boolean; reference?: string; replaces?: string } = {}
  ) => {
    if (!orderId || !order || busy) return;
    if (!method) {
      setError(t('pos.noTenderMethod', 'No active payment method for this tender'));
      return;
    }
    const amount = opts.amount ?? amountRials;
    if (!MoneyUtil.greaterThan(amount, '0')) {
      setError(t('pos.pay.enterAmount'));
      return;
    }
    const over = MoneyUtil.greaterThan(amount, due);
    // Only cash can be handed over in excess; a card is charged what is typed.
    if (over && method.kind !== 'CASH') {
      setError(t('pos.pay.overDue'));
      return;
    }

    // A charge recorded from another reader waits on nothing, so no button shows it as charging.
    setPayingId(opts.offTerminal ? 'other-reader' : method.id);
    setError(null);
    try {
      // A failed charge is cleared before it is taken again, so the list shows one row for it.
      if (opts.replaces) await paymentApi.voidPayment(opts.replaces).catch(() => undefined);

      const res = await paymentApi.postPayment({
        order_id: orderId,
        payment_method_id: method.id,
        amount: over ? due : amount,
        reference_number: opts.reference || undefined,
        off_terminal: opts.offTerminal || undefined,
      });

      setOrder(res.order);
      offerRemainder(res.order);
      const change = over ? MoneyUtil.subtract(amount, due) : null;
      setChangeDue(change);
      if (change) {
        // Screens that close this dialog once the order is settled would hide the alert.
        toast.warning(`${t('pos.changeDue', 'Change to give back')}: ${MoneyUtil.formatCurrency(change)} ${currency}`, {
          duration: 15000,
        });
      }
      setPayments(await paymentApi.getOrderPayments(orderId));
      if (method.kind === 'CUSTOMER_CREDIT') await loadClubCredit(order.customer_id);

      if (res.order && MoneyUtil.isZero(res.order.due_amount) && onPaymentComplete) {
        onPaymentComplete();
      }
    } catch (err: any) {
      const errorMsg = err.detail || t('pos.pay.failed');
      setError(errorMsg);
      showErrorToast(err, errorMsg);
      // The charge that failed is in the list, with what to do about it.
      paymentApi
        .getOrderPayments(orderId)
        .then(setPayments)
        .catch(() => undefined);
    } finally {
      setPayingId(null);
    }
  };

  /** Club credit pays what is typed, or as much of the remainder as the customer holds. Never more: that would be debt. */
  const payClubCredit = () => {
    const amount = entry.fresh && MoneyUtil.greaterThan(due, clubCredit) ? clubCredit : amountRials;
    if (MoneyUtil.greaterThan(amount, clubCredit)) {
      setError(t('pos.pay.clubCreditShort', { amount: MoneyUtil.formatCurrency(clubCredit), currency }));
      return;
    }
    pay(creditMethod, { amount });
  };

  // The latest `pay`, for the key handler, which is bound once per open.
  const payRef = useRef(pay);
  payRef.current = pay;
  const cashRef = useRef(cashMethod);
  cashRef.current = cashMethod;
  const cardRef = useRef(cardMethod);
  cardRef.current = cardMethod;

  /** Starts a method that may need a reference first: a bank transfer, or another reader. */
  const start = (method: PaymentMethod | undefined, offTerminal = false, amount = amountRials, replaces?: string) => {
    setOtherAnchor(null);
    if (!method) return;
    if (offTerminal || method.requires_reference) {
      setReference('');
      setPrompt({ method, offTerminal, amount, replaces });
    } else {
      pay(method, { amount, replaces });
    }
  };

  const handleVoidPayment = async (paymentId: string) => {
    if (!orderId) return;
    try {
      setLoading(true);
      await paymentApi.voidPayment(paymentId);
      setPayments(await paymentApi.getOrderPayments(orderId));
      setError(null);
      toast.success(t('pos.paymentVoided', 'Payment attempt voided'));
    } catch (err: any) {
      const errorMsg = err.detail || t('pos.pay.voidFailed');
      setError(errorMsg);
      showErrorToast(err, errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const pressDigit = (digit: string) =>
    setEntry((prev) => ({
      value: ((prev.fresh ? '' : prev.value) + digit).replace(/^0+/, ''),
      fresh: false,
    }));

  const pressBackspace = () => setEntry((prev) => ({ value: prev.fresh ? '' : prev.value.slice(0, -1), fresh: false }));

  // The keyboard works the panel: digits type the amount, F8 takes it in cash, F9 on the card.
  useEffect(() => {
    if (!open || isFullyPaid || prompt) return undefined;

    const handleKeyDown = (e: KeyboardEvent) => {
      // A field in a dialog over this one keeps its own typing.
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
      if (/^[0-9]$/.test(e.key)) {
        pressDigit(e.key);
      } else if (e.key === 'Backspace') {
        pressBackspace();
      } else if (e.key === 'F8') {
        e.preventDefault();
        payRef.current(cashRef.current);
      } else if (e.key === 'F9') {
        e.preventDefault();
        payRef.current(cardRef.current);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, isFullyPaid, prompt]);

  // A settled order with no change to hand back needs nothing more from the cashier.
  useEffect(() => {
    if (!open || !isFullyPaid || changeDue || onPaymentComplete) return undefined;
    const timer = setTimeout(onClose, CLOSE_AFTER_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isFullyPaid, changeDue]);

  // Another copy on the branch's receipt printer. The first one printed by itself when the
  // order was paid; the browser's print dialog only helps a till with a desktop printer.
  const handlePrintReceipt = async () => {
    if (!orderId) return;
    try {
      const jobs = await kdsApi.reprintOrder(orderId, 'CUSTOMER_RECEIPT', t('pos.printReceipt', 'Print Receipt'));
      if (!Array.isArray(jobs) || jobs.length === 0 || jobs.every((j) => j.status === 'FAILED')) {
        throw new Error(t('pos.receiptFailed', 'The receipt could not be sent to a printer'));
      }
      toast.success(t('pos.receiptSent', 'Receipt sent to the counter printer'));
    } catch (err: any) {
      toast.error(err?.detail || err?.message || t('pos.receiptFailed', 'The receipt could not be sent to a printer'));
      navigate(`/app/pos/receipt/${orderId}`);
    }
  };

  const methodName = (p: Payment) =>
    paymentMethods.find((m) => m.id === p.method_id)?.name || p.method_kind;

  // A cancelled attempt took no money and has nothing left to do.
  const parts = payments.filter((p) => p.status !== 'CANCELLED');

  const tenderButton = (
    method: PaymentMethod | undefined,
    label: React.ReactNode,
    icon: React.ReactNode,
    /** The key that does the same, or what the method has to spend. */
    hint: string,
    variant: 'contained' | 'outlined',
    onClick: () => void = () => pay(method)
  ) => (
    <Button
      fullWidth
      size="large"
      variant={variant}
      color={variant === 'contained' ? 'primary' : 'inherit'}
      disabled={busy || !method}
      onClick={onClick}
      aria-keyshortcuts={/^F\d+$/.test(hint) ? hint : undefined}
      startIcon={payingId && payingId === method?.id ? <CircularProgress size={22} color="inherit" /> : icon}
      sx={{ py: 2, fontSize: '1.05rem', fontWeight: 800, justifyContent: 'space-between', whiteSpace: 'nowrap' }}
      endIcon={
        <Typography component="span" variant="caption" sx={{ opacity: 0.7 }}>
          {hint}
        </Typography>
      }
    >
      <Box component="span" sx={{ flexGrow: 1, textAlign: 'start', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </Box>
    </Button>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
        <PaymentIcon color="primary" />
        <Typography component="span" variant="h6" sx={{ fontWeight: 700 }}>
          {t('pos.checkout', 'Checkout & Settlement')} — #{order?.order_number || ''}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {order && (
          <Grid container spacing={3} sx={{ mt: 0 }}>
            {/* What is left, and what has been taken so far. */}
            <Grid size={{ xs: 12, md: isFullyPaid ? 12 : 4 }}>
              <Typography variant="body2" color="text.secondary">
                {t('orders.totalAmount', 'Total Amount')}: {MoneyUtil.formatCurrency(order.total_amount)} {currency}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                {t('orders.dueAmount', 'Remaining Due')}
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: isFullyPaid ? 'success.main' : 'error.main' }}>
                {MoneyUtil.formatCurrency(order.due_amount)} {currency}
              </Typography>
              {/* What a delivery order leaves unpaid here is not unfinished: the courier brings it back. */}
              {order.order_type === 'DELIVERY' && !isFullyPaid && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {t('pos.pay.courierCollects')}
                  <VersionTag feature="pos.pay.courierCollects" sx={{ ml: 1 }} />
                </Typography>
              )}

              {changeDue && (
                <Alert severity="warning" sx={{ mt: 1.5, py: 1.5, fontWeight: 700, fontSize: '1.1rem' }}>
                  {t('pos.changeDue', 'Change to give back')}: {MoneyUtil.formatCurrency(changeDue)} {currency}
                </Alert>
              )}
              {isFullyPaid && (
                <Alert severity="success" sx={{ mt: 1.5, py: 1.5, fontWeight: 700 }}>
                  {t('pos.orderSettled', 'Order is fully settled!')}
                </Alert>
              )}

              {parts.length > 0 && (
                <Stack divider={<Divider flexItem />} sx={{ mt: 2 }}>
                  {parts.map((p) => {
                    const unconfirmed = p.status === 'PROCESSING' && !!p.needs_terminal_check;
                    const failed = p.status === 'FAILED';
                    const isVoidable = p.status === 'PENDING' || failed;
                    const isCard = CARD_KINDS.includes(p.method_kind);
                    // What this charge was for, or what is left of it.
                    const again = MoneyUtil.greaterThan(p.amount, due) ? wholeRials(due) : wholeRials(p.amount);
                    return (
                      <Box key={p.id} sx={{ py: 1 }}>
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {methodName(p)}
                          </Typography>
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 'bold', color: p.status === 'SUCCEEDED' ? 'success.main' : 'text.secondary' }}
                            >
                              {MoneyUtil.formatCurrency(p.amount)} {currency}
                            </Typography>
                            {p.status !== 'SUCCEEDED' && (
                              <Chip
                                size="small"
                                color={failed || unconfirmed ? 'error' : 'warning'}
                                label={
                                  unconfirmed
                                    ? t('payments.unconfirmed.status', 'Check terminal')
                                    : failed
                                      ? t('pos.pay.statusFailed')
                                      : t('pos.pay.statusWaiting')
                                }
                              />
                            )}
                          </Stack>
                        </Stack>
                        {(p.reference_number || p.reference) && (
                          <Typography variant="caption" color="text.secondary">
                            {p.reference_number || p.reference}
                          </Typography>
                        )}
                        {failed && p.failure_message && (
                          <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                            {p.failure_message}
                          </Typography>
                        )}
                        {unconfirmed && <UnconfirmedChargeActions payment={p} onChanged={loadData} />}
                        {isVoidable && !isFullyPaid && (
                          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                            {failed && isCard && (
                              <Button size="small" disabled={busy} onClick={() => pay(cardMethod, { amount: again, replaces: p.id })}>
                                {t('common.retry', 'Retry')}
                              </Button>
                            )}
                            {failed && isCard && canUseOtherReader && (
                              <Button size="small" disabled={busy} onClick={() => start(cardMethod, true, again, p.id)}>
                                {t('pos.pay.otherReader')}
                              </Button>
                            )}
                            <Button size="small" color="error" disabled={busy} onClick={() => handleVoidPayment(p.id)}>
                              {t('payments.void', 'Cancel')}
                            </Button>
                          </Stack>
                        )}
                      </Box>
                    );
                  })}
                </Stack>
              )}
            </Grid>

            {!isFullyPaid && (
              <>
                {/* The amount for this part. It starts as everything left, so paying in one go is one tap. */}
                <Grid size={{ xs: 12, md: 4 }}>
                  <Paper variant="outlined" sx={{ px: 2, py: 1, borderRadius: 1.5, borderColor: 'primary.main' }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('payments.amount', 'Amount')} ({currency})
                    </Typography>
                    <Typography variant="h4" sx={{ fontWeight: 'bold', textAlign: 'end' }} data-testid="pay-amount">
                      {MoneyUtil.formatCurrency(amountRials)}
                    </Typography>
                  </Paper>
                  <Button size="small" sx={{ my: 1 }} onClick={() => offerRemainder(order)}>
                    {t('pos.pay.remaining')}
                  </Button>
                  {/* A keypad reads 1 2 3 from the left in Persian too. */}
                  <Grid container spacing={1} dir="ltr">
                    {KEYPAD.map((digit) => (
                      <Grid size={{ xs: 4 }} key={digit}>
                        <Button
                          fullWidth
                          variant="outlined"
                          color="inherit"
                          sx={{ fontWeight: 800, fontSize: '1.1rem', py: 1.25 }}
                          onClick={() => pressDigit(digit)}
                        >
                          {digit}
                        </Button>
                      </Grid>
                    ))}
                    <Grid size={{ xs: 4 }}>
                      <Button
                        fullWidth
                        variant="outlined"
                        color="inherit"
                        sx={{ py: 1.25, height: '100%' }}
                        onClick={pressBackspace}
                        aria-label={t('pos.pay.backspace')}
                      >
                        <BackspaceIcon fontSize="small" />
                      </Button>
                    </Grid>
                  </Grid>
                </Grid>

                {/* Tapping how it is paid takes the amount: there is no separate confirm. */}
                <Grid size={{ xs: 12, md: 4 }}>
                  <Stack spacing={1.5}>
                    {tenderButton(cardMethod, t('pos.card', 'Card'), <PointOfSaleIcon />, 'F9', 'contained')}
                    {tenderButton(cashMethod, t('pos.cash', 'Cash'), <PaymentsIcon />, 'F8', 'outlined')}
                    {showClubCredit &&
                      tenderButton(
                        hasClubCredit ? creditMethod : undefined,
                        // The balance goes under the name: beside it, the two don't fit the button.
                        <>
                          <Box component="span" sx={{ display: 'flex', alignItems: 'center', lineHeight: 1.3 }}>
                            {t('pos.pay.clubCredit')}
                            <VersionTag feature="pos.customerCredit" sx={{ ml: 1 }} />
                          </Box>
                          <Typography component="span" variant="caption" sx={{ display: 'block', opacity: 0.7, lineHeight: 1.3 }}>
                            {MoneyUtil.formatCurrency(hasClubCredit ? clubCredit : '0')} {currency}
                          </Typography>
                        </>,
                        <LoyaltyIcon />,
                        '',
                        'outlined',
                        payClubCredit
                      )}
                    {(otherMethods.length > 0 || canUseOtherReader) && (
                      <Button
                        fullWidth
                        variant="text"
                        color="inherit"
                        disabled={busy}
                        startIcon={<MoreHorizIcon />}
                        onClick={(e) => setOtherAnchor(e.currentTarget)}
                      >
                        {t('pos.pay.other')}
                      </Button>
                    )}
                    {payingId && payingId === cardMethod?.id && (
                      <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
                        {t('pos.pay.waitingForTerminal')}
                      </Typography>
                    )}
                  </Stack>
                  <Menu anchorEl={otherAnchor} open={Boolean(otherAnchor)} onClose={() => setOtherAnchor(null)}>
                    {canUseOtherReader && <MenuItem onClick={() => start(cardMethod, true)}>{t('pos.pay.otherReader')}</MenuItem>}
                    {otherMethods.map((m) => (
                      <MenuItem key={m.id} onClick={() => start(m)}>
                        {m.name}
                        {m.kind === 'CUSTOMER_CREDIT' && <VersionTag feature="pos.customerCredit" sx={{ ml: 1 }} />}
                      </MenuItem>
                    ))}
                  </Menu>
                </Grid>
              </>
            )}
          </Grid>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {isFullyPaid && (
          <Button
            variant="contained"
            color="primary"
            startIcon={<PrintIcon />}
            onClick={handlePrintReceipt}
            sx={{ fontWeight: 'bold' }}
          >
            {t('pos.printReceipt', 'Print Receipt')}
          </Button>
        )}
        <Button onClick={onClose}>{t('common.close', 'Close')}</Button>
      </DialogActions>

      {/* The reference for a transfer, or for a card charged by hand on another reader. */}
      <Dialog open={Boolean(prompt)} onClose={() => setPrompt(null)} maxWidth="xs" fullWidth>
        {prompt && (
          <Box
            component="form"
            onSubmit={(e: React.FormEvent) => {
              e.preventDefault();
              const { method, amount, offTerminal, replaces } = prompt;
              setPrompt(null);
              pay(method, { amount, offTerminal, replaces, reference: reference.trim() });
            }}
          >
            <DialogTitle sx={{ fontWeight: 'bold' }}>
              {prompt.offTerminal ? t('pos.pay.otherReader') : prompt.method.name} — {MoneyUtil.formatCurrency(prompt.amount)}{' '}
              {currency}
            </DialogTitle>
            <DialogContent>
              {prompt.offTerminal && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('pos.pay.otherReaderHint')}
                </Typography>
              )}
              <TextField
                autoFocus
                fullWidth
                size="small"
                sx={{ mt: 1 }}
                label={prompt.offTerminal ? t('pos.pay.referenceOptional') : t('pos.pay.reference')}
                required={!prompt.offTerminal}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button onClick={() => setPrompt(null)}>{t('common.cancel', 'Cancel')}</Button>
              <Button type="submit" variant="contained">
                {t('pos.pay.record')}
              </Button>
            </DialogActions>
          </Box>
        )}
      </Dialog>
    </Dialog>
  );
}
