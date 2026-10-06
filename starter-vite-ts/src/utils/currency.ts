import Decimal from 'decimal.js';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from 'src/store/useAuthStore';

/**
 * Money is stored in rials, as Iranian banks and card terminals expect, and shown in tomans
 * (Phase 1, 2026-09-29): one toman is ten rials. Every amount on screen, and every amount a
 * person types, is in tomans; the conversion happens only here.
 */
export const RIALS_PER_TOMAN = 10;

/** Rials as the toman figure a person reads or types: "150000" → "15000". */
export function toToman(rial: string | number | null | undefined): string {
  if (rial === '' || rial === null || rial === undefined) return '';
  try {
    const value = new Decimal(rial).div(RIALS_PER_TOMAN);
    return value.isInteger() ? value.toFixed(0) : value.toString();
  } catch {
    // Half-typed input such as "-" passes through as it is.
    return String(rial);
  }
}

/** What a person typed in tomans, as rials to store: "15000" → "150000". Empty stays empty. */
export function fromToman(toman: string | number | null | undefined): string {
  if (toman === '' || toman === null || toman === undefined) return '';
  if (toman === '-') return '-';
  try {
    return new Decimal(toman).times(RIALS_PER_TOMAN).toFixed(0);
  } catch {
    return '';
  }
}

/**
 * The currency amounts are stored in: the chain's base currency, set under Financial
 * settings. This is a code for the server; to show a unit next to an amount, use
 * `useCurrencyLabel`.
 */
export function useCurrencyCode(): string {
  return useAuthStore((state) => state.tenant?.baseCurrency) || 'IRR';
}

/** The unit an amount stored in `code` is shown in: rials read as tomans; others by their code. */
export function moneyUnit(code: string | null | undefined, language?: string): string {
  if (!code || code === 'IRR') return language?.startsWith('fa') ? 'تومان' : 'Toman';
  return code;
}

/** The unit amounts are shown in, in the interface language, for labels such as "Amount (…)". */
export function useCurrencyLabel(): string {
  const code = useCurrencyCode();
  const { i18n } = useTranslation();
  return moneyUnit(code, i18n.language);
}
