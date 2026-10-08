import type { OnlineCard } from 'src/api/onlineOrdersApi';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Menu from '@mui/material/Menu';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Avatar from '@mui/material/Avatar';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ButtonGroup from '@mui/material/ButtonGroup';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import TwoWheelerIcon from '@mui/icons-material/TwoWheeler';
import ShoppingBagIcon from '@mui/icons-material/ShoppingBag';
import DeliveryDiningIcon from '@mui/icons-material/DeliveryDining';

import { CONFIG } from 'src/global-config';
import { formatCardTotal } from 'src/contexts/incoming-orders-context';

import { owesMoney, clockTime, minutesSince, minutesUntil, itemsSummary, defaultPromise } from './online-helpers';

// ----------------------------------------------------------------------

export type CardActions = {
  accept: (card: OnlineCard, minutes: number) => void;
  reject: (card: OnlineCard) => void;
  details: (card: OnlineCard) => void;
  ready: (card: OnlineCard) => void;
  handOver: (card: OnlineCard) => void;
  sendOut: (card: OnlineCard) => void;
  report: (card: OnlineCard) => void;
  seen: (card: OnlineCard) => void;
};

type Props = {
  card: OnlineCard;
  now: number;
  defaultPrepMinutes: number;
  shiftOpen: boolean;
  busy: boolean;
  highlighted?: boolean;
  actions: CardActions;
};

const PLATFORM_LOGO: Record<string, string> = {
  SNAPPFOOD: `${CONFIG.assetsDir}/logo/snappfood.png`,
};

const FULFILMENT_ICON = {
  PLATFORM_RIDER: TwoWheelerIcon,
  OWN_COURIER: DeliveryDiningIcon,
  PICKUP: ShoppingBagIcon,
};

/**
 * One online order on the till's panel. Everything the counter needs at a glance: whose order,
 * who carries it, whether money is owed, what is in the bag, and one timer. The main button is
 * the next step in the order's life; anything rarer sits behind the menu.
 */
