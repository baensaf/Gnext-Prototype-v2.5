import type { TFunction } from 'i18next';

/**
 * A few messages the server writes in English that a cashier reads every day, put into the
 * interface language. Anything else passes through as the server wrote it.
 */
export function serverText(text: string | null | undefined, t: TFunction): string {
  const value = text || '';

  const pin = /^Invalid manager PIN\. Remaining attempts: (-?\d+)/i.exec(value);
  if (pin) return t('approval.invalidPin', { count: Math.max(0, Number(pin[1])) });

  const courier = /^Courier (.+) (short|over) on (\S+)$/.exec(value);
  if (courier) {
    return t(courier[2] === 'short' ? 'delivery.settlement.courierShort' : 'delivery.settlement.courierOver', {
      courier: courier[1],
      settlement: courier[3],
    });
  }

  if (value === 'Paid order cancellation') return t('refunds.paidCancellation');

  return value;
}
