import type { DayCloseOpenOrder, DayCloseOpenOrders } from 'src/api/shiftApi';

import { useTranslation } from 'react-i18next';

import {
  Box,
  Chip,
  Link,
  Stack,
  Alert,
  Checkbox,
  TextField,
  Typography,
  CircularProgress,
  FormControlLabel,
} from '@mui/material';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { fDate } from 'src/utils/format-time';

// ----------------------------------------------------------------------

const ISSUE_FALLBACK: Record<string, string> = {
  UNPAID: 'Unpaid',
  NOT_SUBMITTED: 'Draft, never sent',
  AWAITING_ACCEPTANCE: 'Waiting for acceptance',
  DELIVERY_NOT_FINISHED: 'Delivery not finished',
};

/** One open order, linked to where it can be settled. */
export function OpenOrderLine({ order }: { order: DayCloseOpenOrder }) {
  const { t } = useTranslation();
  const href =
    order.issue === 'AWAITING_ACCEPTANCE'
      ? `${paths.app.orders.incoming}?order=${order.id}`
      : paths.app.orders.detail(order.id);
  const amount = order.issue === 'UNPAID' ? order.outstandingTotal : order.grandTotal;

  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1, py: 0.75, flexWrap: 'wrap' }}>
      <Link component={RouterLink} href={href} target="_blank" rel="noopener" variant="subtitle2" dir="ltr">
        {order.orderNumber}
      </Link>
      <Typography variant="caption" color="text.secondary">
        {order.tableNumber ? `${order.orderType} · ${order.tableNumber}` : order.orderType} ·{' '}
        <span dir="ltr">{fDate(order.businessDate)}</span>
      </Typography>
      <Box sx={{ flexGrow: 1 }} />
      {order.issue && (
        <Chip
          size="small"
          color="warning"
          variant="outlined"
          label={t(`cashier.openOrders.issue.${order.issue}`, ISSUE_FALLBACK[order.issue])}
        />
      )}
      <Typography variant="body2" dir="ltr">
        {Number(amount || 0).toLocaleString()} IRR
      </Typography>
    </Stack>
  );
}

type Props = {
  openOrders: DayCloseOpenOrders | null;
  loading: boolean;
  carryOver: boolean;
  onCarryOverChange: (value: boolean) => void;
  carryOverReason: string;
  onCarryOverReasonChange: (value: string) => void;
};

/**
 * What closing a branch's day does with its open orders: the paid ones it completes, and the
 * ones that wait on a decision unless they are carried over with a reason.
 */
export function DayCloseOrders({
  openOrders,
  loading,
  carryOver,
  onCarryOverChange,
  carryOverReason,
  onCarryOverReasonChange,
}: Props) {
  const { t } = useTranslation();
  const toComplete = openOrders?.toComplete ?? [];
  const needsDecision = openOrders?.needsDecision ?? [];

  if (loading) {
    return (
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">
          {t('cashier.openOrders.checking', 'Checking open orders…')}
        </Typography>
      </Stack>
    );
  }

  return (
    <>
      {openOrders && toComplete.length === 0 && needsDecision.length === 0 && (
        <Alert severity="success">{t('cashier.openOrders.noneOpen', 'No orders are left open for this day.')}</Alert>
      )}

      {toComplete.length > 0 && (
        <Box>
          <Typography variant="subtitle2">
            {t('cashier.openOrders.toComplete', '{{count}} paid order(s) will be marked completed', {
              count: toComplete.length,
            })}
          </Typography>
          <Box sx={{ maxHeight: 180, overflowY: 'auto' }}>
            {toComplete.map((order) => (
              <OpenOrderLine key={order.id} order={order} />
            ))}
          </Box>
        </Box>
      )}

      {needsDecision.length > 0 && (
        <Box>
          <Alert severity="warning" sx={{ mb: 1 }}>
            <Typography variant="subtitle2">
              {t('cashier.openOrders.needsDecision', '{{count}} order(s) need a decision before the day closes', {
                count: needsDecision.length,
              })}
            </Typography>
            <Typography variant="body2">
              {t(
                'cashier.openOrders.needsDecisionHelp',
                'Take the payment, cancel, or finish the delivery for each, or carry them over to the next day with a reason.'
              )}
            </Typography>
          </Alert>
          <Box sx={{ maxHeight: 220, overflowY: 'auto' }}>
            {needsDecision.map((order) => (
              <OpenOrderLine key={order.id} order={order} />
            ))}
          </Box>
          <FormControlLabel
            sx={{ mt: 1 }}
            control={<Checkbox checked={carryOver} onChange={(e) => onCarryOverChange(e.target.checked)} />}
            label={t('cashier.openOrders.carryOver', 'Close anyway and carry these orders over')}
          />
          {carryOver && (
            <TextField
              label={t('cashier.openOrders.carryOverReason', 'Why they are carried over')}
              value={carryOverReason}
              onChange={(e) => onCarryOverReasonChange(e.target.value)}
              multiline
              rows={2}
              fullWidth
              required
              sx={{ mt: 1 }}
            />
          )}
        </Box>
      )}
    </>
  );
}