export function OnlineOrderCard({ card, now, defaultPrepMinutes, shiftOpen, busy, highlighted, actions }: Props) {
  const { t, i18n } = useTranslation();
  const platform = t(`online.platform.${card.platform}`);
  const [minutes, setMinutes] = useState(() => defaultPromise(card, defaultPrepMinutes));
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const FulfilmentIcon = FULFILMENT_ICON[card.fulfilment];
  const isIssue = card.lane === 'ISSUE';
  const tone = isIssue ? 'error.main' : card.late ? 'error.main' : card.lane === 'NEW' ? 'primary.main' : card.lane === 'READY' ? 'success.main' : 'divider';

  const timer = (() => {
    if (card.lane === 'NEW') {
      const left = minutesUntil(card.answerBy, now);
      return (
        <Chip
          size="small"
          color={left <= 1 ? 'error' : left <= 2 ? 'warning' : 'default'}
          variant={left <= 1 ? 'filled' : 'outlined'}
          label={left > 0 ? t('online.timer.answerIn', { count: left }) : t('online.timer.answerNow')}
        />
      );
    }
    if (!card.promisedAt || isIssue) return null;
    if (card.late) {
      const late = minutesSince(card.promisedAt, now);
      return (
        <Chip
          size="small"
          color="error"
          label={late >= 120 ? t('online.timer.lateHours', { count: Math.floor(late / 60) }) : t('online.timer.late', { count: late })}
        />
      );
    }
    return (
      <Chip
        size="small"
        variant="outlined"
        label={t(card.fulfilment === 'OWN_COURIER' ? 'online.timer.deliverBy' : 'online.timer.readyBy', {
          time: clockTime(card.promisedAt, i18n.language),
        })}
      />
    );
  })();

  const riderLine =
    card.riderStatus && card.fulfilment === 'PLATFORM_RIDER' ? (
      <Typography
        variant="caption"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          fontWeight: card.riderStatus === 'AT_RESTAURANT' ? 700 : 400,
          color: card.riderStatus === 'AT_RESTAURANT' ? 'warning.dark' : 'text.secondary',
        }}
      >
        <TwoWheelerIcon sx={{ fontSize: 16 }} />
        {t(`online.rider.${card.riderStatus}`, { name: card.riderName || t('online.rider.someone'), defaultValue: card.riderStatus })}
      </Typography>
    ) : null;

  const step = (delta: number) =>
    setMinutes((current) => Math.max(5, Math.min(card.maxPromiseMinutes, current + delta)));

  const primary = (() => {
    switch (card.lane) {
      case 'NEW':
        return (
          <Stack spacing={0.75}>
            <ButtonGroup fullWidth variant="contained" disabled={busy || !shiftOpen} aria-label={t('online.accept', { count: minutes })}>
              <Button sx={{ flex: '0 0 44px' }} onClick={() => step(-5)} disabled={busy || !shiftOpen || minutes <= 5}>
                −5
              </Button>
              <Button sx={{ fontWeight: 700, whiteSpace: 'nowrap' }} onClick={() => actions.accept(card, minutes)}>
                {t('online.accept', { count: minutes })}
              </Button>
              <Button sx={{ flex: '0 0 44px' }} onClick={() => step(5)} disabled={busy || !shiftOpen || minutes >= card.maxPromiseMinutes}>
                +5
              </Button>
            </ButtonGroup>
            {!shiftOpen && (
              <Typography variant="caption" color="error.main">
                {t('online.noShiftShort')}
              </Typography>
            )}
            <Stack direction="row" spacing={1}>
              <Button size="small" color="error" disabled={busy} onClick={() => actions.reject(card)}>
                {t('online.reject')}
              </Button>
              <Button size="small" color="inherit" onClick={() => actions.details(card)}>
                {t('online.details')}
              </Button>
            </Stack>
          </Stack>
        );
      case 'PREPARING':
        return (
          <Button fullWidth variant="contained" color="primary" disabled={busy} onClick={() => actions.ready(card)}>
            {t('online.ready')}
          </Button>
        );
      case 'READY':
        if (card.fulfilment === 'OWN_COURIER') {
          return (
            <Button fullWidth variant="contained" color="success" disabled={busy} onClick={() => actions.sendOut(card)}>
              {t('online.sendOut')}
            </Button>
          );
        }
        if (card.fulfilment === 'PICKUP') {
          return (
            <Button fullWidth variant="contained" color="success" disabled={busy} onClick={() => actions.handOver(card)}>
              {owesMoney(card) ? t('online.collectAndHandOver', { amount: formatCardTotal(card, card.collectAmount) }) : t('online.collected')}
            </Button>
          );
        }
        return (
          <Button fullWidth variant="contained" color="success" disabled={busy} onClick={() => actions.handOver(card)}>
            {t('online.handedToRider')}
          </Button>
        );
      case 'ISSUE':
        return card.issue === 'WITH_SUPPORT' ? null : (
          <Button fullWidth variant="contained" color="error" disabled={busy} onClick={() => actions.seen(card)}>
            {t('online.gotIt')}
          </Button>
        );
      default:
        return null;
    }
  })();

  const canReport = card.reportReasons.length > 0;
  // A rider order can also go straight from the kitchen; an own-courier one goes out from Dispatch.
  const canHandOverNow = card.lane === 'PREPARING' && card.fulfilment !== 'OWN_COURIER';

  return (
    <Card
      variant="outlined"
      data-online-card={card.id}
      sx={{
        p: 1.5,
        borderInlineStart: 4,
        borderInlineStartColor: tone,
        boxShadow: highlighted ? (theme) => `0 0 0 2px ${theme.palette.primary.main}` : undefined,
        bgcolor: isIssue ? 'error.lighter' : 'background.paper',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1 }}>
        <Tooltip title={platform}>
          <Avatar alt={platform} src={PLATFORM_LOGO[card.platform]} sx={{ width: 24, height: 24 }} />
        </Tooltip>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
          {card.displayCode}
        </Typography>
        {card.callNumber != null && (
          <Chip size="small" label={`#${card.callNumber}`} sx={{ fontWeight: 700 }} />
        )}
        <Box sx={{ flexGrow: 1 }} />
        {card.lane !== 'NEW' && (
          <IconButton size="small" aria-label={t('online.moreActions')} onClick={(e) => setMenuAnchor(e.currentTarget)}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        )}
      </Stack>

      {isIssue && (
        <Typography variant="body2" sx={{ color: 'error.dark', fontWeight: 600, mb: 1 }}>
          {t(`online.issue.${card.issue}`, { platform, text: card.issueText || '' })}
        </Typography>
      )}

      <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
        {timer}
        <Chip
          size="small"
          variant="outlined"
          icon={<FulfilmentIcon sx={{ fontSize: 16 }} />}
          label={t(`online.fulfilment.${card.fulfilment}`, { platform })}
        />
        {/* A cancelled or lost order owes nothing to anyone; its money chip would mislead. */}
        {(!isIssue || card.issue === 'WITH_SUPPORT') &&
          (owesMoney(card) ? (
            <Chip size="small" color="warning" label={t('online.collect', { amount: formatCardTotal(card, card.collectAmount) })} />
          ) : (
            <Chip size="small" color="success" variant="outlined" label={t('online.paidOnline')} />
          ))}
      </Stack>

      <Typography variant="body2" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', mb: 0.5 }}>
        {itemsSummary(card, i18n.language)}
      </Typography>
      {(card.customerName || card.note) && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }} noWrap>
          {[card.customerName, card.note && `«${card.note}»`].filter(Boolean).join(' · ')}
        </Typography>
      )}
      {riderLine}

      {primary && <Box sx={{ mt: 1.25 }}>{primary}</Box>}

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        {canHandOverNow && (
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              actions.handOver(card);
            }}
          >
            {card.fulfilment === 'PICKUP' ? t('online.collected') : t('online.handedToRider')}
          </MenuItem>
        )}
        {canReport && (
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              actions.report(card);
            }}
          >
            {t('online.report', { platform })}
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            actions.details(card);
          }}
        >
          {t('online.details')}
        </MenuItem>
      </Menu>
    </Card>
  );
}
