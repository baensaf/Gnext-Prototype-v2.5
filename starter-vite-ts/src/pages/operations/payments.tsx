import type { PaymentListRow } from 'src/api/paymentApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Box,
  Chip,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  TableContainer,
  TablePagination,
} from '@mui/material';

import { moneyUnit } from 'src/utils/currency';
import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';

import { paymentApi } from 'src/api/paymentApi';
import { useScopedBranchId } from 'src/contexts/branch-context';

const PAGE_SIZES = [25, 50, 100];

/**
 * The money taken at this branch, newest first. Only a list to read: the card terminals are
 * set up under Settings → Card terminals, and the bank accounts they settle into under
 * Settings → Payments & refunds.
 */
export function PaymentsPage() {
  const { t, i18n } = useTranslation();
  const [branchId] = useScopedBranchId();

  const [rows, setRows] = useState<PaymentListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await paymentApi.listPayments({ branchId: branchId || undefined, page: page + 1, limit: pageSize });
      setRows(res.data);
      setTotal(res.total);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('payments.loadError', 'Could not load the payments'));
    }
  }, [branchId, page, pageSize, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Another branch is another list, from its first page.
  useEffect(() => {
    setPage(0);
  }, [branchId]);

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('payments.title', 'Payments')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('payments.subtitle', 'Every payment taken at this branch.')}
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
          {t('monitoring.refresh', 'Refresh')}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('payments.columnPaymentNumber', 'Payment Number')}</TableCell>
              <TableCell>{t('payments.columnOrder', 'Order No')}</TableCell>
              <TableCell>{t('payments.columnMethod', 'Method')}</TableCell>
              <TableCell>{t('payments.columnAmount', 'Amount')}</TableCell>
              <TableCell>{t('payments.columnReference', 'Reference / RRN')}</TableCell>
              <TableCell>{t('payments.columnStatus', 'Status')}</TableCell>
              <TableCell>{t('payments.columnDate', 'Timestamp')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                    {t('grid.noRowsLabel', 'هیچ تراکنش پرداختی ثبت نشده است.')}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell><code>{tx.payment_number}</code></TableCell>
                  <TableCell><code>{tx.order_number}</code></TableCell>
                  <TableCell><Chip label={tx.method_kind} size="small" variant="outlined" /></TableCell>
                  <TableCell>
                    <strong dir="ltr">{MoneyUtil.formatCurrency(tx.amount)} {moneyUnit(tx.currency_code, i18n.language)}</strong>
                  </TableCell>
                  <TableCell><code>{tx.reference || '-'}</code></TableCell>
                  <TableCell>
                    <Chip
                      label={tx.status}
                      color={tx.status === 'SUCCEEDED' ? 'success' : tx.status === 'FAILED' ? 'error' : 'warning'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell dir="ltr">{fDateTime(tx.posted_at || tx.initiated_at)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, next) => setPage(next)}
          rowsPerPage={pageSize}
          rowsPerPageOptions={PAGE_SIZES}
          onRowsPerPageChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
        />
      </TableContainer>
    </Box>
  );
}
