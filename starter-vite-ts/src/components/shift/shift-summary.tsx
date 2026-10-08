import type { ButtonProps } from '@mui/material';
import type { ShiftSalesSummary } from 'src/api/shiftApi';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { Box, Alert, Stack, Button, Divider, Typography } from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyLabel } from 'src/utils/currency';
import { fTime, fDateTime } from 'src/utils/format-time';

// ----------------------------------------------------------------------

const ORDER_TYPE_KEYS: Record<string, string> = {
  DINE_IN: 'orders.types.dineIn',
  TAKEAWAY: 'orders.types.takeaway',
  PICKUP: 'orders.types.pickup',
  DELIVERY: 'orders.types.delivery',
  AGGREGATOR: 'orders.types.aggregator',
};

function Line({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
      <Typography variant={strong ? 'subtitle2' : 'body2'} color={strong ? 'text.primary' : 'text.secondary'}>
        {label}
      </Typography>
      <Typography variant={strong ? 'subtitle2' : 'body2'} sx={{ fontWeight: 600, color }} dir="ltr">
        {value}
      </Typography>
    </Stack>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      <Stack spacing={0.75} sx={{ mt: 0.5 }}>
        {children}
      </Stack>
    </Box>
  );
}

/**
 * What the register did in a shift: orders by type, money taken by kind of payment, refunds by
 * how they went back, and the drawer. The End shift page shows it beside the steps, so the
 * cashier closes with the figures in view. Under a blind count the cash and the sales total
 * stay hidden until the drawer is counted, as on the shift statement.
 */
export function ShiftReport({ summary: s }: { summary: ShiftSalesSummary }) {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();

  const money = (value: string | null | undefined) =>
    value === null || value === undefined ? '—' : MoneyUtil.formatCurrency(value);
  const minus = (value: string | null | undefined) =>
    value === null || value === undefined ? '—' : `-${MoneyUtil.formatCurrency(value)}`;
  const positive = (value: string | null | undefined) =>
    value !== null && value !== undefined && MoneyUtil.greaterThan(value, '0');

  const c = s.cash;
  const variance = c.shortOver || '0';
  const refunds = s.refunds ?? [];

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="subtitle1">{s.registerName || ''}</Typography>
        <Typography variant="body2">
          {t('shift.bar.shift', 'Shift')} <span dir="ltr">#{s.shiftNumber}</span>
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {s.openedBy ? `${s.openedBy} · ` : ''}
          {t('shift.summary.openedAt', 'Opened {{time}}', { time: fDateTime(s.openedAt) })}
          {s.closed && s.closedAt ? ` · ${t('shift.summary.closedAt', 'Closed {{time}}', { time: fTime(s.closedAt) })}` : ''}
        </Typography>
      </Box>

      {s.blind && (
        <Alert severity="info">
          {t('shift.summary.blind', 'The sales total and the cash figures show once the drawer has been counted at close.')}
        </Alert>
      )}

      <Section title={t('shift.summary.orders', 'Orders')}>
        <Line label={t('shift.summary.orderCount', 'Orders sold')} value={String(s.orderCount)} />
        {s.byType.map((b) => (
          <Line
            key={b.type}
            label={`${ORDER_TYPE_KEYS[b.type] ? t(ORDER_TYPE_KEYS[b.type]) : b.type} (${b.count})`}
            value={b.total === null ? '' : money(b.total)}
          />
        ))}
        {s.cancelledCount > 0 && <Line label={t('shift.summary.cancelled', 'Cancelled')} value={String(s.cancelledCount)} />}
        {positive(s.discountTotal) && <Line label={t('shift.summary.discounts', 'Discounts')} value={minus(s.discountTotal)} />}
        {positive(s.deliveryFeeTotal) && <Line label={t('shift.summary.deliveryFees', 'Delivery fees')} value={money(s.deliveryFeeTotal)} />}
        {s.salesTotal !== null && <Line strong label={t('shift.summary.salesTotal', 'Total sales')} value={money(s.salesTotal)} />}
        {positive(s.unpaidTotal) && (
          <Line label={t('shift.summary.unpaid', 'Still unpaid')} value={money(s.unpaidTotal)} color="warning.main" />
        )}
      </Section>

      <Divider />

      <Section title={t('shift.summary.payments', 'Payments taken')}>
        {s.tenders.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('shift.summary.noPayments', 'No payments yet.')}
          </Typography>
        )}
        {s.tenders.map((p) => (
          <Line key={p.kind} label={`${t(`shift.summary.methods.${p.kind}`, p.kind)} (${p.count})`} value={money(p.amount)} />
        ))}
      </Section>

      {refunds.length > 0 && (
        <>
          <Divider />
          <Section title={t('shift.summary.refunds', 'Refunds')}>
            {refunds.map((r) => (
              <Line
                key={r.kind}
                label={`${t(`shift.summary.refundMethods.${r.kind}`, r.kind)} (${r.count})`}
                value={minus(r.amount)}
              />
            ))}
          </Section>
        </>
      )}

      <Divider />

      <Section title={t('shift.summary.drawer', 'Cash drawer')}>
        <Line label={t('cashier.openingFloat', 'Opening Float')} value={money(c.openingFloat)} />
        {c.cashSales !== null && <Line label={t('shift.close.cashSales', 'Cash sales')} value={money(c.cashSales)} />}
        {positive(c.cashRefunds) && <Line label={t('shift.close.cashRefunds', 'Cash refunds')} value={minus(c.cashRefunds)} />}
        {positive(c.paidIn) && <Line label={t('shift.movement.paidIn', 'Pay in')} value={money(c.paidIn)} />}
        {positive(c.paidOut) && <Line label={t('shift.movement.paidOut', 'Pay out')} value={minus(c.paidOut)} />}
        {positive(c.safeDrops) && <Line label={t('shift.movement.safeDrop', 'Safe drop')} value={minus(c.safeDrops)} />}
        {c.expectedCash !== null && <Line strong label={t('cashier.expectedCash', 'Expected Cash')} value={money(c.expectedCash)} />}
        {s.closed && (
          <>
            <Line label={t('shift.close.countedLabel', 'Counted')} value={money(c.actualCash)} />
            <Line
              strong
              label={t('shift.summary.difference', 'Difference')}
              value={money(variance)}
              color={MoneyUtil.isZero(variance) ? 'success.main' : 'error.main'}
            />
            {c.handedOver !== null && c.handedOver !== undefined && (
              <Line label={t('shift.end.handedOver', 'Handed over')} value={money(c.handedOver)} />
            )}
            {c.leftInDrawer !== null && c.leftInDrawer !== undefined && (
              <Line label={t('shift.end.leftInDrawer', 'Left in the drawer')} value={money(c.leftInDrawer)} />
            )}
          </>
        )}
      </Section>
      <Typography variant="caption" color="text.secondary">
        {t('shift.summary.amountsIn', 'Amounts in {{currency}}', { currency })}
      </Typography>
    </Stack>
  );
}

/** Opens the shift's End shift page, which is also its report while the shift runs. */
export function ShiftSummaryButton({ shiftId, ...other }: { shiftId: string } & Omit<ButtonProps, 'onClick'>) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Button
      variant="outlined"
      startIcon={<ReceiptLongIcon />}
      onClick={() => navigate(`/app/cashier/shifts/${shiftId}/end`)}
      {...other}
      sx={[{ whiteSpace: 'nowrap', flexShrink: 0 }, ...(Array.isArray(other.sx) ? other.sx : [other.sx])]}
    >
      {t('shift.summary.open', 'Shift summary')}
    </Button>
  );
}
