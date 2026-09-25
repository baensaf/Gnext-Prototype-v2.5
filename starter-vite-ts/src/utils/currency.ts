import { useTranslation } from 'react-i18next';

import { useAuthStore } from 'src/store/useAuthStore';

/**
 * The currency amounts are shown in: the chain's base currency, set under Financial
 * settings. The offline till has no head-office session and sells in rials.
 */
export function useCurrencyCode(): string {
  return useAuthStore((state) => state.tenant?.baseCurrency) || 'IRR';
}

/**
 * The currency as a word in the interface language, for labels such as "Amount (…)": rials
 * read as ریال in Persian, and any other currency by its code.
 */
export function useCurrencyLabel(): string {
  const code = useCurrencyCode();
  const { i18n } = useTranslation();
  return i18n.language?.startsWith('fa') && code === 'IRR' ? 'ریال' : code;
}
