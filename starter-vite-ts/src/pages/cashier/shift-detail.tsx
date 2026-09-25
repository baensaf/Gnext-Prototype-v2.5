import type { Terminal } from 'src/api/tenantApi';
import type { CashMovement, ShiftStatement } from 'src/api/shiftApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';

import RefreshIcon from '@mui/icons-material/Refresh';
import HistoryIcon from '@mui/icons-material/History';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import {
  Box,
  Card,
  Grid,
  Chip,
  Stack,
  Table,
  Alert,
  Button,
  Divider,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Container,
  Typography,
  IconButton,
  CardHeader,
  CardContent,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyLabel } from 'src/utils/currency';
import { fDate , fTime, fDateTime } from 'src/utils/format-time';

import { shiftApi } from 'src/api/shiftApi';
import { tenantApi } from 'src/api/tenantApi';
import { useBranchContext } from 'src/contexts/branch-context';

// ----------------------------------------------------------------------

function Line({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
      <Typography variant={strong ? 'subtitle2' : 'body2'} color={strong ? 'text.primary' : 'text.secondary'}>
        {label}
      </Typography>
      <Typography variant={strong ? 'subtitle2' : 'body2'} sx={{ fontWeight: 600, color }} dir="ltr">
        {value}
      </Typography>
    </Stack>
  );
}

/**
 * One shift's statement: where the drawer's cash came from and went, what it should have
 * held and what was counted. Read-only — a shift is worked on the Shifts page or at its
 * register. While the shift is open a cashier sees it blind, as the count will be.
 */
