import { MoneyUtil } from './money.util';

/**
 * A product's VAT is stored as a fraction ("0.0900") and typed as a percent (9). These convert
 * between the two, so no form shows "0.0900" and no one types 9 meaning 900%.
 */
export const taxRateToPercent = (rate: string | number | null | undefined): string =>
  String(Number(MoneyUtil.multiply(rate || '0', '100', 2)));

export const percentToTaxRate = (percent: string | number | null | undefined): string =>
  MoneyUtil.divide(percent || '0', '100', 4);

/** A Rial amount as a whole number for an input: "150000", not "150000.0000". */
export const wholeRials = (amount: string | number | null | undefined): string => MoneyUtil.format(amount || '0', 0);
