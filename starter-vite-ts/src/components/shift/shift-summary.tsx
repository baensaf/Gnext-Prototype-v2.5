import type { ButtonProps } from '@mui/material';
import type { ShiftSalesSummary } from 'src/api/shiftApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import {
  Box,
  Alert,
  Stack,
  Dialog,
  Button,
  Divider,
  IconButton,
  Typography,
  DialogTitle,
  DialogActions,
  DialogContent,
  CircularProgress,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyLabel } from 'src/utils/currency';
import { fTime, fDateTime } from 'src/utils/format-time';

import { shiftApi } from 'src/api/shiftApi';

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
 * What the register did in this shift, on screen: orders by type, money taken by kind of
 * payment, refunds and the drawer. A cashier reads it before closing to check the card
 * terminal's slip against it. Under a blind count the cash and the sales total stay hidden
 * until the drawer is counted, as on the shift statement.
 */
export function ShiftSummaryDialog({ open, onClose, shiftId }: { open: boolean; onClose: () => void; shiftId: string }) {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();
  const [summary, setSummary] = useState<ShiftSalesSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await shiftApi.getSummary(shiftId));
    } catch (err: any) {
      setError(err?.detail || err?.message || t('shift.summary.loadError', 'Could not load the shift summary'));
    } finally {
      setLoading(false);
    }
  }, [shiftId, t]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const money = (value: string | null) => (value === null ? '—' : MoneyUtil.formatCurrency(value));
  const minus = (value: string | null) => (value === null ? '—' : `-${MoneyUtil.formatCurrency(value)}`);
  const positive = (value: string | null) => value !== null && MoneyUtil.greaterThan(value, '0');

  const renderBody = (s: ShiftSalesSummary) => {
    const c = s.cash;
    const variance = c.shortOver || '0';
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
            <Line
              key={p.kind}
              label={`${t(`shift.summary.methods.${p.kind}`, p.kind)} (${p.count})`}
              value={money(p.amount)}
            />
          ))}
          {s.refundCount > 0 && (
            <Line label={`${t('shift.summary.refunds', 'Refunds')} (${s.refundCount})`} value={minus(s.refundTotal)} />
          )}
        </Section>

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
            </>
          )}
        </Section>
        <Typography variant="caption" color="text.secondary">
          {t('shift.summary.amountsIn', 'Amounts in {{currency}}', { currency })}
        </Typography>
      </Stack>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {t('shift.summary.title', 'Shift summary')}
        <IconButton onClick={load} disabled={loading} title={t('common.refresh', 'Refresh')}>
          <RefreshIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error">{error}</Alert>}
        {!error && !summary && (
          <Stack sx={{ alignItems: 'center', py: 4 }}>
            <CircularProgress />
          </Stack>
        )}
        {!error && summary && renderBody(summary)}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          {t('common.close', 'Close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Opens the shift summary. */
export function ShiftSummaryButton({ shiftId, ...other }: { shiftId: string } & Omit<ButtonProps, 'onClick'>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<ReceiptLongIcon />}
        onClick={() => setOpen(true)}
        {...other}
        sx={[{ whiteSpace: 'nowrap', flexShrink: 0 }, ...(Array.isArray(other.sx) ? other.sx : [other.sx])]}
      >
        {t('shift.summary.open', 'Shift summary')}
      </Button>
      <ShiftSummaryDialog open={open} onClose={() => setOpen(false)} shiftId={shiftId} />
    </>
  );
}
