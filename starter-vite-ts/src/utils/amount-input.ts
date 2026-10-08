import { fromToman } from 'src/utils/currency';
import { MoneyUtil } from 'src/utils/money.util';

/**
 * An amount field a person types tomans into, shown with thousand separators while they type.
 * A Persian keyboard's ۱۲۳ count as digits. Values go in and out in rials, as the API keeps them.
 */
export const amountText = (rials: string | null | undefined) =>
  rials && MoneyUtil.greaterThan(rials, '0') ? MoneyUtil.formatCurrency(rials) : '';

export const amountFromText = (text: string) =>
  fromToman(
    text
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/\D/g, '')
  ) || '';
