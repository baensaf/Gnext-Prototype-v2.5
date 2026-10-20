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

import { taraApi } from 'src/api/taraApi';
import { paymentApi } from 'src/api/paymentApi';
import { useScopedBranchId } from 'src/contexts/branch-context';

import { toast } from 'src/components/snackbar';

const PAGE_SIZES = [25, 50, 100];

/**
 * The money taken at this branch, newest first. Only a list to read: the card terminals are
 * set up under Settings → Card terminals, and the bank accounts they settle into under
 * Settings → Payment methods.
 */
export function PaymentsPage() {
  const { t, i18n } = useTranslation();
  const [branchId] = useScopedBranchId();

  const [rows, setRows] = useState<PaymentListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);

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

  /** Tara never answered this sale: ask it again now. */
  const checkTara = async (id: string) => {
    setChecking(id);
    try {
      const after = await taraApi.check(id);
      toast[after?.status === 'PROCESSING' ? 'warning' : 'success'](
        after?.status === 'PROCESSING' ? t('payments.taraStillWaiting') : t('payments.taraChecked')
      );
      await loadData();
    } catch (err: any) {
      toast.error(err?.detail || err?.message || t('payments.taraCheckFailed'));
    } finally {
      setChecking(null);
    }
  };

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
                    <strong><bdi dir="ltr">{MoneyUtil.formatCurrency(tx.amount)}</bdi> {moneyUnit(tx.currency_code, i18n.language)}</strong>
                  </TableCell>
                  <TableCell><code>{tx.reference || '-'}</code></TableCell>
                  <TableCell>
                    <Chip
                      label={
                        tx.tara_awaiting
                          ? t(tx.tara_stuck ? 'payments.taraStuck' : 'payments.taraWaiting')
                          : tx.status
                      }
                      color={tx.status === 'SUCCEEDED' ? 'success' : tx.status === 'FAILED' ? 'error' : 'warning'}
                      size="small"
                    />
                    {/* A Tara sale that never got an answer: a manager asks Tara again. */}
                    {tx.tara_awaiting && tx.tara_stuck && (
                      <Button size="small" sx={{ ml: 1 }} disabled={checking === tx.id} onClick={() => checkTara(tx.id)}>
                        {t('payments.taraCheck')}
                      </Button>
                    )}
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
