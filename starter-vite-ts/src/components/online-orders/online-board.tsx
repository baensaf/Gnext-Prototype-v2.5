import type { CardActions } from './online-order-card';
import type { OnlineCard, OnlineLane } from 'src/api/onlineOrdersApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { onlineOrdersApi } from 'src/api/onlineOrdersApi';
import { useBranchContextOptional } from 'src/contexts/branch-context';
import { useIncomingOrders } from 'src/contexts/incoming-orders-context';

import { toast } from 'src/components/snackbar';
import { CheckoutModal } from 'src/components/CheckoutModal';

import { PlatformStatus } from './platform-status';
import { OnlineOrderCard } from './online-order-card';
import { useNow, owesMoney, problemText } from './online-helpers';
import { RejectDialog, ReportDialog, DetailsDialog } from './online-dialogs';

// ----------------------------------------------------------------------

/** Most urgent first: what went wrong, what needs an answer, what waits at the counter, what cooks. */
const LANES: OnlineLane[] = ['ISSUE', 'NEW', 'READY', 'PREPARING'];

type Props = {
  /** `panel` fills the POS catalog column and scrolls inside it; `page` is the full-page board. */
  variant: 'panel' | 'page';
  /** An order to show first, from a toast or the pop-up. */
  highlightId?: string | null;
};

/**
 * The standard online-order workflow, the same for every platform: answer it (New), cook it
 * (Preparing), hand it over (Ready), and see anything that went wrong (Issues). What a button
 * does on the platform's side is the server's adapter's business.
 */
