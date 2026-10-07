import type { Payment } from 'src/api/paymentApi';
import type { OrderHeader } from 'src/api/orderApi';
import type { PaymentMethod } from 'src/api/settingsApi';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useRef, useState, useEffect, useCallback } from 'react';

import {
  Box,
  Menu,
  Stack,
  Alert,
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
import { newIdempotencyKey } from 'src/utils/idempotency';
import { toToman, fromToman, useCurrencyLabel } from 'src/utils/currency';

import { kdsApi } from 'src/api/kdsApi';
import { orderApi } from 'src/api/orderApi';
import { paymentApi } from 'src/api/paymentApi';
import { settingsApi } from 'src/api/settingsApi';
import { customerApi } from 'src/api/customerApi';

import { VersionTag } from 'src/components/version-tag';
import { toast, showErrorToast } from 'src/components/snackbar';
import { UnconfirmedChargeActions } from 'src/components/payment-terminal/unconfirmed-charge-actions';

/** The API sends "42292000.0000"; the form works on whole rials. */
const wholeRials = (amount?: string | null) => String(amount || '0').replace(/\.0*$/, '');

/** The counter's card terminal. Falling back to any other method recorded card sales wrongly. */
const CARD_KINDS = ['CARD_POS', 'CARD', 'POS', 'NETWORK_POS'];
/** A courier's reader is settled with the courier, never taken at the counter. */
const COURIER_KINDS = ['MOBILE_POS', 'MOBILE'];

/** How long the settled order stays on screen before the panel closes itself. */
const CLOSE_AFTER_MS = 2500;

/** A Persian keyboard layout types ۱۲۳ on the number row; the fields keep Latin digits only. */
const digitsOnly = (text: string) =>
  text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\D/g, '')
    .replace(/^0+/, '');

/** Tomans as typed, as rials. */
const rialsOf = (toman: string) => fromToman(toman) || '0';
const minOf = (a: string, b: string) => (MoneyUtil.greaterThan(a, b) ? b : a);
const positive = (a: string) => (MoneyUtil.greaterThan(a, '0') ? a : '0');

/** What is typed in the three fields, in tomans. Card is the rest until the cashier types in it. */
type Fields = { cash: string; credit: string; card: string; cardTyped: boolean };

const EMPTY: Fields = { cash: '', credit: '', card: '', cardTyped: false };

/** A payment that needs a reference, or one taken on another reader, before it is recorded. */
type ReferencePrompt = {
  method: PaymentMethod;
  offTerminal: boolean;
  /** Rials. */
  amount: string;
  /** The failed charge this one replaces. */
  replaces?: string;
};

type PayOptions = { offTerminal?: boolean; reference?: string; replaces?: string };

interface CheckoutModalProps {
  open: boolean;
  orderId: string | null;
  onClose: () => void;
  onPaymentComplete?: () => void;
}

/**
 * The pay form Place Order opens, for the orders PC-POS does not take in one go. It looks the same
 * for every order so the cashier's hands learn it: Cash, Club credit and Card in that order, focus
 * in Cash, Enter pays. Club credit starts at what the customer holds and is greyed out when they
 * hold nothing; Card is what is left.
 */
