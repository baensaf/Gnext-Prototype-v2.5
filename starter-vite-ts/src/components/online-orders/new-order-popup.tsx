import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { onlineOrdersApi } from 'src/api/onlineOrdersApi';
import { formatCardTotal, useIncomingOrders } from 'src/contexts/incoming-orders-context';

import { toast } from 'src/components/snackbar';

import { useNow, problemText, minutesUntil, itemsSummary, defaultPromise } from './online-helpers';

// ----------------------------------------------------------------------

type Props = {
  /** Shows the order on the Online tab. */
  onOpen: (orderId: string) => void;
};

/**
 * A new online order over the menu, so the cashier can take it with one tap and go back to the
 * guest at the counter. It stays until the order is answered; "Later" folds it to a pill.
 */
export function NewOrderPopup({ onOpen }: Props) {
  const { t, i18n } = useTranslation();
  const online = useIncomingOrders();
  const now = useNow(5000);
  const [folded, setFolded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const waiting = online?.waiting ?? [];
  const board = online?.board;
  if (!online?.enabled || !board || waiting.length === 0) return null;

  // The oldest is the one about to run out of time.
  const card = waiting[0];
  const platform = t(`online.platform.${card.platform}`);
  const minutes = defaultPromise(card, board.policy.defaultPrepMinutes);
  const left = minutesUntil(card.answerBy, now);

  // Folded until another order arrives.
  if (folded && folded === waiting.map((w) => w.id).join(',')) {
    return (
      <Box sx={{ position: 'absolute', top: 68, insetInlineStart: 12, zIndex: 3 }}>
        <Chip color="error" label={t('online.popup.pill', { count: waiting.length })} onClick={() => setFolded(null)} sx={{ fontWeight: 700, boxShadow: 4 }} />
      </Box>
    );
  }

  const accept = async () => {
    setBusy(true);
    onlineOrdersApi.opened(card.id).catch(() => undefined);
    try {
      await onlineOrdersApi.accept(card.id, minutes);
      toast.success(t('online.toast.accepted', { code: card.displayCode }));
    } catch (err: any) {
      toast.error(problemText(t, err, t('online.toast.failed')));
    } finally {
      setBusy(false);
      online.refresh();
    }
  };

  return (
    <Paper
      elevation={12}
      role="alertdialog"
      aria-label={t('online.popup.title', { count: waiting.length })}
      sx={{
        position: 'absolute',
        // Below the search bar, over the menu: the cart and its pay buttons stay clear.
        top: 68,
        insetInlineStart: 12,
        insetInlineEnd: 12,
        zIndex: 3,
        p: 2,
        borderInlineStart: 6,
        borderInlineStartColor: 'primary.main',
        maxWidth: 560,
        marginInline: 'auto',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {t('online.popup.title', { count: waiting.length })}
        </Typography>
        <Chip size="small" label={`${platform} · ${card.displayCode}`} />
        <Box sx={{ flexGrow: 1 }} />
        <Chip
          size="small"
          color={left <= 1 ? 'error' : left <= 2 ? 'warning' : 'default'}
          label={left > 0 ? t('online.timer.answerIn', { count: left }) : t('online.timer.answerNow')}
        />
      </Stack>
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        {itemsSummary(card, i18n.language)}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        {[t(`online.fulfilment.${card.fulfilment}`, { platform }), formatCardTotal(card), card.customerName].filter(Boolean).join(' · ')}
      </Typography>
      {!board.shiftOpen && (
        <Typography variant="caption" color="error.main" sx={{ display: 'block', mb: 1 }}>
          {t('online.noShiftShort')}
        </Typography>
      )}
      <Stack direction="row" spacing={1}>
        <Button variant="contained" size="large" disabled={busy || !board.shiftOpen} onClick={accept} sx={{ flexGrow: 1, fontWeight: 700 }}>
          {t('online.accept', { count: minutes })}
        </Button>
        <Button variant="outlined" size="large" onClick={() => onOpen(card.id)}>
          {t('online.popup.open')}
        </Button>
        <Button color="inherit" onClick={() => setFolded(waiting.map((w) => w.id).join(','))}>
          {t('online.popup.later')}
        </Button>
      </Stack>
    </Paper>
  );
}
