import { MoneyUtil } from './money.util';

export const CUSTOMER_CLUB_SETTING_KEY = 'CUSTOMER_CLUB';

/**
 * The customer club's rules, one set for the chain (CUSTOMER_CLUB is not branch-overridable).
 * The defaults are HamiClub's own, read from its panel on 2026-11-10, so a branch moving off
 * HAMI keeps the club its customers know: 10% back on bills of 5,000,000 Rial or more (before
 * discounts), usable from the next day for 14 days.
 */
export interface CustomerClubRules {
  /** Off: no order earns cashback. Wallets already filled can still be spent. */
  enabled: boolean;
  cashbackPercentage: string;
  /** The smallest bill, before discounts, that earns. */
  minBillToEarn: string;
  /** Days after the bill's business day before the cashback can be spent. */
  creditStartsAfterDays: number;
  /** Days the cashback can be spent once it starts; 0 keeps it for good. */
  creditValidDays: number;
}

export const DEFAULT_CUSTOMER_CLUB: CustomerClubRules = {
  enabled: true,
  cashbackPercentage: '10.00',
  minBillToEarn: '5000000.0000',
  creditStartsAfterDays: 1,
  creditValidDays: 14,
};

function wholeDays(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : fallback;
}

function money(value: unknown, fallback: string): string {
  try {
    if (value === undefined || value === null || value === '') return fallback;
    const formatted = MoneyUtil.format(String(value));
    return MoneyUtil.lessThan(formatted, '0') ? fallback : formatted;
  } catch {
    return fallback;
  }
}

/** The stored CUSTOMER_CLUB value with every missing or broken field at its default. */
export function readCustomerClub(value: Record<string, any> | null | undefined): CustomerClubRules {
  const v = value || {};
  return {
    enabled: v.enabled !== false,
    cashbackPercentage: v.cashback_percentage !== undefined && v.cashback_percentage !== null && v.cashback_percentage !== ''
      ? String(v.cashback_percentage)
      : DEFAULT_CUSTOMER_CLUB.cashbackPercentage,
    minBillToEarn: money(v.min_bill_to_earn, DEFAULT_CUSTOMER_CLUB.minBillToEarn),
    creditStartsAfterDays: wholeDays(v.credit_starts_after_days, DEFAULT_CUSTOMER_CLUB.creditStartsAfterDays),
    creditValidDays: wholeDays(v.credit_valid_days, DEFAULT_CUSTOMER_CLUB.creditValidDays),
  };
}
