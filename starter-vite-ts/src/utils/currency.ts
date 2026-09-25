import { useAuthStore } from 'src/store/useAuthStore';

/**
 * The currency amounts are shown in: the chain's base currency, set under Financial
 * settings. The offline till has no head-office session and sells in rials.
 */
export function useCurrencyCode(): string {
  return useAuthStore((state) => state.tenant?.baseCurrency) || 'IRR';
}
