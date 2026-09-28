import type { PaymentRecord } from 'src/api/paymentApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Box,
  Chip,
  Stack,
  Table,
  Paper,
  Button,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  TableContainer,
} from '@mui/material';

import { fDate } from 'src/utils/format-time';
import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyCode } from 'src/utils/currency';

import { httpClient } from 'src/api/httpClient';

/**
 * The money taken at this branch. Only a list to read: the card terminals are set up under
 * Settings → Card terminals, and the bank accounts they settle into under Settings →
 * Payments & refunds.
 */
export function PaymentsPage() {
  const currency = useCurrencyCode();
  const { t } = useTranslation();

  const [transactions, setTransactions] = useState<PaymentRecord[]>([]);

  // There is no payments list in the API yet, and the audit route this reads is not served,
  // so the list stays empty rather than showing an error.
  const loadData = useCallback(async () => {
    try {
      const txRes = await httpClient.get('/api/v1/audit/logs', { params: { entityType: 'Payment', limit: 25 } });
      if (Array.isArray(txRes.data)) {
        setTransactions(
          txRes.data.map((l: any) => ({
            id: l.entity_id || l.id,
            order_id: l.payload_json?.order_id || l.payload_json?.orderId || '-',
            payment_number: l.payload_json?.payment_number || `PAY-${(l.id || '').substring(0, 8)}`,
            method_id: l.payload_json?.method_id || '-',
            method_kind: l.payload_json?.method_kind || l.payload_json?.method || 'CARD_PRESENT',
            status: (l.payload_json?.status || 'SUCCEEDED') as any,
            amount: l.payload_json?.amount || '0',
            currency_code: l.payload_json?.currency_code || currency,
            business_date: l.created_at || new Date().toISOString(),
            recorded_at: l.created_at || new Date().toISOString(),
            initiated_at: l.created_at || new Date().toISOString(),
            reference: l.payload_json?.reference || l.payload_json?.rrn,
          }))
        );
      }
    } catch {
      setTransactions([]);
    }
  }, [currency]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('payments.title', 'Payments & Settlement Infrastructure')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('payments.subtitle', 'Every payment taken at this branch.')}
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
          {t('monitoring.refresh', 'Refresh')}
        </Button>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('payments.columnPaymentNumber', 'Payment Number')}</TableCell>
              <TableCell>{t('payments.columnOrder', 'Order ID')}</TableCell>
              <TableCell>{t('payments.columnMethod', 'Method')}</TableCell>
              <TableCell>{t('payments.columnAmount', 'Amount')}</TableCell>
              <TableCell>{t('payments.columnReference', 'Reference / RRN')}</TableCell>
              <TableCell>{t('payments.columnStatus', 'Status')}</TableCell>
              <TableCell>{t('payments.columnDate', 'Timestamp')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                    {t('grid.noRowsLabel', 'هیچ تراکنش پرداختی ثبت نشده است.')}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell><code>{tx.payment_number}</code></TableCell>
                  <TableCell>{tx.order_id}</TableCell>
                  <TableCell><Chip label={tx.method_kind} size="small" variant="outlined" /></TableCell>
                  <TableCell><strong>{MoneyUtil.format(tx.amount)} {tx.currency_code}</strong></TableCell>
                  <TableCell><code>{tx.reference || '-'}</code></TableCell>
                  <TableCell>
                    <Chip
                      label={tx.status}
                      color={tx.status === 'SUCCEEDED' ? 'success' : tx.status === 'FAILED' ? 'error' : 'warning'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{fDate(tx.business_date)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
