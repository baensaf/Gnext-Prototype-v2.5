import type { Payment } from 'src/api/paymentApi';
import type { OrderHeader } from 'src/api/orderApi';
import type { Customer } from 'src/api/customerApi';
import type { PaymentMethod } from 'src/api/settingsApi';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useRef, useState, useEffect, useCallback } from 'react';

import {
  Box,
  Stack,
  Alert,
  Dialog,
  Button,
  Divider,
  Checkbox,
  TextField,
  ButtonBase,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  FormControlLabel,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { newIdempotencyKey } from 'src/utils/idempotency';
import { toToman, fromToman, useCurrencyLabel } from 'src/utils/currency';

import { taraApi } from 'src/api/taraApi';
import { orderApi } from 'src/api/orderApi';
import { paymentApi } from 'src/api/paymentApi';
import { printingApi } from 'src/api/printingApi';
import { settingsApi } from 'src/api/settingsApi';
import { customerApi } from 'src/api/customerApi';

import { toast } from 'src/components/snackbar';
import { VersionTag } from 'src/components/version-tag';
import { ConfirmDialog } from 'src/components/confirm-dialog';
import { paymentErrorKey, paymentErrorText } from 'src/components/payment-terminal/payment-errors';
import { UnconfirmedChargeActions } from 'src/components/payment-terminal/unconfirmed-charge-actions';

/** The API sends "42292000.0000"; the form works on whole rials. */
const wholeRials = (amount?: string | null) => String(amount || '0').replace(/\.0*$/, '');

/** The counter's card terminal. Falling back to any other method recorded card sales wrongly. */
const CARD_KINDS = ['CARD_POS', 'CARD', 'POS', 'NETWORK_POS'];

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

/** What a customer can still buy on credit: limit plus balance, never below zero; no cap when unlimited. */
const UNLIMITED_CREDIT = '999999999999';
/** The cashback in the customer's wallet: offered by default, the rest is typed. */
const walletOf = (customer?: Customer | null) => positive(wholeRials(customer?.wallet_account?.current_balance));
const availableCreditOf = (customer?: Customer | null) => {
  const account = customer?.credit_account;
  if (!account) return '0';
  if (account.mode === 'UNLIMITED') return UNLIMITED_CREDIT;
  return positive(MoneyUtil.add(wholeRials(account.credit_limit), wholeRials(account.current_balance)));
};

/** What is typed in the fields, in tomans. Card is the rest until the cashier types in it. */
type Fields = { cash: string; wallet: string; credit: string; tara: string; card: string; cardTyped: boolean };
type FieldName = 'cash' | 'wallet' | 'credit' | 'tara' | 'card';

const EMPTY: Fields = { cash: '', wallet: '', credit: '', tara: '', card: '', cardTyped: false };

/** How often the dialog asks again while a card charge waits on the terminal. */
const WAITING_POLL_MS = 4000;

/** A card charge the terminal has not answered, or a Tara sale Tara has not: the order takes no other payment until it is. */
const isWaitingCharge = (p: Payment) => p.status === 'PROCESSING';

interface CheckoutModalProps {
  open: boolean;
  orderId: string | null;
  onClose: () => void;
  onPaymentComplete?: () => void;
}

/**
 * The pay form Place Order opens, for the orders PC-POS does not take in one go. It looks the same
 * for every order so the cashier's hands learn it: Cash, Wallet, Customer credit and Card in that
 * order, focus in Cash, Enter pays. Wallet starts at the cashback the customer holds; Customer
 * credit (pay later, what they owe) is typed, up to what is left of their limit. Each is greyed out
 * when the customer has none; Card is what is left.
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
  // Cash handed over beyond what is due: the drawer keeps only the due amount, and the
  // cashier gives this back.
  const [changeDue, setChangeDue] = useState<string | null>(null);
  // What the order's customer can still buy on credit, in rials: the limit plus the balance.
  const [creditAvailable, setCreditAvailable] = useState('0');
  // The cashback in the customer's wallet, in rials; the fields start with this, never with debt.
  const [walletHeld, setWalletHeld] = useState('0');
  // The card was already charged on another reader: it is recorded from the slip's reference,
  // never sent to this till's terminal.
  const [offTerminal, setOffTerminal] = useState(false);
  const [slipRef, setSlipRef] = useState('');
  // Tara (V3): whether this till can take it, and the barcode on the customer's Tara app.
  const [taraOpen, setTaraOpen] = useState(false);
  const [taraBarcode, setTaraBarcode] = useState('');
  // The last Tara payment is still with Tara: the card waits for it.
  const taraWaitingRef = useRef(false);
  // The boxes, for moving the cursor to the one a label filled.
  const cashInput = useRef<HTMLInputElement>(null);
  const walletInput = useRef<HTMLInputElement>(null);
  const creditInput = useRef<HTMLInputElement>(null);
  const taraInput = useRef<HTMLInputElement>(null);
  const cardInput = useRef<HTMLInputElement>(null);
  const inputs = { cash: cashInput, wallet: walletInput, credit: creditInput, tara: taraInput, card: cardInput };
  // Closing while a card charge waits on the terminal asks first.
  const [confirmClose, setConfirmClose] = useState(false);
  // Cash was handed over beyond the bill on this order, and the screen waits for the cashier.
  const changeGiven = useRef(false);
  const finishLater = useRef(false);
  // A charge answered after the cashier closed the dialog must not run the caller's "paid" step.
  const openRef = useRef(open);
  openRef.current = open;

  const cashMethod = paymentMethods.find((m) => m.kind === 'CASH');
  const cardMethod = paymentMethods.find((m) => CARD_KINDS.includes(m.kind));
  const creditMethod = paymentMethods.find((m) => m.kind === 'CUSTOMER_CREDIT');
  const walletMethod = paymentMethods.find((m) => m.kind === 'WALLET');
  const taraMethod = paymentMethods.find((m) => m.kind === 'TARA');
  const canUseTara = !!taraMethod && taraOpen;

  const due = wholeRials(order?.due_amount);
  const isFullyPaid = order ? MoneyUtil.isZero(order.due_amount) : false;
  const canUseCredit = !!creditMethod && MoneyUtil.greaterThan(creditAvailable, '0');
  const canUseWallet = !!walletMethod && MoneyUtil.greaterThan(walletHeld, '0');
  const busy = loading || !!paying;
  // A charge on the terminal that nobody has answered: it comes first, and nothing else is paid.
  const waitingCharges = payments.filter(isWaitingCharge);
  const waiting = waitingCharges.length > 0;
  const taraWaiting = waitingCharges.some((p) => p.method_kind === 'TARA');

  /** The fields for what is left: the wallet offered once per order, card for the rest. */
  const fieldsFor = (o: OrderHeader | null, balance: string, paid: Payment[]): Fields => {
    // Nothing is offered while a charge waits: Card must not be filled with what that charge covers.
    if (paid.some(isWaitingCharge)) return { ...EMPTY, cardTyped: true };
    const left = wholeRials(o?.due_amount);
    const walletUsed = paid.some((p) => p.method_kind === 'WALLET' && p.status === 'SUCCEEDED');
    const wallet = !walletUsed && MoneyUtil.greaterThan(balance, '0') ? minOf(balance, left) : '0';
    const rest = positive(MoneyUtil.subtract(left, wallet));
    return {
      cash: '',
      wallet: MoneyUtil.isZero(wallet) ? '' : toToman(wallet),
      credit: '',
      tara: '',
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
      const [customer, taraTill] = await Promise.all([
        o.customer_id ? customerApi.getCustomer(o.customer_id).catch(() => null) : null,
        active.some((m) => m.kind === 'TARA') ? taraApi.till(orderId).catch(() => null) : null,
      ]);
      setTaraOpen(!!taraTill?.available);
      const available = availableCreditOf(customer);
      const held = walletOf(customer);
      setOrder(o);
      setPaymentMethods(active);
      setPayments(paid);
      setCreditAvailable(available);
      setWalletHeld(held);
      setFields(fieldsFor(o, active.some((m) => m.kind === 'WALLET') ? held : '0', paid));
      setError(null);
    } catch (err: any) {
      setError(paymentErrorText(t, err, t('pos.pay.loadFailed')));
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
    setOffTerminal(false);
    setSlipRef('');
    setTaraBarcode('');
    setFields(EMPTY);
    changeGiven.current = false;
    finishLater.current = false;
  }, [orderId]);

  // The cashier always starts typing in Cash, and comes back to it after each payment.
  useEffect(() => {
    if (!open || !order || busy || isFullyPaid || waiting) return;
    const input = cashInput.current;
    input?.focus();
    input?.select();
  }, [open, order, busy, isFullyPaid, waiting]);

  const cash = rialsOf(fields.cash);
  const wallet = rialsOf(fields.wallet);
  const credit = rialsOf(fields.credit);
  const tara = rialsOf(fields.tara);
  const card = rialsOf(fields.card);
  // Wallet, credit and Tara together: none can be handed over beyond the bill.
  const customerFunds = MoneyUtil.add(MoneyUtil.add(wallet, credit), tara);
  // Below zero is cash handed over beyond the bill.
  const remaining = MoneyUtil.subtract(due, MoneyUtil.add(MoneyUtil.add(cash, customerFunds), card));

  /**
   * Typing in Cash, Wallet or Customer credit leaves Card with the rest, until the cashier types
   * in Card. Wallet stops at what it holds; Customer credit at what is left of the limit.
   */
  const setField = (name: FieldName, text: string) => {
    // What was wrong with the last amounts is about those amounts.
    setError(null);
    setFields((prev) => {
      let value = digitsOnly(text);
      const cap =
        name === 'credit' ? minOf(creditAvailable, due) : name === 'wallet' ? minOf(walletHeld, due) : name === 'tara' ? due : null;
      if (cap !== null && MoneyUtil.greaterThan(rialsOf(value), cap)) value = toToman(cap);
      const next = { ...prev, [name]: value };
      if (name === 'card') return { ...next, cardTyped: true };
      if (prev.cardTyped) return next;
      const typed = [next.cash, next.wallet, next.credit, next.tara].reduce((sum, v) => MoneyUtil.add(sum, rialsOf(v)), '0');
      const rest = positive(MoneyUtil.subtract(due, typed));
      return { ...next, card: MoneyUtil.isZero(rest) ? '' : toToman(rest) };
    });
  };

  /**
   * Clicking a label puts the whole bill in that box and empties the others, the wallet too.
   * Wallet and Customer credit stop at their cap and Card takes the rest. It only fills: Enter or
   * Pay still pays. Clicking Card counts as typing in Card, so Card is not worked out again.
   */
  const fillWhole = (name: FieldName) => {
    if (busy || isFullyPaid || waiting) return;
    setError(null);
    const cap = name === 'credit' ? minOf(creditAvailable, due) : name === 'wallet' ? minOf(walletHeld, due) : due;
    const rest = positive(MoneyUtil.subtract(due, cap));
    const show = (rials: string) => (MoneyUtil.isZero(rials) ? '' : toToman(rials));
    setFields({
      ...EMPTY,
      [name]: show(cap),
      // Card is the rest after a capped wallet or credit; for Card itself the whole bill is its own.
      ...(name === 'card' ? {} : { card: show(rest) }),
      cardTyped: name === 'card',
    });
    // After the boxes redraw, so Enter pays right away.
    window.requestAnimationFrame(() => {
      inputs[name].current?.focus();
      inputs[name].current?.select();
    });
  };

  // Only cash can be handed over beyond the bill; wallet, credit or card past it is a typing slip.
  const overByNonCash =
    MoneyUtil.greaterThan(MoneyUtil.add(customerFunds, card), due) ||
    (MoneyUtil.greaterThan(card, '0') && MoneyUtil.greaterThan('0', remaining));

  /** Takes one part. Returns the order as it stands after it, or null when it did not go through. */
  const pay = async (
    method: PaymentMethod | undefined,
    amount: string,
    current: OrderHeader,
    opts: { replaces?: string; slip?: string; taraBarcode?: string } = {}
  ): Promise<OrderHeader | null> => {
    if (!orderId) return null;
    if (!method) {
      setError(t('pos.noTenderMethod', 'No active payment method for this tender'));
      return null;
    }
    const left = wholeRials(current.due_amount);
    const over = MoneyUtil.greaterThan(amount, left);
    taraWaitingRef.current = false;
    try {
      // A failed charge is cleared before it is taken again, so the list shows one row for it.
      if (opts.replaces) await paymentApi.voidPayment(opts.replaces).catch(() => undefined);

      const res = await paymentApi.postPayment({
        order_id: orderId,
        payment_method_id: method.id,
        amount: over ? left : amount,
        ...(opts.slip ? { off_terminal: true, reference_number: opts.slip } : {}),
        ...(opts.taraBarcode !== undefined ? { tara_barcode: opts.taraBarcode } : {}),
        // One key for this payment: the branch agent may repeat the call that makes its intent after a
        // lost answer, and the cloud answers the intent the first call made (agent-protocol §19.11).
        idempotency_key: newIdempotencyKey(),
      });
      taraWaitingRef.current = res.payment.method_kind === 'TARA' && res.payment.status === 'PROCESSING';
      if (over) {
        const change = MoneyUtil.subtract(amount, left);
        setChangeDue(change);
        changeGiven.current = true;
        // Screens that close this dialog once the order is settled would hide the alert.
        toast.warning(`${t('pos.changeDue', 'Change to give back')}: ${MoneyUtil.formatCurrency(change)} ${currency}`, {
          duration: 15000,
        });
      }
      return res.order;
    } catch (err: any) {
      const errorMsg = paymentErrorText(t, err, t('pos.pay.failed'));
      setError(errorMsg);
      // A server fault still toasts through the http client; a refusal is read in the dialog.
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
    const available = customer ? availableCreditOf(customer) : creditAvailable;
    const held = customer ? walletOf(customer) : walletHeld;
    setOrder(latest);
    setPayments(paid);
    setCreditAvailable(available);
    setWalletHeld(held);
    setFields(fieldsFor(latest, walletMethod ? held : '0', paid));
    if (!MoneyUtil.isZero(latest.due_amount) || !onPaymentComplete || !openRef.current) return;
    // A screen that closes the form once the order is paid would hide the change to hand back;
    // it closes when the cashier does.
    if (changeGiven.current) finishLater.current = true;
    else onPaymentComplete();
  };

  /** A card charge still on the terminal: closing is allowed, after a warning (the order list flags it). */
  const chargeInFlight = !isFullyPaid && (paying === 'card' || waiting);

  const close = () => {
    if (chargeInFlight) {
      setConfirmClose(true);
      return;
    }
    closeNow();
  };

  const closeNow = () => {
    setConfirmClose(false);
    if (finishLater.current && onPaymentComplete) {
      finishLater.current = false;
      onPaymentComplete();
    } else onClose();
  };

  /** Enter: wallet, customer credit and cash first, as they are instant, then the card on the terminal. */
  const submit = async (override?: { cash?: string; card?: string }) => {
    if (!order || busy || isFullyPaid || waiting) return;
    const parts = { cash, wallet, credit, tara, card, ...override };
    const total = [parts.cash, parts.wallet, parts.credit, parts.tara, parts.card].reduce((sum, v) => MoneyUtil.add(sum, v), '0');
    if (!MoneyUtil.greaterThan(total, '0')) {
      setError(t('pos.pay.enterAmount'));
      return;
    }
    if (MoneyUtil.greaterThan(parts.wallet, walletHeld)) {
      setError(t('pos.pay.walletShort', { amount: MoneyUtil.formatCurrency(walletHeld), currency }));
      return;
    }
    if (MoneyUtil.greaterThan(parts.credit, creditAvailable)) {
      setError(t('pos.pay.creditShort', { amount: MoneyUtil.formatCurrency(creditAvailable), currency }));
      return;
    }
    // Only cash can be handed over beyond the bill; wallet, credit and card take exactly what is typed.
    const nonCash = [parts.wallet, parts.credit, parts.tara, parts.card].reduce((sum, v) => MoneyUtil.add(sum, v), '0');
    if (MoneyUtil.greaterThan(nonCash, due) || (MoneyUtil.greaterThan(parts.card, '0') && MoneyUtil.greaterThan(total, due))) {
      setError(t('pos.pay.overDue'));
      return;
    }

    // The slip's reference is what the charge is found by later.
    if (offTerminal && MoneyUtil.greaterThan(parts.card, '0') && !slipRef.trim()) {
      setError(t('pos.pay.slipRequired'));
      return;
    }
    // Tara finds the customer by the barcode their Tara app shows.
    if (MoneyUtil.greaterThan(parts.tara, '0') && !taraBarcode.trim()) {
      setError(t('pos.pay.errors.taraBarcode'));
      return;
    }

    setError(null);
    setPaying('other');
    let current: OrderHeader | null = order;
    try {
      if (MoneyUtil.greaterThan(parts.wallet, '0')) current = await pay(walletMethod, parts.wallet, current);
      if (current && MoneyUtil.greaterThan(parts.credit, '0')) current = await pay(creditMethod, parts.credit, current);
      if (current && MoneyUtil.greaterThan(parts.cash, '0')) current = await pay(cashMethod, parts.cash, current);
      if (current && MoneyUtil.greaterThan(parts.tara, '0')) {
        // A failed Tara try on this order is cleared before the new one, so the list shows one row.
        const failedTara = payments.find((p) => p.status === 'FAILED' && p.method_kind === 'TARA');
        current = await pay(taraMethod, minOf(parts.tara, wholeRials(current.due_amount)), current, {
          replaces: failedTara?.id,
          taraBarcode: taraBarcode.trim(),
        });
        if (current && !taraWaitingRef.current) setTaraBarcode('');
        // Tara has not answered yet: the card waits until it does.
        if (taraWaitingRef.current) {
          await settle(current);
          return;
        }
      }
      if (current && MoneyUtil.greaterThan(parts.card, '0')) {
        setPaying('card');
        // A card that failed on this order is taken again in its place.
        const failedCard = payments.find((p) => p.status === 'FAILED' && CARD_KINDS.includes(p.method_kind));
        current = await pay(cardMethod, minOf(parts.card, wholeRials(current.due_amount)), current, {
          replaces: failedCard?.id,
          slip: offTerminal ? slipRef.trim() : undefined,
        });
      }
      await settle(current);
    } finally {
      setPaying(null);
    }
  };

  /** Retry on a failed card row: the same charge again, in its place. */
  const retryCard = async (amount: string, replaces: string) => {
    if (!order || busy) return;
    if (offTerminal && !slipRef.trim()) {
      setError(t('pos.pay.slipRequired'));
      return;
    }
    setError(null);
    setPaying('card');
    try {
      await settle(await pay(cardMethod, amount, order, { replaces, slip: offTerminal ? slipRef.trim() : undefined }));
    } finally {
      setPaying(null);
    }
  };

  /** F8 and F9: everything left in cash, or on the card, beside the wallet and credit as typed. */
  const payRest = (method: 'cash' | 'card') => {
    const rest = positive(MoneyUtil.subtract(due, customerFunds));
    submit(method === 'cash' ? { cash: rest, card: '0' } : { cash: '0', card: rest });
  };

  // The latest handler, for the key listener, which is bound once per open.
  const payRestRef = useRef(payRest);
  payRestRef.current = payRest;

  // A charge that waits on the terminal is answered by the branch agent, not by this screen:
  // look again every few seconds, and set the form up afresh once nothing waits any more.
  const settleRef = useRef(settle);
  settleRef.current = settle;
  useEffect(() => {
    if (!open || !orderId || !waiting || paying) return undefined;
    const timer = window.setInterval(async () => {
      const paid = await paymentApi.getOrderPayments(orderId).catch(() => null);
      if (!paid) return;
      if (paid.some(isWaitingCharge)) setPayments(paid);
      else settleRef.current(null);
    }, WAITING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, orderId, waiting, paying]);

  useEffect(() => {
    if (!open || isFullyPaid) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F8' || e.key === 'F9') {
        e.preventDefault();
        payRestRef.current(e.key === 'F8' ? 'cash' : 'card');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isFullyPaid]);

  // A settled order with no change to hand back needs nothing more from the cashier.
  useEffect(() => {
    if (!open || !isFullyPaid || changeDue || onPaymentComplete) return undefined;
    const timer = setTimeout(onClose, CLOSE_AFTER_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isFullyPaid, changeDue]);

  const handleVoidPayment = async (paymentId: string) => {
    try {
      setLoading(true);
      await paymentApi.voidPayment(paymentId);
      await settle(null);
      setError(null);
      toast.success(t('pos.paymentVoided', 'Payment attempt voided'));
    } catch (err: any) {
      setError(paymentErrorText(t, err, t('pos.pay.voidFailed')));
    } finally {
      setLoading(false);
    }
  };

  // Another copy on the branch's receipt printer. The first one printed by itself when the
  // order was paid; the browser's print dialog only helps a till with a desktop printer.
  const handlePrintReceipt = async () => {
    if (!orderId) return;
    try {
      const jobs = await printingApi.reprintOrder(orderId, 'CUSTOMER_RECEIPT', t('pos.printReceipt', 'Print Receipt'));
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

  // A cancelled attempt took no money and has nothing left to do; nor has a charge answered "not
  // charged". A charge still waiting on the terminal is shown at the top, not here.
  const parts = payments.filter(
    (p) => p.status !== 'CANCELLED' && !isWaitingCharge(p) && !(p.status === 'FAILED' && p.failure_code === 'NOT_CHARGED')
  );
  const locked = busy || isFullyPaid || waiting;

  const amountField = (
    name: FieldName,
    label: React.ReactNode,
    opts: { disabled?: boolean; hint?: React.ReactNode } = {}
  ) => (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 2 }}>
      <Box sx={{ width: 110, flexShrink: 0 }}>
        {/* Click to put the whole bill in this box; a greyed-out box's label does nothing. */}
        <ButtonBase
          // Clicked, not tabbed to: Tab still goes box to box, as the cashier's hands learned it.
          tabIndex={-1}
          disabled={locked || opts.disabled}
          onClick={() => fillWhole(name)}
          sx={{ display: 'block', textAlign: 'start', borderRadius: 0.5, '&:hover .MuiTypography-root': { color: 'primary.main' } }}
          data-testid={`pay-fill-${name}`}
        >
          <Typography variant="body1" sx={{ fontWeight: 600, color: opts.disabled ? 'text.disabled' : 'text.primary' }}>
            {label}
          </Typography>
        </ButtonBase>
        {opts.hint && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
            {opts.hint}
          </Typography>
        )}
      </Box>
      <TextField
        fullWidth
        size="small"
        // Greyed out but still in the Tab order, so Tab lands in the same place on every order.
        disabled={locked}
        sx={opts.disabled ? { '& .MuiInputBase-root': { bgcolor: 'action.disabledBackground' } } : undefined}
        inputRef={inputs[name]}
        value={fields[name] ? MoneyUtil.formatCurrency(fromToman(fields[name])) : ''}
        placeholder="0"
        onChange={(e) => setField(name, e.target.value)}
        onFocus={(e) => e.target.select()}
        slotProps={{
          htmlInput: {
            inputMode: 'numeric',
            readOnly: !!opts.disabled,
            dir: 'ltr',
            'data-testid': `pay-${name}`,
            style: { textAlign: 'right', fontSize: '1.15rem', fontWeight: 600 },
          },
        }}
      />
    </Stack>
  );

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
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

        {/* A card charge nobody has answered comes first: nothing else is paid until it is. */}
        {order &&
          waitingCharges.map((p) =>
            p.method_kind === 'TARA' ? (
              // Tara is asked about it by the server; a stuck sale is a manager's, from Payments.
              <Alert
                key={p.id}
                severity={p.tara?.stuck ? 'warning' : 'info'}
                icon={p.tara?.stuck ? undefined : <CircularProgress size={18} />}
                sx={{ mb: 2 }}
              >
                {t(p.tara?.stuck ? 'pos.pay.taraStuck' : 'pos.pay.taraWaiting', { amount: money(p.amount) })}
              </Alert>
            ) : (
              <UnconfirmedChargeActions key={p.id} payment={p} amountText={money(p.amount)} onChanged={() => settle(null)} />
            )
          )}

        {order && (
          <Box
            onKeyDown={(e: React.KeyboardEvent) => {
              // Enter in any field pays what is typed; on a settled order it closes the form.
              if (e.key !== 'Enter' || (e.target as HTMLElement).tagName !== 'INPUT') return;
              e.preventDefault();
              if (isFullyPaid) close();
              else submit();
            }}
          >
            {/* The same four rows for every order, in the same place. */}
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              {amountField('cash', t('pos.pay.cash'))}
              {amountField('wallet', <>{t('pos.pay.wallet')} <VersionTag feature="pos.wallet" /></>, {
                disabled: !canUseWallet,
                hint: order.customer_id
                  ? t('pos.pay.walletHolds', { amount: MoneyUtil.formatCurrency(walletHeld) })
                  : t('pos.pay.noCustomer'),
              })}
              {amountField('credit', <>{t('pos.pay.credit')} <VersionTag feature="pos.customerCredit" /></>, {
                disabled: !canUseCredit,
                hint: order.customer_id
                  ? creditAvailable === UNLIMITED_CREDIT
                    ? t('pos.pay.unlimited')
                    : t('pos.pay.available', { amount: MoneyUtil.formatCurrency(creditAvailable) })
                  : t('pos.pay.noCustomer'),
              })}
              {/* Tara only where this till takes it: a chain without Tara keeps the same rows as before. */}
              {canUseTara &&
                amountField('tara', <>{t('pos.pay.tara')} <VersionTag feature="pos.tara" /></>, {
                  hint: t('pos.pay.taraHint'),
                })}
              {canUseTara && MoneyUtil.greaterThan(tara, '0') && !isFullyPaid && (
                <TextField
                  size="small"
                  fullWidth
                  disabled={locked}
                  label={t('pos.pay.taraBarcode')}
                  helperText={t('pos.pay.taraBarcodeHelp')}
                  value={taraBarcode}
                  onChange={(e) => setTaraBarcode(e.target.value)}
                  slotProps={{ htmlInput: { dir: 'ltr', maxLength: 64, inputMode: 'numeric', 'data-testid': 'pay-tara-barcode' } }}
                />
              )}
              {amountField('card', t('pos.pay.card'))}
              {/* A card already charged on another reader (a standalone terminal, or before the order was
                  rung up): only the slip's reference is recorded, and this till's terminal is not asked. */}
              {!isFullyPaid && (
                <FormControlLabel
                  sx={{ mx: 0, mt: -0.5 }}
                  disabled={locked}
                  control={
                    <Checkbox
                      size="small"
                      checked={offTerminal}
                      onChange={(e) => setOffTerminal(e.target.checked)}
                    />
                  }
                  label={
                    <Typography variant="body2" color="text.secondary">
                      {t('pos.pay.offTerminal')}
                    </Typography>
                  }
                />
              )}
              {offTerminal && !isFullyPaid && (
                <TextField
                  size="small"
                  fullWidth
                  autoFocus
                  disabled={locked}
                  label={t('pos.pay.slipLabel')}
                  helperText={t('pos.pay.slipHelp')}
                  value={slipRef}
                  onChange={(e) => setSlipRef(e.target.value)}
                  slotProps={{ htmlInput: { dir: 'ltr', maxLength: 64, 'data-testid': 'pay-slip' } }}
                />
              )}
            </Stack>

            <Divider sx={{ my: 2 }} />

            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              {isFullyPaid ? (
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'success.main' }}>
                  {t('pos.pay.settled')}
                </Typography>
              ) : overByNonCash ? (
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'error.main' }}>
                  {t('pos.pay.overDue')}
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
                  const failed = p.status === 'FAILED';
                  const isVoidable = p.status === 'PENDING' || failed;
                  const isCard = CARD_KINDS.includes(p.method_kind);
                  // What this charge was for, or what is left of it.
                  const again = minOf(wholeRials(p.amount), due);
                  const status = failed ? t('pos.pay.statusFailed') : t('pos.pay.statusWaiting');
                  const failureKey = paymentErrorKey(p.failure_code);
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
                            color: p.status === 'SUCCEEDED' ? 'text.primary' : failed ? 'error.main' : 'warning.dark',
                          }}
                        >
                          {p.status !== 'SUCCEEDED' && `${status} · `}
                          {money(p.amount)}
                        </Typography>
                      </Stack>
                      {failed && p.failure_message && (
                        <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                          {failureKey ? t(failureKey) : p.failure_message}
                        </Typography>
                      )}
                      {isVoidable && !isFullyPaid && (
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.25, flexWrap: 'wrap' }}>
                          {failed && isCard && (
                            <Button size="small" disabled={busy} onClick={() => retryCard(again, p.id)}>
                              {t('common.retry', 'Retry')}
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
        {isFullyPaid && (
          <Button color="inherit" onClick={handlePrintReceipt} sx={{ mr: 'auto' }}>
            {t('pos.printReceipt', 'Print Receipt')}
          </Button>
        )}
        <Button color="inherit" onClick={close}>
          {t('common.close', 'Close')}
        </Button>
        {!isFullyPaid && (
          <Button
            variant="contained"
            disabled={busy || !order || waiting}
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

      {/* Closing with a card charge still on the terminal asks first; the order is flagged in Orders. */}
      <ConfirmDialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title={t(taraWaiting ? 'pos.pay.taraCloseWaitingTitle' : 'pos.pay.closeWaitingTitle')}
        content={t(taraWaiting ? 'pos.pay.taraCloseWaiting' : 'pos.pay.closeWaiting')}
        confirmColor="warning"
        confirmLabel={t('pos.pay.closeAnyway')}
        cancelLabel={t('pos.pay.stay')}
        onConfirm={closeNow}
      />
    </Dialog>
  );
}
