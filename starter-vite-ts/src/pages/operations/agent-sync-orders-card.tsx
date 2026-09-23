import type { SyncOrderRow } from 'src/api/agentsApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Card,
  Chip,
  Stack,
  Table,
  Alert,
  Button,
  Tooltip,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  CardHeader,
  IconButton,
  Typography,
  ToggleButton,
  TableContainer,
  ToggleButtonGroup,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';

import { agentsApi } from 'src/api/agentsApi';

import { toast, showErrorToast } from 'src/components/snackbar';

// ----------------------------------------------------------------------

/** Reasons an order is held rather than booked; everything else is a flag on a booked order. */
const HOLD_REASONS = new Set(['TOTAL_MISMATCH', 'PRICE_MISMATCH', 'ID_REUSED', 'SHIFT_UNKNOWN', 'INVALID_ORDER', 'PROCESSING_FAILED']);

type Props = { branchId?: string };

/**
 * Orders the branches took while offline and their agents uploaded later. Head office retries
 * the ones held back, once the cause is fixed, and marks the flagged ones as looked at.
 */
export function AgentSyncOrdersCard({ branchId }: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<'attention' | 'all'>('attention');
  const [rows, setRows] = useState<SyncOrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await agentsApi.listSyncOrders({ view, branchId }));
      setError(null);
    } catch (err: any) {
      setError(err?.detail || err?.message || t('operations.agents.syncOrders.loadError', 'Could not load offline orders'));
    }
  }, [view, branchId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const retry = async (row: SyncOrderRow) => {
    setBusy(row.id);
    try {
      const res = await agentsApi.retrySyncOrder(row.id);
      if (res.result === 'HELD') {
        toast.warning(t('operations.agents.syncOrders.stillHeld', 'Still held: {{reason}}', { reason: flagLabel(res.flags[0]) }));
      } else {
        toast.success(t('operations.agents.syncOrders.booked', 'Booked as {{number}}', { number: res.order_number }));
      }
      load();
    } catch (err: any) {
      showErrorToast(err, t('operations.agents.syncOrders.retryError', 'Could not retry the order'));
    } finally {
      setBusy(null);
    }
  };

  const review = async (row: SyncOrderRow) => {
    setBusy(row.id);
    try {
      await agentsApi.reviewSyncOrder(row.id);
      load();
    } catch (err: any) {
      showErrorToast(err, t('operations.agents.syncOrders.reviewError', 'Could not mark the order'));
    } finally {
      setBusy(null);
    }
  };

  const flagLabel = (flag?: string) => (flag ? t(`operations.agents.syncOrders.flag.${flag}`, flag) : '');

  return (
    <Card sx={{ mt: 3 }}>
      <CardHeader
        title={t('operations.agents.syncOrders.title', 'Offline orders')}
        subheader={t(
          'operations.agents.syncOrders.subtitle',
          'Orders a branch took while offline, uploaded by its agent. They are booked at the price charged; differences are flagged here.'
        )}
        action={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
              <ToggleButton value="attention">{t('operations.agents.syncOrders.viewAttention', 'Needs a look')}</ToggleButton>
              <ToggleButton value="all">{t('operations.agents.syncOrders.viewAll', 'All')}</ToggleButton>
            </ToggleButtonGroup>
            <IconButton onClick={load}>
              <RefreshIcon />
            </IconButton>
          </Stack>
        }
        sx={{ pb: 1 }}
      />
      {error && (
        <Alert severity="error" sx={{ mx: 2 }}>
          {error}
        </Alert>
      )}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('operations.agents.syncOrders.colReceived', 'Received')}</TableCell>
              <TableCell>{t('operations.agents.colBranch', 'Branch')}</TableCell>
              <TableCell>{t('operations.agents.syncOrders.colOrder', 'Order')}</TableCell>
              <TableCell align="right">{t('operations.agents.syncOrders.colTotal', 'Total')}</TableCell>
              <TableCell>{t('operations.agents.syncOrders.colResult', 'Result')}</TableCell>
              <TableCell align="right">{t('operations.agents.colActions', 'Actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    {view === 'attention'
                      ? t('operations.agents.syncOrders.nothingToLookAt', 'Nothing needs a look.')
                      : t('operations.agents.syncOrders.none', 'No offline orders yet.')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => {
              const held = row.status === 'HELD';
              const flagged = !held && row.flags.length > 0;
              return (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Typography variant="body2">{fDateTime(row.received_at)}</Typography>
                    {row.placed_at && (
                      <Typography variant="caption" color="text.secondary">
                        {t('operations.agents.syncOrders.placedAt', 'Taken {{time}}', { time: fDateTime(row.placed_at) })}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{row.branch_name || '—'}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                      {row.call_number ? <Chip size="small" color="primary" label={row.call_number} sx={{ fontWeight: 800 }} /> : null}
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                        {row.order_number || '—'}
                      </Typography>
                    </Stack>
                    {row.order_state && (
                      <Typography variant="caption" color="text.secondary">
                        {t(`operations.agents.syncOrders.state.${row.order_state}`, row.order_state)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{row.grand_total ? MoneyUtil.formatCurrency(row.grand_total) : '—'}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                      <Chip
                        size="small"
                        color={held ? 'error' : flagged ? 'warning' : 'success'}
                        label={held ? t('operations.agents.syncOrders.held', 'Held') : t('operations.agents.syncOrders.accepted', 'Booked')}
                      />
                      {row.flags
                        .filter((f) => f !== 'PENDING')
                        .map((f) => (
                          <Tooltip key={f} title={held && row.error ? row.error : ''}>
                            <Chip size="small" variant="outlined" color={HOLD_REASONS.has(f) ? 'error' : 'warning'} label={flagLabel(f)} />
                          </Tooltip>
                        ))}
                      {row.reviewed_at && (
                        <Chip size="small" variant="outlined" label={t('operations.agents.syncOrders.reviewed', 'Looked at')} />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    {held && (
                      <Button size="small" disabled={busy === row.id} onClick={() => retry(row)}>
                        {t('operations.agents.syncOrders.retry', 'Retry')}
                      </Button>
                    )}
                    {flagged && !row.reviewed_at && (
                      <Button size="small" disabled={busy === row.id} onClick={() => review(row)}>
                        {t('operations.agents.syncOrders.markReviewed', 'Mark reviewed')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}
