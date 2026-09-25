import type { TaxInvoice, TaxInvoiceStatus } from 'src/api/moadianApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { Box, Card, Chip, Stack, Alert, Button, Typography, CircularProgress } from '@mui/material';

import { RouterLink } from 'src/routes/components';

import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyCode } from 'src/utils/currency';

import { moadianApi } from 'src/api/moadianApi';

export const TAX_STATUS_COLOR: Record<TaxInvoiceStatus, 'warning' | 'info' | 'success' | 'error'> = {
  QUEUED: 'warning',
  PENDING: 'info',
  SUCCESS: 'success',
  FAILED: 'error',
};

export function useMoadianLabels() {
  const { t } = useTranslation();
  return {
    subject: (subject: number) => {
      if (subject === 3) return t('moadian.subject.cancellation', 'Cancellation');
      if (subject === 4) return t('moadian.subject.return', 'Return');
      return t('moadian.subject.original', 'Original');
    },
    status: (status: TaxInvoiceStatus) => t(`moadian.status.${status}`, status),
  };
}

/** The e-invoices behind one order: the original, and any cancellation or return after it. */
export function MoadianOrderPanel({ orderId, orderState }: { orderId: string; orderState: string }) {
  const currency = useCurrencyCode();
  const { t } = useTranslation();
  const labels = useMoadianLabels();
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await moadianApi.list({ orderId });
      setInvoices(res.items);
    } catch (err: any) {
      setError(err.detail || err.message || t('moadian.loadError', 'Failed to load Moadian e-invoices'));
    } finally {
      setLoading(false);
    }
  }, [orderId, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Follow an invoice through the simulated tax office while it is still in flight.
  const inFlight = invoices.some((inv) => inv.status === 'QUEUED' || inv.status === 'PENDING');
  useEffect(() => {
    if (!inFlight) return undefined;
    const timer = setInterval(() => {
      load();
    }, 4000);
    return () => clearInterval(timer);
  }, [inFlight, load]);

  const handleIssue = async () => {
    setBusy(true);
    setError(null);
    try {
      await moadianApi.issue(orderId);
      await load();
    } catch (err: any) {
      setError(err.detail || err.message || t('moadian.orderPanel.issueError', 'Could not issue the e-invoice'));
    } finally {
      setBusy(false);
    }
  };

  const hasOriginal = invoices.some((inv) => inv.subject === 1);

  let content: React.ReactNode;
  if (loading) {
    content = <CircularProgress size={24} />;
  } else if (invoices.length === 0) {
    content = (
      <Typography variant="body2" color="text.secondary">
        {orderState === 'COMPLETED'
          ? t('moadian.orderPanel.none', 'No e-invoice yet. Completed, paid orders are invoiced automatically while Moadian is on.')
          : t('moadian.orderPanel.notCompleted', 'An e-invoice is issued once the order is completed and paid.')}
      </Typography>
    );
  } else {
    content = (
      <Stack spacing={1.5}>
        {invoices.map((inv) => (
          <Box key={inv.id} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Stack sx={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
              <Chip size="small" variant="outlined" label={labels.subject(inv.subject)} />
              <Chip size="small" color={TAX_STATUS_COLOR[inv.status]} label={labels.status(inv.status)} />
              <Typography variant="body2" dir="ltr" sx={{ fontFamily: 'monospace' }}>
                {inv.tax_id}
              </Typography>
              <Box sx={{ flexGrow: 1 }} />
              <Typography variant="body2" dir="ltr">
                {MoneyUtil.formatCurrency(inv.total_amount)} {currency}
              </Typography>
            </Stack>
            {inv.errors?.map((e) => (
              <Typography key={e.code} variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                {e.code}: {e.message}
              </Typography>
            ))}
          </Box>
        ))}
      </Stack>
    );
  }

  return (
    <Card sx={{ p: 3 }}>
      <Stack sx={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
          <ReceiptLongIcon color="primary" />
          <Typography variant="h6">{t('moadian.orderPanel.title', 'Moadian e-invoice')}</Typography>
        </Stack>
        <Stack sx={{ flexDirection: 'row', gap: 1 }}>
          {!loading && !hasOriginal && orderState === 'COMPLETED' && (
            <Button variant="contained" size="small" onClick={handleIssue} disabled={busy}>
              {t('moadian.orderPanel.issue', 'Issue e-invoice')}
            </Button>
          )}
          <Button size="small" component={RouterLink} href="/app/moadian">
            {t('moadian.orderPanel.openAll', 'All e-invoices')}
          </Button>
        </Stack>
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {content}
    </Card>
  );
}
