import type { DayCloseOpenOrder } from 'src/api/shiftApi';

import { useTranslation } from 'react-i18next';

import { Box, Chip, Link, Stack, Typography } from '@mui/material';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { fDate } from 'src/utils/format-time';
import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyLabel } from 'src/utils/currency';

// ----------------------------------------------------------------------

const ISSUE_FALLBACK: Record<string, string> = {
  UNPAID: 'Unpaid',
  AWAITING_ACCEPTANCE: 'Waiting for acceptance',
  DELIVERY_NOT_FINISHED: 'Delivery not finished',
  COURIER_SETTLEMENT: 'Waiting for courier settlement',
};

/** One order holding up a shift close, linked to where it can be settled. */
export function OpenOrderLine({ order }: { order: DayCloseOpenOrder }) {
  const currency = useCurrencyLabel();
  const { t } = useTranslation();
  const href =
    order.issue === 'AWAITING_ACCEPTANCE'
      ? `${paths.app.orders.incoming}?order=${order.id}`
      : paths.app.orders.detail(order.id);
  const amount = order.issue === 'UNPAID' ? order.outstandingTotal : order.grandTotal;
  const issue = order.awaitingCourier ? 'COURIER_SETTLEMENT' : order.issue;

  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1, py: 0.75, flexWrap: 'wrap' }}>
      <Link component={RouterLink} href={href} target="_blank" rel="noopener" variant="subtitle2" dir="ltr">
        {order.callNumber ? `#${order.callNumber}` : order.orderNumber}
      </Link>
      <Typography variant="caption" color="text.secondary">
        {order.callNumber ? (
          <>
            <span dir="ltr">{order.orderNumber}</span> ·{' '}
          </>
        ) : null}
        {order.orderType} ·{' '}
        <span dir="ltr">{fDate(order.businessDate)}</span>
      </Typography>
      <Box sx={{ flexGrow: 1 }} />
      {issue && (
        <Chip
          size="small"
          color="warning"
          variant="outlined"
          label={t(`cashier.openOrders.issue.${issue}`, ISSUE_FALLBACK[issue])}
        />
      )}
      <Typography variant="body2" dir="ltr">
        {MoneyUtil.formatCurrency(amount || 0)} {currency}
      </Typography>
    </Stack>
  );
}