export function CheckoutModal({ open, orderId, onClose, onPaymentComplete }: CheckoutModalProps) {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderHeader | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // What is being taken right now; the card terminal can hold this for minutes.
  const [paying, setPaying] = useState<'card' | 'other' | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const [prompt, setPrompt] = useState<ReferencePrompt | null>(null);
  const [reference, setReference] = useState('');
  // Cash handed over beyond what is due: the drawer keeps only the due amount, and the
  // cashier gives this back.
  const [changeDue, setChangeDue] = useState<string | null>(null);
  // What the order's customer holds as club credit, in rials. Below zero is money owed, not credit.
  const [clubCredit, setClubCredit] = useState('0');
  const cashInput = useRef<HTMLInputElement>(null);

  const cashMethod = paymentMethods.find((m) => m.kind === 'CASH');
  const cardMethod = paymentMethods.find((m) => CARD_KINDS.includes(m.kind));
  const creditMethod = paymentMethods.find((m) => m.kind === 'CUSTOMER_CREDIT');
  // Customer credit is here too: taken from More it may go below zero, which is the customer's debt.
  const otherMethods = paymentMethods.filter(
    (m) => m.id !== cashMethod?.id && m.id !== cardMethod?.id && !COURIER_KINDS.includes(m.kind)
  );

  const due = wholeRials(order?.due_amount);
  const isFullyPaid = order ? MoneyUtil.isZero(order.due_amount) : false;
  const canUseCredit = !!creditMethod && MoneyUtil.greaterThan(clubCredit, '0');
  const busy = loading || !!paying;

  /** The fields for what is left: club credit offered once per order, card for the rest. */
  const fieldsFor = (o: OrderHeader | null, balance: string, paid: Payment[]): Fields => {
    const left = wholeRials(o?.due_amount);
    const creditUsed = paid.some((p) => p.method_kind === 'CUSTOMER_CREDIT' && p.status === 'SUCCEEDED');
    const credit = !creditUsed && MoneyUtil.greaterThan(balance, '0') ? minOf(balance, left) : '0';
    const rest = positive(MoneyUtil.subtract(left, credit));
    return {
      cash: '',
      credit: MoneyUtil.isZero(credit) ? '' : toToman(credit),
      card: MoneyUtil.isZero(rest) ? '' : toToman(rest),
      cardTyped: false,
    };
  };

  const loadData = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const [o, pms, paid] = await Promise.all([
        orderApi.getOrderById(orderId),
        settingsApi.getPaymentMethods(),
        paymentApi.getOrderPayments(orderId),
      ]);
      const active = pms.filter((m) => m.is_active);
      const customer = o.customer_id ? await customerApi.getCustomer(o.customer_id).catch(() => null) : null;
      const balance = wholeRials(customer?.wallet_balance);
      setOrder(o);
      setPaymentMethods(active);
      setPayments(paid);
      setClubCredit(balance);
      setFields(fieldsFor(o, active.some((m) => m.kind === 'CUSTOMER_CREDIT') ? balance : '0', paid));
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('pos.pay.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [orderId, t]);

  useEffect(() => {
    if (open && orderId) {
      loadData();
    }
  }, [open, orderId, loadData]);

  // The change shown is the last cash payment's on this order; the next order starts without it.
  useEffect(() => {
    setChangeDue(null);
    setFields(EMPTY);
  }, [orderId]);

  // The cashier always starts typing in Cash, and comes back to it after each payment.
  useEffect(() => {
    if (!open || !order || busy || isFullyPaid) return;
    const input = cashInput.current;
    input?.focus();
    input?.select();
  }, [open, order, busy, isFullyPaid]);

  const cash = rialsOf(fields.cash);
  const credit = rialsOf(fields.credit);
  const card = rialsOf(fields.card);
  // Below zero is cash handed over beyond the bill.
  const remaining = MoneyUtil.subtract(due, MoneyUtil.add(MoneyUtil.add(cash, credit), card));

  /** Typing in Cash or Club credit leaves Card with the rest, until the cashier types in Card. */
  const setField = (name: 'cash' | 'credit' | 'card', text: string) =>
    setFields((prev) => {
      const next = { ...prev, [name]: digitsOnly(text) };
      if (name === 'card') return { ...next, cardTyped: true };
      if (prev.cardTyped) return next;
      const rest = positive(MoneyUtil.subtract(MoneyUtil.subtract(due, rialsOf(next.cash)), rialsOf(next.credit)));
      return { ...next, card: MoneyUtil.isZero(rest) ? '' : toToman(rest) };
    });

  /** Takes one part. Returns the order as it stands after it, or null when it did not go through. */
  const pay = async (
    method: PaymentMethod | undefined,
    amount: string,
    current: OrderHeader,
    opts: PayOptions = {}
  ): Promise<OrderHeader | null> => {
    if (!orderId) return null;
    if (!method) {
      setError(t('pos.noTenderMethod', 'No active payment method for this tender'));
      return null;
    }
    const left = wholeRials(current.due_amount);
    const over = MoneyUtil.greaterThan(amount, left);
    try {
      // A failed charge is cleared before it is taken again, so the list shows one row for it.
      if (opts.replaces) await paymentApi.voidPayment(opts.replaces).catch(() => undefined);

      const res = await paymentApi.postPayment({
        order_id: orderId,
        payment_method_id: method.id,
        amount: over ? left : amount,
        reference_number: opts.reference || undefined,
        off_terminal: opts.offTerminal || undefined,
        // One key for this payment: the branch agent may repeat the call that makes its intent after a
        // lost answer, and the cloud answers the intent the first call made (agent-protocol §19.11).
        idempotency_key: newIdempotencyKey(),
      });
      if (over) {
        const change = MoneyUtil.subtract(amount, left);
        setChangeDue(change);
        // Screens that close this dialog once the order is settled would hide the alert.
        toast.warning(`${t('pos.changeDue', 'Change to give back')}: ${MoneyUtil.formatCurrency(change)} ${currency}`, {
          duration: 15000,
        });
      }
      return res.order;
    } catch (err: any) {
      const errorMsg = err.detail || t('pos.pay.failed');
      setError(errorMsg);
      showErrorToast(err, errorMsg);
      return null;
    }
  };

  /** After a payment: the fields show what is left, the list what was taken. */
  const settle = async (after: OrderHeader | null) => {
    if (!orderId || !order) return;
    const latest = after || (await orderApi.getOrderById(orderId).catch(() => order));
    const [paid, customer] = await Promise.all([
      paymentApi.getOrderPayments(orderId).catch(() => payments),
      latest.customer_id ? customerApi.getCustomer(latest.customer_id).catch(() => null) : Promise.resolve(null),
    ]);
    const balance = customer ? wholeRials(customer.wallet_balance) : clubCredit;
    setOrder(latest);
    setPayments(paid);
    setClubCredit(balance);
    setFields(fieldsFor(latest, creditMethod ? balance : '0', paid));
    if (MoneyUtil.isZero(latest.due_amount) && onPaymentComplete) onPaymentComplete();
  };

  /** Enter: club credit and cash first, as they are instant, then the card on the terminal. */
  const submit = async (override?: { cash?: string; card?: string }) => {
    if (!order || busy || isFullyPaid) return;
    const parts = { cash, credit, card, ...override };
    const total = MoneyUtil.add(MoneyUtil.add(parts.cash, parts.credit), parts.card);
    if (!MoneyUtil.greaterThan(total, '0')) {
      setError(t('pos.pay.enterAmount'));
      return;
    }
    if (MoneyUtil.greaterThan(parts.credit, clubCredit)) {
      setError(t('pos.pay.clubCreditShort', { amount: MoneyUtil.formatCurrency(clubCredit), currency }));
      return;
    }
    // Only cash can be handed over beyond the bill; credit and card take exactly what is typed.
    const nonCash = MoneyUtil.add(parts.credit, parts.card);
    if (MoneyUtil.greaterThan(nonCash, due) || (MoneyUtil.greaterThan(parts.card, '0') && MoneyUtil.greaterThan(total, due))) {
      setError(t('pos.pay.overDue'));
      return;
    }

    setError(null);
    setPaying('other');
    let current: OrderHeader | null = order;
    try {
      if (MoneyUtil.greaterThan(parts.credit, '0')) current = await pay(creditMethod, parts.credit, current);
      if (current && MoneyUtil.greaterThan(parts.cash, '0')) current = await pay(cashMethod, parts.cash, current);
      if (current && MoneyUtil.greaterThan(parts.card, '0')) {
        setPaying('card');
        // A card that failed on this order is taken again in its place.
        const failedCard = payments.find((p) => p.status === 'FAILED' && CARD_KINDS.includes(p.method_kind));
        current = await pay(cardMethod, minOf(parts.card, wholeRials(current.due_amount)), current, {
          replaces: failedCard?.id,
        });
      }
      await settle(current);
    } finally {
      setPaying(null);
    }
  };

  /** One payment from the list's buttons or the More menu, outside the three fields. */
  const payOne = async (method: PaymentMethod | undefined, amount: string, opts: PayOptions = {}) => {
    if (!order || busy) return;
    if (!MoneyUtil.greaterThan(amount, '0')) {
      setError(t('pos.pay.enterAmount'));
      return;
    }
    if (MoneyUtil.greaterThan(amount, due)) {
      setError(t('pos.pay.overDue'));
      return;
    }
    setError(null);
    setPaying(opts.offTerminal || method?.id !== cardMethod?.id ? 'other' : 'card');
    try {
      await settle(await pay(method, amount, order, opts));
    } finally {
      setPaying(null);
    }
  };

  /** F8 and F9: everything left in cash, or on the card, beside the club credit as typed. */
  const payRest = (method: 'cash' | 'card') => {
    const rest = positive(MoneyUtil.subtract(due, credit));
    submit(method === 'cash' ? { cash: rest, card: '0' } : { cash: '0', card: rest });
  };

  // The latest handler, for the key listener, which is bound once per open.
  const payRestRef = useRef(payRest);
  payRestRef.current = payRest;

  useEffect(() => {
    if (!open || isFullyPaid || prompt) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F8' || e.key === 'F9') {
        e.preventDefault();
        payRestRef.current(e.key === 'F8' ? 'cash' : 'card');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isFullyPaid, prompt]);

  // A settled order with no change to hand back needs nothing more from the cashier.
  useEffect(() => {
    if (!open || !isFullyPaid || changeDue || onPaymentComplete) return undefined;
    const timer = setTimeout(onClose, CLOSE_AFTER_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isFullyPaid, changeDue]);

  /** A method that may need a reference first: a bank transfer, or another reader. */
  const start = (method: PaymentMethod | undefined, offTerminal = false, amount = card, replaces?: string) => {
    setMoreAnchor(null);
    if (!method) return;
    if (offTerminal || method.requires_reference) {
      setReference('');
      setPrompt({ method, offTerminal, amount, replaces });
    } else {
      payOne(method, amount, { replaces });
    }
  };

  const handleVoidPayment = async (paymentId: string) => {
    try {
      setLoading(true);
      await paymentApi.voidPayment(paymentId);
      await settle(null);
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

  const methodName = (p: Payment) => paymentMethods.find((m) => m.id === p.method_id)?.name || p.method_kind;
  const money = (rials: string) => `${MoneyUtil.formatCurrency(rials)} ${currency}`;

  // A cancelled attempt took no money and has nothing left to do.
  const parts = payments.filter((p) => p.status !== 'CANCELLED');
  const locked = busy || isFullyPaid;

  const amountField = (
    name: 'cash' | 'credit' | 'card',
    label: string,
    opts: { disabled?: boolean; hint?: React.ReactNode; inputRef?: React.Ref<HTMLInputElement> } = {}
  ) => (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 2 }}>
      <Box sx={{ width: 110, flexShrink: 0 }}>
        <Typography variant="body1" sx={{ fontWeight: 600, color: opts.disabled ? 'text.disabled' : 'text.primary' }}>
          {label}
        </Typography>
        {opts.hint && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
            {opts.hint}
          </Typography>
        )}
      </Box>
      <TextField
        fullWidth
        size="small"
        disabled={locked || opts.disabled}
        inputRef={opts.inputRef}
        value={fields[name] ? MoneyUtil.formatCurrency(fromToman(fields[name])) : ''}
        placeholder="0"
        onChange={(e) => setField(name, e.target.value)}
        onFocus={(e) => e.target.select()}
        slotProps={{
          htmlInput: {
            inputMode: 'numeric',
            dir: 'ltr',
            'data-testid': `pay-${name}`,
            style: { textAlign: 'right', fontSize: '1.15rem', fontWeight: 600 },
          },
        }}
      />
    </Stack>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 2 }}>
          <Typography component="span" variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t('pos.pay.title', { number: order?.call_number || order?.order_number || '' })}
          </Typography>
          {order && (
            <Typography component="span" variant="body2" color="text.secondary">
              {t('pos.pay.due')}{' '}
              <Box component="span" sx={{ fontWeight: 700, fontSize: '1.15rem', color: 'text.primary' }}>
                {money(due)}
              </Box>
            </Typography>
          )}
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {order && (
          <Box
            onKeyDown={(e: React.KeyboardEvent) => {
              // Enter in any field pays what is typed; on a settled order it closes the form.
              if (e.key !== 'Enter' || (e.target as HTMLElement).tagName !== 'INPUT') return;
              e.preventDefault();
              if (isFullyPaid) onClose();
              else submit();
            }}
          >
            {/* The same three rows for every order, in the same place. */}
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              {amountField('cash', t('pos.pay.cash'), { inputRef: cashInput })}
              {amountField('credit', t('pos.pay.clubCredit'), {
                disabled: !canUseCredit,
                hint: order.customer_id
                  ? t('pos.pay.balance', { amount: MoneyUtil.formatCurrency(positive(clubCredit)) })
                  : t('pos.pay.noCustomer'),
              })}
              {amountField('card', t('pos.pay.card'))}
            </Stack>

            <Divider sx={{ my: 2 }} />

            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              {isFullyPaid ? (
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'success.main' }}>
                  {t('pos.pay.settled')}
                </Typography>
              ) : MoneyUtil.greaterThan('0', remaining) ? (
                <>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'warning.dark' }}>
                    {t('pos.changeDue', 'Change to give back')}
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: 'warning.dark' }}>
                    {money(MoneyUtil.subtract('0', remaining))}
                  </Typography>
                </>
              ) : (
                <>
                  <Typography variant="subtitle1" color="text.secondary">
                    {t('pos.pay.remaining')}
                  </Typography>
                  <Typography
                    variant="h6"
                    sx={{ fontWeight: 700, color: MoneyUtil.isZero(remaining) ? 'text.primary' : 'error.main' }}
                  >
                    {money(remaining)}
                  </Typography>
                </>
              )}
            </Stack>

            {/* What a delivery order leaves unpaid here is not unfinished: the courier brings it back. */}
            {order.order_type === 'DELIVERY' && !isFullyPaid && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {t('pos.pay.courierCollects')}
                <VersionTag feature="pos.pay.courierCollects" sx={{ ml: 1 }} />
              </Typography>
            )}

            {changeDue && (
              <Alert severity="warning" sx={{ mt: 1.5, fontWeight: 700, fontSize: '1.05rem' }}>
                {t('pos.changeDue', 'Change to give back')}: {money(changeDue)}
              </Alert>
            )}

            {paying === 'card' && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {t('pos.pay.waitingForTerminal')}
              </Typography>
            )}

            {parts.length > 0 && (
              <Stack divider={<Divider flexItem />} sx={{ mt: 2 }}>
                {parts.map((p) => {
                  const unconfirmed = p.status === 'PROCESSING' && !!p.needs_terminal_check;
                  const failed = p.status === 'FAILED';
                  const isVoidable = p.status === 'PENDING' || failed;
                  const isCard = CARD_KINDS.includes(p.method_kind);
                  // What this charge was for, or what is left of it.
                  const again = minOf(wholeRials(p.amount), due);
                  const status = unconfirmed
                    ? t('payments.unconfirmed.status', 'Check terminal')
                    : failed
                      ? t('pos.pay.statusFailed')
                      : t('pos.pay.statusWaiting');
                  return (
                    <Box key={p.id} sx={{ py: 0.75 }}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                          {methodName(p)}
                          {(p.reference_number || p.reference) && ` · ${p.reference_number || p.reference}`}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 600,
                            color:
                              p.status === 'SUCCEEDED'
                                ? 'text.primary'
                                : failed || unconfirmed
                                  ? 'error.main'
                                  : 'warning.dark',
                          }}
                        >
                          {p.status !== 'SUCCEEDED' && `${status} · `}
                          {money(p.amount)}
                        </Typography>
                      </Stack>
                      {failed && p.failure_message && (
                        <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                          {p.failure_message}
                        </Typography>
                      )}
                      {unconfirmed && <UnconfirmedChargeActions payment={p} onChanged={loadData} />}
                      {isVoidable && !isFullyPaid && (
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.25, flexWrap: 'wrap' }}>
                          {failed && isCard && (
                            <Button size="small" disabled={busy} onClick={() => payOne(cardMethod, again, { replaces: p.id })}>
                              {t('common.retry', 'Retry')}
                            </Button>
                          )}
                          {failed && isCard && cardMethod && (
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
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        {!isFullyPaid && (otherMethods.length > 0 || cardMethod) && (
          <Button color="inherit" disabled={busy} onClick={(e) => setMoreAnchor(e.currentTarget)} sx={{ mr: 'auto' }}>
            {t('pos.pay.more')}
          </Button>
        )}
        {isFullyPaid && (
          <Button color="inherit" onClick={handlePrintReceipt} sx={{ mr: 'auto' }}>
            {t('pos.printReceipt', 'Print Receipt')}
          </Button>
        )}
        <Button color="inherit" onClick={onClose}>
          {t('common.close', 'Close')}
        </Button>
        {!isFullyPaid && (
          <Button
            variant="contained"
            disabled={busy || !order}
            onClick={() => submit()}
            startIcon={paying ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={{ minWidth: 110, fontWeight: 700 }}
          >
            {t('pos.pay.pay')}
            <Box component="span" sx={{ ml: 1, opacity: 0.6, fontWeight: 400 }}>
              ↵
            </Box>
          </Button>
        )}
      </DialogActions>

      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
        {cardMethod && <MenuItem onClick={() => start(cardMethod, true)}>{t('pos.pay.otherReader')}</MenuItem>}
        {otherMethods.map((m) => (
          <MenuItem key={m.id} onClick={() => start(m)}>
            {m.name}
          </MenuItem>
        ))}
      </Menu>

      {/* The reference for a transfer, or for a card charged by hand on another reader. */}
      <Dialog open={Boolean(prompt)} onClose={() => setPrompt(null)} maxWidth="xs" fullWidth>
        {prompt && (
          <Box
            component="form"
            onSubmit={(e: React.FormEvent) => {
              e.preventDefault();
              const { method, amount, offTerminal, replaces } = prompt;
              setPrompt(null);
              payOne(method, amount, { offTerminal, replaces, reference: reference.trim() });
            }}
          >
            <DialogTitle sx={{ fontWeight: 'bold' }}>
              {prompt.offTerminal ? t('pos.pay.otherReader') : prompt.method.name} — {money(prompt.amount)}
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
