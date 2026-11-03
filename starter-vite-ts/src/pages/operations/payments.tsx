import type { Payment, PaymentListRow } from 'src/api/paymentApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Box,
  Chip,
  Link,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Dialog,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  DialogContent,
  TableContainer,
  TablePagination,
} from '@mui/material';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { moneyUnit } from 'src/utils/currency';
import { MoneyUtil } from 'src/utils/money.util';
import { fDate, fDateTime } from 'src/utils/format-time';

import { taraApi } from 'src/api/taraApi';
import { paymentApi } from 'src/api/paymentApi';
import { useIsHeadOffice } from 'src/store/useAuthStore';
import { useScopedBranchId } from 'src/contexts/branch-context';

import { toast } from 'src/components/snackbar';
import { UnconfirmedChargeActions } from 'src/components/payment-terminal/unconfirmed-charge-actions';

const PAGE_SIZES = [25, 50, 100];

/**
 * The money taken at this branch, newest first. A list to read, but for a card charge the terminal
 * never answered: it stays on top, and the cashier settles it here from the slip (Y-11, Y-17). The
 * card terminals are set up under Settings → Card terminals, and the bank accounts they settle
 * into under Settings → Payment methods.
 */
export function PaymentsPage() {
  const { t, i18n } = useTranslation();
  const [branchId] = useScopedBranchId();
  const isHeadOffice = useIsHeadOffice();

  const [rows, setRows] = useState<PaymentListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [settling, setSettling] = useState<PaymentListRow | null>(null);

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

  const money = (tx: PaymentListRow) => `${MoneyUtil.formatCurrency(tx.amount)} ${moneyUnit(tx.currency_code, i18n.language)}`;

  const statusLabel = (tx: PaymentListRow) => {
    if (tx.tara_awaiting) return t(tx.tara_stuck ? 'payments.taraStuck' : 'payments.taraWaiting');
    if (tx.needs_terminal_check) return t('payments.unconfirmed.status');
    if (tx.status === 'SUCCEEDED') return t('payments.statusSucceeded');
    if (tx.status === 'FAILED') return t('payments.statusFailed');
    if (tx.status === 'PENDING' || tx.status === 'PROCESSING') return t('payments.statusPending');
    return tx.status;
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
              <TableCell>{t('payments.columnDate', 'Timestamp')}</TableCell>
              <TableCell>{t('payments.columnOrder', 'Order No')}</TableCell>
              <TableCell>{t('payments.columnMethod', 'Method')}</TableCell>
              <TableCell>{t('payments.columnAmount', 'Amount')}</TableCell>
              <TableCell>{t('payments.columnStatus', 'Status')}</TableCell>
              <TableCell>{t('payments.columnReference', 'Reference / RRN')}</TableCell>
              <TableCell>{t('payments.columnRegister', 'Register')}</TableCell>
              <TableCell>{t('payments.columnCashier', 'Cashier')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                    {t('grid.noRowsLabel', 'هیچ تراکنش پرداختی ثبت نشده است.')}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell><code>{tx.payment_number}</code></TableCell>
                  <TableCell>
                    <Box dir="ltr" sx={{ textAlign: 'start' }}>{fDateTime(tx.posted_at || tx.initiated_at)}</Box>
                    <Typography variant="caption" color="text.secondary">
                      {t('payments.businessDay', { date: fDate(tx.business_date) })}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Link component={RouterLink} href={paths.app.orders.detail(tx.order_id)} variant="subtitle2" dir="ltr">
                      {tx.call_number ? `#${tx.call_number}` : tx.order_number}
                    </Link>
                    {tx.call_number ? (
                      <Typography variant="caption" color="text.secondary" component="div" dir="ltr" sx={{ textAlign: 'start' }}>
                        {tx.order_number}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={tx.other_reader ? t('payments.otherReader') : t(`settings.paymentsPage.kinds.${tx.method_kind}`, tx.method_kind)}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <strong><bdi dir="ltr">{MoneyUtil.formatCurrency(tx.amount)}</bdi> {moneyUnit(tx.currency_code, i18n.language)}</strong>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={statusLabel(tx)}
                      color={tx.status === 'SUCCEEDED' ? 'success' : tx.status === 'FAILED' ? 'error' : 'warning'}
                      size="small"
                    />
                    {/* A Tara sale that never got an answer: a manager asks Tara again. */}
                    {tx.tara_awaiting && tx.tara_stuck && (
                      <Button size="small" sx={{ ml: 1 }} disabled={checking === tx.id} onClick={() => checkTara(tx.id)}>
                        {t('payments.taraCheck')}
                      </Button>
                    )}
                    {tx.needs_terminal_check && !isHeadOffice && (
                      <Button size="small" sx={{ ml: 1 }} onClick={() => setSettling(tx)}>
                        {t('payments.unconfirmed.confirm')}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell><code>{tx.reference || '-'}</code></TableCell>
                  <TableCell>{tx.register_name || '-'}</TableCell>
                  <TableCell>{tx.cashier_name || '-'}</TableCell>
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

      <Dialog open={!!settling} onClose={() => setSettling(null)} maxWidth="sm" fullWidth>
        <DialogContent>
          {settling && (
            <UnconfirmedChargeActions
              payment={settling as unknown as Payment}
              amountText={money(settling)}
              onChanged={() => {
                setSettling(null);
                loadData();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
