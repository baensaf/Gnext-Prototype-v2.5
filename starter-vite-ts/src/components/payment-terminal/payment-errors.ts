import type { TFunction } from 'i18next';

/**
 * The server's error codes a cashier can hit at the pay dialog, and the words for each.
 * The server's own `detail` is English and for the log; the till shows these instead.
 */
const PAYMENT_ERROR_KEYS: Record<string, string> = {
  ACTIVE_PAYMENT_INTENT: 'pos.pay.errors.activeIntent',
  TERMINAL_CHARGE_IN_PROGRESS: 'pos.pay.errors.chargeInProgress',
  TERMINAL_UNCONFIRMED: 'pos.pay.errors.unconfirmed',
  NOTHING_TO_CHECK: 'pos.pay.errors.nothingToCheck',
  QUERY_UNSUPPORTED: 'pos.pay.errors.queryUnsupported',
  ORDER_ALREADY_PAID: 'pos.pay.errors.alreadyPaid',
  WALLET_BALANCE_SHORT: 'pos.pay.errors.walletShort',
  CREDIT_LIMIT_EXCEEDED: 'pos.pay.errors.creditShort',
  SNAPPFOOD_ORDER_LOCKED: 'pos.pay.errors.platformOrder',
  AGENT_OFFLINE: 'pos.pay.errors.agentOffline',
  DECLINED: 'pos.pay.errors.declined',
  CANCELLED: 'pos.pay.errors.cancelled',
};

/** The locale key for a known code, or null when the server's code has no words here yet. */
export const paymentErrorKey = (code?: string | null) => (code ? PAYMENT_ERROR_KEYS[code] ?? null : null);

/** What to show for a failed payment call: the words for its code, else the screen's own fallback. */
export const paymentErrorText = (t: TFunction, err: any, fallback: string) => {
  const key = paymentErrorKey(err?.code);
  return key ? t(key) : fallback;
};
