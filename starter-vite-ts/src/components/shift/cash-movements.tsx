import type { CashMovement } from 'src/api/shiftApi';

import { useTranslation } from 'react-i18next';

import HistoryIcon from '@mui/icons-material/History';
import {
  Card,
  Chip,
  Table,
  Divider,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  CardHeader,
  TableContainer,
} from '@mui/material';

import { fTime } from 'src/utils/format-time';
import { MoneyUtil } from 'src/utils/money.util';
import { serverText } from 'src/utils/server-text';
import { useCurrencyLabel } from 'src/utils/currency';

// ----------------------------------------------------------------------

/** Every cash movement in a shift's drawer, in the order it happened. */
export function CashMovements({ movements }: { movements: CashMovement[] }) {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();

  const movementLabel = (type: CashMovement['type']) =>
    ({
      OPENING_FLOAT: t('shift.movementTypes.OPENING_FLOAT', 'Opening float'),
      CASH_PAYMENT: t('shift.movementTypes.CASH_PAYMENT', 'Cash sale'),
      CASH_REFUND: t('shift.movementTypes.CASH_REFUND', 'Cash refund'),
      PAID_IN: t('shift.movementTypes.PAID_IN', 'Courier over'),
      PAID_OUT: t('shift.movementTypes.PAID_OUT', 'Courier short'),
      CLOSE_ADJUSTMENT: t('shift.movementTypes.CLOSE_ADJUSTMENT', 'Difference at count'),
    })[type] || type;

  const ordered = [...movements].sort((a, b) => a.posted_at.localeCompare(b.posted_at));

  return (
    <Card sx={{ borderRadius: 2 }}>
      <CardHeader avatar={<HistoryIcon color="action" />} title={t('shift.detail.movements', 'Cash movements')} />
      <Divider />
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('shift.detail.time', 'Time')}</TableCell>
              <TableCell>{t('shift.detail.movement', 'Movement')}</TableCell>
              <TableCell align="right">{t('shift.movement.amount', 'Amount ({{currency}})', { currency })}</TableCell>
              <TableCell>{t('shift.detail.reason', 'Reason / reference')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ordered.map((m) => (
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
                <TableCell>{serverText(m.reason_text, t) || m.reference || '—'}</TableCell>
              </TableRow>
            ))}
            {ordered.length === 0 && (
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
  );
}
