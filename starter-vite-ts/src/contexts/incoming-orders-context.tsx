import type { OnlineCard, OnlineBoard } from 'src/api/onlineOrdersApi';

import { useTranslation } from 'react-i18next';
import { useRef, useMemo, useState, useEffect, useContext, useCallback, createContext } from 'react';

import { paths } from 'src/routes/paths';
import { useRouter, usePathname } from 'src/routes/hooks';

import { moneyUnit } from 'src/utils/currency';
import { MoneyUtil } from 'src/utils/money.util';
import { useCloudBack } from 'src/utils/cloud-back';

import i18n from 'src/locales/i18n';
import { canReachPath } from 'src/config/role-access';
import { onlineOrdersApi } from 'src/api/onlineOrdersApi';
import { useBranchContextOptional } from 'src/contexts/branch-context';
import { useAuthStore, useIsHeadOffice } from 'src/store/useAuthStore';

import { toast } from 'src/components/snackbar';

// ----------------------------------------------------------------------

/** How often the board is re-read. The prototype polls rather than holding a socket open. */
const POLL_MS = 5000;

/**
 * The chime repeats while anything needs an answer, rather than sounding once per order, so a
 * single beep missed during a rush does not lose an order. Platforms penalise a store that
 * leaves an order unanswered, and a cancel the kitchen has not heard of wastes food.
 */
const CHIME_REPEAT_MS = 10000;

type OnlineOrdersValue = {
  /** False at head office and in sites that take no orders: there is no counter to answer at. */
  enabled: boolean;
  /** The branch's Online board; null until the first read. */
  board: OnlineBoard | null;
  /** Orders waiting for an answer, oldest first. */
  waiting: OnlineCard[];
  /** Cards in the Issues lane. */
  issues: OnlineCard[];
  /** Where the cashier answers online orders: the POS panel, or the full page without POS. */
  panelPath: (orderId?: string) => string;
  refresh: () => Promise<void>;
};

const OnlineOrdersContext = createContext<OnlineOrdersValue | undefined>(undefined);

/** Undefined outside the provider, like the branch scope; callers treat that as "no board". */
export function useIncomingOrders(): OnlineOrdersValue | undefined {
  return useContext(OnlineOrdersContext);
}

export function formatCardTotal(card: Pick<OnlineCard, 'total' | 'currency'>, amount?: string): string {
  return `${MoneyUtil.formatCurrency(amount ?? card.total)} ${moneyUnit(card.currency, i18n.language)}`;
}

/** Two short tones, built in the browser so there is no sound file to ship. */
function playChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx: AudioContext = new AudioCtx();
    [880, 1320].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + index * 0.18;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.17);
    });
    setTimeout(() => ctx.close(), 600);
  } catch {
    // No audio device, or the browser refused to play before any click. The badge and the
    // toast still show the order.
  }
}

/**
 * One watcher for the whole app, so the header badge, the chime, the toasts, the POS panel
 * and the full-page board all read the same board and it is polled once, not per screen.
 */
export function IncomingOrdersProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const role = useAuthStore((state) => state.user?.role);
  const isHeadOfficeAccount = useIsHeadOffice();
  const branchScope = useBranchContextOptional();
  const branchId = branchScope?.selectedBranchId || '';

  const enabled =
    !!branchId &&
    !branchScope?.isHeadOffice &&
    branchScope?.selectedBranchType === 'RESTAURANT' &&
    canReachPath(role, paths.app.orders.incoming, isHeadOfficeAccount);

  // A cashier answers at the till, beside the cart; anyone without a till uses the full page.
  const atTill = canReachPath(role, paths.app.pos, isHeadOfficeAccount);
  const panelPath = useCallback(
    (orderId?: string) => {
      const query = new URLSearchParams();
      if (atTill) query.set('panel', 'online');
      if (orderId) query.set('order', orderId);
      return `${atTill ? paths.app.pos : paths.app.orders.incoming}?${query.toString()}`;
    },
    [atTill]
  );

  const [board, setBoard] = useState<OnlineBoard | null>(null);

  // Ids already announced. Null until the first read of a branch, so the orders already
  // on the board when the app opens do not arrive as a burst of toasts.
  const announced = useRef<Set<string> | null>(null);
  const onPosRef = useRef(false);
  onPosRef.current = pathname === paths.app.pos;

  useEffect(() => {
    announced.current = null;
    setBoard(null);
  }, [branchId, enabled]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const next = await onlineOrdersApi.board(branchId);
      setBoard(next);

      // New orders and new alerts are announced once each. The POS shows its own pop-up for a
      // new order, so the toast there is only for alerts.
      const keyOf = (card: OnlineCard) => `${card.id}:${card.lane === 'ISSUE' ? card.issue : card.lane}`;
      const loud = next.cards.filter((card) => card.lane === 'NEW' || (card.lane === 'ISSUE' && card.issue !== 'WITH_SUPPORT'));
      const previous = announced.current;
      if (previous) {
        const arrivals = loud.filter((card) => !previous.has(keyOf(card)));
        arrivals.forEach((card) => {
          const platform = t(`online.platform.${card.platform}`);
          if (card.lane === 'NEW') {
            if (onPosRef.current) return;
            toast.info(t('online.toast.newTitle', { code: card.displayCode, platform }), {
              description: t('online.toast.newDescription', { total: formatCardTotal(card) }),
              duration: 15000,
              action: { label: t('online.toast.view'), onClick: () => router.push(panelPath(card.id)) },
            });
          } else {
            toast.warning(t(`online.toast.issue.${card.issue}`, { code: card.displayCode, platform }), {
              duration: 30000,
              action: { label: t('online.toast.view'), onClick: () => router.push(panelPath(card.id)) },
            });
          }
        });
        if (arrivals.length) playChime();
      }
      announced.current = new Set(loud.map(keyOf));
    } catch {
      // Keep the last board; the next poll tries again.
    }
  }, [enabled, branchId, router, t, panelPath]);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    // One read at a time: on a branch agent a read made while the cloud is away is held for up to
    // 20 s (agent-protocol.md §19.10), and a new one every 5 s would pile up behind it.
    let reading = false;
    const timer = setInterval(() => {
      if (reading) return;
      reading = true;
      refresh().finally(() => {
        reading = false;
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  // The cloud is back after the Reconnecting bar (agent mode): the board now.
  useCloudBack(() => {
    if (enabled) refresh();
  });

  const cards = useMemo(() => (enabled && board ? board.cards : []), [enabled, board]);
  const waiting = useMemo(() => cards.filter((card) => card.lane === 'NEW'), [cards]);
  const issues = useMemo(() => cards.filter((card) => card.lane === 'ISSUE'), [cards]);
  const needsAttention = waiting.length > 0 || issues.some((card) => card.issue === 'PLATFORM_CANCELLED');

  useEffect(() => {
    if (!needsAttention) return undefined;
    const timer = setInterval(playChime, CHIME_REPEAT_MS);
    return () => clearInterval(timer);
  }, [needsAttention]);

  const value = useMemo(
    () => ({ enabled, board: enabled ? board : null, waiting, issues, panelPath, refresh }),
    [enabled, board, waiting, issues, panelPath, refresh]
  );

  return <OnlineOrdersContext.Provider value={value}>{children}</OnlineOrdersContext.Provider>;
}