export function ShiftDetailPage() {
  const currencyLabel = useCurrencyLabel();
  const params = useParams<{ id?: string; shiftId?: string }>();
  const id = params.id || params.shiftId;
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { branches } = useBranchContext();
  // Head office arrives from the chain roll-up, and has no branch Shifts page to go back to.
  const [searchParams] = useSearchParams();
  const backPath = searchParams.get('from') === 'rollup' ? '/app/cashier/rollup' : '/app/cashier/shifts';

  const [statement, setStatement] = useState<ShiftStatement | null>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatement = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const stmt = await shiftApi.getShiftStatement(id);
      setStatement(stmt);
      const terms = await tenantApi.getTerminals(stmt.branchId).catch(() => [] as Terminal[]);
      setTerminal(terms.find((x) => x.id === stmt.terminalId) || null);
    } catch (err: any) {
      setError(err.detail || err.message || t('shift.detail.loadError', 'Failed to load the shift'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    fetchStatement();
  }, [fetchStatement]);

  const movementLabel = (type: CashMovement['type']) =>
    ({
      OPENING_FLOAT: t('shift.movementTypes.OPENING_FLOAT', 'Opening float'),
      CASH_PAYMENT: t('shift.movementTypes.CASH_PAYMENT', 'Cash sale'),
      CASH_REFUND: t('shift.movementTypes.CASH_REFUND', 'Cash refund'),
      PAID_IN: t('shift.movementTypes.PAID_IN', 'Pay in'),
      PAID_OUT: t('shift.movementTypes.PAID_OUT', 'Pay out'),
      SAFE_DROP: t('shift.movementTypes.SAFE_DROP', 'Safe drop'),
      CLOSE_ADJUSTMENT: t('shift.movementTypes.CLOSE_ADJUSTMENT', 'Difference at count'),
    })[type] || type;

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error || !statement) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(backPath)} sx={{ mb: 2 }}>
          {t('common.back', 'Back')}
        </Button>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || t('cashier.shiftNotFound', 'Shift not found')}
        </Alert>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchStatement}>
          {t('common.retry', 'Retry')}
        </Button>
      </Container>
    );
  }

  const closed = statement.state === 'CLOSED';
  const blind = !!statement.blind;
  const variance = statement.shortOver || '0';
  const branchName = branches.find((b) => b.id === statement.branchId)?.name || '';
  const registerLabel = terminal ? `${terminal.name} (${terminal.code})` : statement.terminalId.slice(0, 8);
  const stamp = (value?: string | null) => (value ? fDateTime(value) : '—');

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack
        sx={{ flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 2, mb: 3 }}
      >
        <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(backPath)}>
            {t('common.back', 'Back')}
          </Button>
          <Box>
            <Typography variant="h4">
              {t('shift.detail.title', 'Shift statement')} <span dir="ltr">#{statement.shiftNumber}</span>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {registerLabel} · {branchName} · <span dir="ltr">{fDate(statement.businessDate)}</span>
            </Typography>
          </Box>
        </Stack>
        <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
          <Chip
            label={
              closed
                ? t('shift.state.closed', 'Closed')
                : statement.state === 'CLOSING_REVIEW'
                  ? t('shift.state.closingReview', 'In review')
                  : t('shift.state.open', 'Open')
            }
            color={closed ? 'default' : 'success'}
          />
          <IconButton onClick={fetchStatement} title={t('common.refresh', 'Refresh')}>
            <RefreshIcon />
          </IconButton>
        </Stack>
      </Stack>

      {blind && (
        <Alert severity="info" sx={{ mb: 3 }}>
          {t('shift.detail.blind', 'Sales, refunds and what the drawer should hold are shown once the shift has been counted down.')}
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardHeader avatar={<PointOfSaleIcon color="primary" />} title={t('shift.detail.cash', 'Drawer cash')} />
            <Divider />
            <CardContent>
              <Stack spacing={1.5}>
                <Line label={t('cashier.openingFloat', 'Opening Float')} value={MoneyUtil.formatCurrency(statement.openingFloat)} />
                <Line label={t('shift.close.cashSales', 'Cash sales')} value={blind ? '—' : `+${MoneyUtil.formatCurrency(statement.cashSales)}`} />
                <Line label={t('shift.close.cashRefunds', 'Cash refunds')} value={blind ? '—' : `-${MoneyUtil.formatCurrency(statement.cashRefunds)}`} />
                <Line label={t('shift.movement.paidIn', 'Pay in')} value={`+${MoneyUtil.formatCurrency(statement.paidIn)}`} />
                <Line label={t('shift.movement.paidOut', 'Pay out')} value={`-${MoneyUtil.formatCurrency(statement.paidOut)}`} />
                <Line label={t('shift.movement.safeDrop', 'Safe drop')} value={`-${MoneyUtil.formatCurrency(statement.safeDrops)}`} />
                <Divider />
                <Line
                  strong
                  label={t('cashier.expectedCash', 'Expected Cash')}
                  value={blind ? '—' : MoneyUtil.formatCurrency(statement.expectedCash)}
                />
                <Line
                  label={t('shift.close.countedLabel', 'Counted')}
                  value={closed ? MoneyUtil.formatCurrency(statement.actualCash) : t('shift.detail.notCounted', 'Not counted yet')}
                />
                {closed && (
                  <Line
                    strong
                    label={t('shift.close.variance', 'Over / short')}
                    value={MoneyUtil.formatCurrency(variance)}
                    color={MoneyUtil.isZero(variance) ? undefined : MoneyUtil.greaterThan(variance, '0') ? 'info.main' : 'error.main'}
                  />
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardHeader avatar={<ReceiptLongIcon color="info" />} title={t('shift.detail.shift', 'Shift')} />
            <Divider />
            <CardContent>
              <Stack spacing={1.5}>
                <Line label={t('shift.register', 'Register')} value={registerLabel} />
                <Line label={t('cashier.branch', 'Branch')} value={branchName || '—'} />
                <Line label={t('shift.detail.openedAt', 'Opened')} value={stamp(statement.openedAt)} />
                <Line label={t('shift.detail.closedAt', 'Closed')} value={closed ? stamp(statement.closedAt) : '—'} />
                <Line label={t('shift.detail.orders', 'Orders rung up')} value={String(statement.orderCount)} />
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Card>
            <CardHeader avatar={<HistoryIcon color="action" />} title={t('shift.detail.movements', 'Cash movements')} />
            <Divider />
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('shift.detail.time', 'Time')}</TableCell>
                    <TableCell>{t('shift.detail.movement', 'Movement')}</TableCell>
                    <TableCell align="right">{t('shift.movement.amount', 'Amount ({{currency}})', { currency: currencyLabel })}</TableCell>
                    <TableCell>{t('shift.detail.reason', 'Reason / reference')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {statement.movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell dir="ltr">{fTime(m.posted_at)}</TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label={movementLabel(m.type)} />
                      </TableCell>
                      <TableCell
                        align="right"
                        dir="ltr"
                        sx={{ fontWeight: 600, color: MoneyUtil.lessThan(m.amount, '0') ? 'error.main' : 'success.main' }}
                      >
                        {MoneyUtil.formatCurrency(m.amount)}
                      </TableCell>
                      <TableCell>{m.reason_text || m.reference || '—'}</TableCell>
                    </TableRow>
                  ))}
                  {statement.movements.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                        {t('cashier.noMovements', 'No cash movements recorded in this shift yet.')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}

export default ShiftDetailPage;
