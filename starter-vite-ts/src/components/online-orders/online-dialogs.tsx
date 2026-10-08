import type { OnlineCard, OnlineRejectReason, OnlineReportReason } from 'src/api/onlineOrdersApi';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Radio from '@mui/material/Radio';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Divider from '@mui/material/Divider';
import TextField from '@mui/material/TextField';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import FormControlLabel from '@mui/material/FormControlLabel';

import { formatCardTotal } from 'src/contexts/incoming-orders-context';

import { owesMoney, minutesUntil } from './online-helpers';

// ----------------------------------------------------------------------

type RejectProps = {
  card: OnlineCard | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (card: OnlineCard, reason: OnlineRejectReason, comment: string) => void;
};

/** Turning an order down: one of the reasons the platform has a code for, and a note. */
export function RejectDialog({ card, busy, onClose, onConfirm }: RejectProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<OnlineRejectReason | ''>('');
  const [comment, setComment] = useState('');

  useEffect(() => {
    setReason('');
    setComment('');
  }, [card?.id]);

  if (!card) return null;
  const platform = t(`online.platform.${card.platform}`);

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth aria-keyshortcuts="Escape">
      <DialogTitle>{t('online.rejectDialog.title', { code: card.displayCode })}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('online.rejectDialog.hint', { platform })}
        </Typography>
        <RadioGroup value={reason} onChange={(e) => setReason(e.target.value as OnlineRejectReason)}>
          {card.rejectReasons.map((r) => (
            <FormControlLabel key={r} value={r} control={<Radio />} label={t(`online.rejectReason.${r}`)} />
          ))}
        </RadioGroup>
        <TextField
          fullWidth
          size="small"
          sx={{ mt: 2 }}
          label={t('online.rejectDialog.comment')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose} disabled={busy}>
          {t('online.close')}
        </Button>
        <Button variant="contained" color="error" disabled={!reason || busy} onClick={() => reason && onConfirm(card, reason, comment)}>
          {t('online.rejectDialog.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ----------------------------------------------------------------------

type ReportProps = {
  card: OnlineCard | null;
  busy: boolean;
  now: number;
  onClose: () => void;
  onConfirm: (card: OnlineCard, report: { reason: OnlineReportReason; extraMinutes?: number; comment?: string }) => void;
};

const EXTRA_MINUTES = [10, 15, 20, 30];

/**
 * After accepting: the order needs more time or cannot be made. With Snappfood this hands the
 * order to its support, who call the store and the customer; the kitchen keeps cooking.
 */
export function ReportDialog({ card, busy, now, onClose, onConfirm }: ReportProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<OnlineReportReason | ''>('');
  const [extra, setExtra] = useState<number>(15);
  const [comment, setComment] = useState('');

  useEffect(() => {
    setReason(card?.reportReasons.includes('MORE_TIME') ? 'MORE_TIME' : '');
    setExtra(15);
    setComment('');
  }, [card?.id, card?.reportReasons]);

  if (!card) return null;
  const platform = t(`online.platform.${card.platform}`);
  const left = card.reportUntil ? minutesUntil(card.reportUntil, now) : null;

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth aria-keyshortcuts="Escape">
      <DialogTitle>{t('online.reportDialog.title', { code: card.displayCode, platform })}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('online.reportDialog.hint', { platform })}
        </Typography>
        {left !== null && (
          <Typography variant="caption" color="warning.dark" sx={{ display: 'block', mb: 2 }}>
            {t('online.reportDialog.minutesLeft', { count: left })}
          </Typography>
        )}
        <RadioGroup value={reason} onChange={(e) => setReason(e.target.value as OnlineReportReason)}>
          {card.reportReasons.map((r) => (
            <FormControlLabel key={r} value={r} control={<Radio />} label={t(`online.reportReason.${r}`)} />
          ))}
        </RadioGroup>
        {reason === 'MORE_TIME' && (
          <Stack sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75 }}>
              {t('online.reportDialog.extraMinutes')}
            </Typography>
            <Stack direction="row" spacing={1}>
              {EXTRA_MINUTES.map((m) => (
                <Chip
                  key={m}
                  label={t('online.minutes', { count: m })}
                  color={extra === m ? 'primary' : 'default'}
                  variant={extra === m ? 'filled' : 'outlined'}
                  onClick={() => setExtra(m)}
                />
              ))}
            </Stack>
          </Stack>
        )}
        <TextField
          fullWidth
          size="small"
          sx={{ mt: 2 }}
          label={t('online.reportDialog.comment')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose} disabled={busy}>
          {t('online.close')}
        </Button>
        <Button
          variant="contained"
          color="warning"
          disabled={!reason || busy}
          onClick={() =>
            reason &&
            onConfirm(card, { reason, extraMinutes: reason === 'MORE_TIME' ? extra : undefined, comment: comment.trim() || undefined })
          }
        >
          {t('online.reportDialog.confirm', { platform })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ----------------------------------------------------------------------

type DetailsProps = { card: OnlineCard | null; onClose: () => void };

/** The whole order as the platform sent it: who, where, every line, what was paid. */
export function DetailsDialog({ card, onClose }: DetailsProps) {
  const { t } = useTranslation();
  if (!card) return null;
  const platform = t(`online.platform.${card.platform}`);

  const row = (label: string, value: string | null) =>
    value ? (
      <Stack direction="row" spacing={2} sx={{ py: 0.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 96 }}>
          {label}
        </Typography>
        <Typography variant="body2">{value}</Typography>
      </Stack>
    ) : null;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-keyshortcuts="Escape">
      <DialogTitle>{t('online.detailsDialog.title', { code: card.displayCode, platform })}</DialogTitle>
      <DialogContent>
        {card.issue && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {t(`online.issue.${card.issue}`, { platform, text: card.issueText || '' })}
          </Alert>
        )}
        {row(t('online.detailsDialog.customer'), card.customerName)}
        {row(t('online.detailsDialog.phone'), card.customerPhone)}
        {row(t('online.detailsDialog.address'), card.address)}
        {row(t('online.detailsDialog.note'), card.note)}
        {row(t('online.detailsDialog.fulfilment'), t(`online.fulfilment.${card.fulfilment}`, { platform }))}
        {row(
          t('online.detailsDialog.rider'),
          card.riderStatus ? t(`online.rider.${card.riderStatus}`, { name: card.riderName || t('online.rider.someone'), defaultValue: card.riderStatus }) : null
        )}
        <Divider sx={{ my: 1.5 }} />
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('online.detailsDialog.items')}
        </Typography>
        {card.items.map((item, index) => (
          <Typography key={index} variant="body2" sx={{ py: 0.25 }}>
            {item.quantity}× {item.name}
          </Typography>
        ))}
        <Divider sx={{ my: 1.5 }} />
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Typography variant="subtitle2">{t('online.detailsDialog.total')}</Typography>
          <Typography variant="subtitle2">{formatCardTotal(card)}</Typography>
        </Stack>
        <Typography variant="caption" color={owesMoney(card) ? 'warning.dark' : 'success.dark'}>
          {owesMoney(card) ? t('online.collect', { amount: formatCardTotal(card, card.collectAmount) }) : t('online.paidOnline')}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('online.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
