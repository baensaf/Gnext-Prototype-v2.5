import type { TFunction } from 'i18next';
import type { OnlineCard } from 'src/api/onlineOrdersApi';

import { useState, useEffect } from 'react';

import { MoneyUtil } from 'src/utils/money.util';

// ----------------------------------------------------------------------

/** The time now, re-read every few seconds so countdowns move without a server read. */
export function useNow(everyMs = 15000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** Whole minutes from now until `iso`, never below zero. */
export function minutesUntil(iso: string | null, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60000));
}

/** Whole minutes since `iso`. */
export function minutesSince(iso: string | null, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

export function clockTime(iso: string, language: string): string {
  return new Date(iso).toLocaleTimeString(language === 'fa' ? 'fa-IR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
}

export const owesMoney = (card: Pick<OnlineCard, 'collectAmount'>) => MoneyUtil.greaterThan(card.collectAmount || '0', '0');

/** "2× Cheeseburger, 1× Fries". */
export function itemsSummary(card: Pick<OnlineCard, 'items'>, language: string): string {
  return card.items.map((item) => `${item.quantity}× ${item.name}`).join(language === 'fa' ? '، ' : ', ');
}

/** The minutes an accept starts from: the branch's default, within the platform's limit. */
export function defaultPromise(card: OnlineCard, defaultPrepMinutes: number): number {
  return Math.max(5, Math.min(defaultPrepMinutes, card.maxPromiseMinutes));
}

/**
 * Words for a server refusal the cashier can act on, from its code; otherwise what the server
 * said, otherwise the fallback.
 */
export function problemText(t: TFunction, err: any, fallback: string): string {
  const code = err?.code as string | undefined;
  if (code) {
    const known = String(
      t(`online.errors.${code}`, { defaultValue: '', maxMinutes: err?.maxMinutes, windowMinutes: err?.windowMinutes })
    );
    if (known) return known;
  }
  return err?.detail || err?.message || fallback;
}