export function OnlineBoard({ variant, highlightId }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const online = useIncomingOrders();
  const branchId = useBranchContextOptional()?.selectedBranchId || '';
  const now = useNow();
  const board = online?.board ?? null;

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<OnlineCard | null>(null);
  const [reporting, setReporting] = useState<OnlineCard | null>(null);
  const [details, setDetails] = useState<OnlineCard | null>(null);
  const [collecting, setCollecting] = useState<OnlineCard | null>(null);

  // A card the cashier was sent to: bring it into view once it is on the board.
  useEffect(() => {
    if (!highlightId || !board) return;
    const el = document.querySelector(`[data-online-card="${highlightId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlightId, board]);

  const refresh = useCallback(() => online?.refresh() ?? Promise.resolve(), [online]);

  const run = useCallback(
    async (card: OnlineCard, work: () => Promise<unknown>, success: string) => {
      setBusyId(card.id);
      try {
        await work();
        toast.success(success);
        await refresh();
        return true;
      } catch (err: any) {
        toast.error(problemText(t, err, t('online.toast.failed')));
        await refresh();
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [refresh, t]
  );

  // The platform likes to hear that the store opened a waiting order (Snappfood: pick).
  const markOpened = (card: OnlineCard) => {
    if (card.lane === 'NEW') onlineOrdersApi.opened(card.id).catch(() => undefined);
  };

  const actions: CardActions = {
    accept: (card, minutes) => {
      markOpened(card);
      run(card, () => onlineOrdersApi.accept(card.id, minutes), t('online.toast.accepted', { code: card.displayCode }));
    },
    reject: (card) => {
      markOpened(card);
      setRejecting(card);
    },
    details: (card) => {
      markOpened(card);
      setDetails(card);
    },
    ready: (card) => run(card, () => onlineOrdersApi.ready(card.id), t('online.toast.readyDone', { code: card.displayCode })),
    handOver: (card) => {
      // A cash order the customer collects is paid at the till first, then handed over.
      if (owesMoney(card)) {
        setCollecting(card);
        return;
      }
      run(card, () => onlineOrdersApi.handedOver(card.id), t('online.toast.handedOver', { code: card.displayCode }));
    },
    sendOut: () => router.push(paths.app.delivery.orders),
    report: (card) => setReporting(card),
    seen: (card) => run(card, () => onlineOrdersApi.alertSeen(card.id), t('online.toast.seen', { code: card.displayCode })),
  };

  if (!online?.enabled) {
    return <Alert severity="info">{t('online.noBranch')}</Alert>;
  }

  const cards = board?.cards ?? [];
  const inLane = (lane: OnlineLane) => cards.filter((c) => c.lane === lane);
  const panel = variant === 'panel';

  const renderCard = (card: OnlineCard) => (
    <OnlineOrderCard
      key={`${card.id}:${card.lane}`}
      card={card}
      now={now}
      defaultPrepMinutes={board?.policy.defaultPrepMinutes ?? 20}
      shiftOpen={board?.shiftOpen ?? true}
      busy={busyId === card.id}
      highlighted={card.id === highlightId}
      actions={actions}
    />
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: panel ? '100%' : undefined, minHeight: 0, gap: 1.5, p: panel ? 1.5 : 0 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {variant === 'page' && (
          <Typography variant="h4" sx={{ marginInlineEnd: 1 }}>
            {t('online.title')}
          </Typography>
        )}
        {board?.platforms.map((status) => (
          <PlatformStatus key={status.platform} branchId={branchId} status={status} onChanged={refresh} />
        ))}
        <Box sx={{ flexGrow: 1 }} />
        {board && (
          <Button size="small" color="inherit" onClick={() => router.push(paths.app.orders.root)}>
            {t('online.doneToday', { count: board.doneToday })}
          </Button>
        )}
      </Stack>

      {board && !board.shiftOpen && <Alert severity="warning">{t('online.noShift')}</Alert>}

      {board && cards.length === 0 ? (
        <Box sx={{ flexGrow: 1, display: 'grid', placeItems: 'center', py: 6 }}>
          <Typography color="text.secondary" sx={{ textAlign: 'center' }}>
            {t('online.empty')}
          </Typography>
        </Box>
      ) : (
        // One section per lane, most urgent first, each a grid that fits as many cards as the
        // width allows: three narrow columns did not fit beside the cart.
        <Stack spacing={2} sx={{ flexGrow: 1, minHeight: 0, overflowY: panel ? 'auto' : 'visible', pb: 1 }}>
          {LANES.map((lane) => {
            const list = inLane(lane);
            if (lane === 'ISSUE' && list.length === 0) return null;
            return (
              <Box key={lane}>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ color: lane === 'ISSUE' ? 'error.main' : 'text.primary' }}>
                    {t(`online.lane.${lane}`)}
                  </Typography>
                  <Chip
                    size="small"
                    label={list.length}
                    color={(lane === 'NEW' || lane === 'ISSUE') && list.length ? 'error' : 'default'}
                    sx={{ height: 20 }}
                  />
                </Stack>
                {list.length ? (
                  <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
                    {list.map(renderCard)}
                  </Box>
                ) : (
                  <Typography variant="caption" color="text.disabled">
                    {t(`online.laneEmpty.${lane}`)}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Stack>
      )}

      <RejectDialog
        card={rejecting}
        busy={!!rejecting && busyId === rejecting.id}
        onClose={() => setRejecting(null)}
        onConfirm={async (card, reason, comment) => {
          const ok = await run(card, () => onlineOrdersApi.reject(card.id, reason, comment), t('online.toast.rejected', { code: card.displayCode }));
          if (ok) setRejecting(null);
        }}
      />
      <ReportDialog
        card={reporting}
        now={now}
        busy={!!reporting && busyId === reporting.id}
        onClose={() => setReporting(null)}
        onConfirm={async (card, report) => {
          const platform = t(`online.platform.${card.platform}`);
          const ok = await run(card, () => onlineOrdersApi.report(card.id, report), t('online.toast.reported', { code: card.displayCode, platform }));
          if (ok) setReporting(null);
        }}
      />
      <DetailsDialog card={details} onClose={() => setDetails(null)} />
      <CheckoutModal
        open={!!collecting}
        orderId={collecting?.id ?? null}
        onClose={() => setCollecting(null)}
        onPaymentComplete={() => {
          const card = collecting;
          setCollecting(null);
          if (card) run(card, () => onlineOrdersApi.handedOver(card.id), t('online.toast.handedOver', { code: card.displayCode }));
        }}
      />
    </Box>
  );
}
