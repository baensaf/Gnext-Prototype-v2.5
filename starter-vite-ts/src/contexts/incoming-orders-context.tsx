import type { OrderHeader } from 'src/api/orderApi';

import { useTranslation } from 'react-i18next';
import { useRef, useMemo, useState, useEffect, useContext, useCallback, createContext } from 'react';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { orderApi } from 'src/api/orderApi';
import { canReachPath } from 'src/config/role-access';
import { useBranchContextOptional } from 'src/contexts/branch-context';
import { useAuthStore, useIsHeadOffice } from 'src/store/useAuthStore';

import { toast } from 'src/components/snackbar';

// ----------------------------------------------------------------------

/** How often the queue is re-read. The prototype polls rather than holding a socket open. */
const POLL_MS = 5000;

/**
 * The chime repeats while anything is waiting, rather than sounding once per order, so a
 * single beep missed during a rush does not lose an order. Snappfood penalises a store that
 * leaves an order unanswered.
 */
const CHIME_REPEAT_MS = 10000;

type IncomingOrdersValue = {
  /** False at head office and in sites that take no orders: there is no counter to answer at. */
  enabled: boolean;
  /** Orders waiting for this branch to accept or reject them, oldest first. */
  orders: OrderHeader[];
  refresh: () => Promise<void>;
};

const IncomingOrdersContext = createContext<IncomingOrdersValue | undefined>(undefined);

/** Undefined outside the provider, like the branch scope; callers treat that as "no queue". */
export function useIncomingOrders(): IncomingOrdersValue | undefined {
  return useContext(IncomingOrdersContext);
}

export function formatOrderTotal(order: OrderHeader): string {
  const amount = Number(order.grand_total || order.total_amount || 0).toLocaleString();
  return order.currency_code ? `${amount} ${order.currency_code}` : amount;
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
 * One watcher for the whole app, so the header badge, the sidebar count, the toast and the
 * Incoming Orders page all read the same list and the queue is polled once, not per screen.
 */
export function IncomingOrdersProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const router = useRouter();
  const role = useAuthStore((state) => state.user?.role);
  const isHeadOfficeAccount = useIsHeadOffice();
  const branchScope = useBranchContextOptional();
  const branchId = branchScope?.selectedBranchId || '';

  const enabled =
    !!branchId &&
    !branchScope?.isHeadOffice &&
    branchScope?.selectedBranchType === 'RESTAURANT' &&
    canReachPath(role, paths.app.orders.incoming, isHeadOfficeAccount);

  const [orders, setOrders] = useState<OrderHeader[]>([]);

  // Ids already announced. Null until the first read of a branch, so the orders already
  // waiting when the app opens fill the queue without a burst of toasts.
  const announced = useRef<Set<string> | null>(null);

  useEffect(() => {
    announced.current = null;
    setOrders([]);
  }, [branchId, enabled]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const list = await orderApi.getIncomingOrders(branchId);
      setOrders(list);

      const previous = announced.current;
      if (previous) {
        const arrivals = list.filter((order) => !previous.has(order.id));
        arrivals.forEach((order) => {
          toast.info(t('orders.incoming.toastTitle', { number: order.order_number }), {
            description: t('orders.incoming.toastDescription', { total: formatOrderTotal(order) }),
            duration: 15000,
            action: {
              label: t('orders.incoming.view'),
              onClick: () => router.push(`${paths.app.orders.incoming}?order=${order.id}`),
            },
          });
        });
        if (arrivals.length) playChime();
      }
      announced.current = new Set(list.map((order) => order.id));
    } catch {
      // Keep the last list; the next poll tries again.
    }
  }, [enabled, branchId, router, t]);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  const waiting = enabled && orders.length > 0;

  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(playChime, CHIME_REPEAT_MS);
    return () => clearInterval(timer);
  }, [waiting]);

  const value = useMemo(
    () => ({ enabled, orders: enabled ? orders : [], refresh }),
    [enabled, orders, refresh]
  );

  return <IncomingOrdersContext.Provider value={value}>{children}</IncomingOrdersContext.Provider>;
}
