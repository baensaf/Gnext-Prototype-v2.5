import type { OrderHeader, DeclineReason, IncomingOrderPolicy } from 'src/api/orderApi';

import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useMemo, useState, useEffect } from 'react';

import CloseIcon from '@mui/icons-material/Close';
import {
  Box,
  Card,
  Chip,
  Stack,
  Alert,
  Table,
  Button,
  Drawer,
  Divider,
  MenuItem,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  TableContainer,
} from '@mui/material';

import { orderApi } from 'src/api/orderApi';
import { formatOrderTotal, useIncomingOrders } from 'src/contexts/incoming-orders-context';

import { toast, showErrorToast } from 'src/components/snackbar';

// ----------------------------------------------------------------------

/** Used until the branch's policy has loaded; the policy supplies the real default. */
const DEFAULT_PREP_MINUTES = 20;
/** Snappfood refuses a promised time above 70 minutes. */
const MAX_PREP_MINUTES = 70;

function minutesWaiting(order: OrderHeader, now: number): number {
  return Math.max(0, Math.floor((now - new Date(order.placed_at).getTime()) / 60000));
}

/** Whole minutes before the branch's time limit answers the order for it; 0 once it is due. */
function minutesLeft(order: OrderHeader, now: number, timeoutMinutes: number): number {
  const deadline = new Date(order.placed_at).getTime() + timeoutMinutes * 60000;
  return Math.max(0, Math.ceil((deadline - now) / 60000));
}

function sourceOf(order: OrderHeader): string {
  if (order.order_number?.startsWith('SNP-')) return 'Snappfood';
  return order.channel || order.order_type;
}

function activeLines(order: OrderHeader) {
  return (order.items || []).filter((item) => (item.state || 'ACTIVE') === 'ACTIVE');
}

type TimeLeftChipProps = { order: OrderHeader; now: number; policy: IncomingOrderPolicy | null };

/** The countdown to the automatic answer; how long it has waited until the policy is known. */
function TimeLeftChip({ order, now, policy }: TimeLeftChipProps) {
  const { t } = useTranslation();

  if (!policy) {
    return (
      <Chip size="small" variant="outlined" label={t('orders.incoming.minutes', { count: minutesWaiting(order, now) })} />
    );
  }

  const left = minutesLeft(order, now, policy.timeoutMinutes);
  return (
    <Chip
      size="small"
      variant={left <= 1 ? 'filled' : 'outlined'}
      color={left <= 1 ? 'error' : left <= 2 ? 'warning' : 'default'}
      label={left > 0 ? t('orders.incoming.minutesLeft', { count: left }) : t('orders.incoming.dueNow')}
    />
  );
}

/**
 * Orders from Snappfood (and later the website) that wait for this branch to answer them.
 * Accepting sends one to the kitchen; rejecting tells Snappfood why and ends it.
 */
export function IncomingOrdersPage() {
  const { t } = useTranslation();
  const incoming = useIncomingOrders();
  const orders = useMemo(() => incoming?.orders ?? [], [incoming?.orders]);
  const policy = incoming?.policy ?? null;
  const [searchParams, setSearchParams] = useSearchParams();
  const [reasons, setReasons] = useState<DeclineReason[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!incoming?.enabled) return;
    orderApi
      .getDeclineReasons()
      .then(setReasons)
      .catch(() => setReasons([]));
  }, [incoming?.enabled]);

  // The toast links here with ?order=<id>, so the open order lives in the address. Once it
  // has been answered - here, at another till or by the time limit - it leaves the list and
  // the drawer closes.
  const selectedId = searchParams.get('order');
  const selected = orders.find((order) => order.id === selectedId) ?? null;

  const openOrder = (id: string) => setSearchParams({ order: id });
  const closeOrder = () => setSearchParams({});

  const afterAnswer = async () => {
    await incoming?.refresh();
    closeOrder();
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h4" sx={{ mb: 0.5 }}>
        {t('orders.incoming.title')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        {t('orders.incoming.subtitle')}
        {policy &&
          ` ${t(
            policy.timeoutAction === 'ACCEPT' ? 'orders.incoming.timeoutAcceptHint' : 'orders.incoming.timeoutRejectHint',
            { count: policy.timeoutMinutes }
          )}`}
      </Typography>

      {!incoming?.enabled ? (
        <Alert severity="info">{t('orders.incoming.noSite')}</Alert>
      ) : orders.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body1" sx={{ color: 'text.secondary' }}>
            {t('orders.incoming.empty')}
          </Typography>
        </Card>
      ) : (
        <Card>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('orders.incoming.colOrder')}</TableCell>
                  <TableCell>{t('orders.incoming.colSource')}</TableCell>
                  <TableCell>{t('orders.incoming.colTimeLeft')}</TableCell>
                  <TableCell>{t('orders.incoming.colItems')}</TableCell>
                  <TableCell align="right">{t('orders.incoming.colTotal')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id} hover sx={{ cursor: 'pointer' }} onClick={() => openOrder(order.id)}>
                    <TableCell sx={{ fontWeight: 600 }}>{order.order_number}</TableCell>
                    <TableCell>
                      <Chip size="small" color="warning" label={sourceOf(order)} />
                    </TableCell>
                    <TableCell>
                      <TimeLeftChip order={order} now={now} policy={policy} />
                    </TableCell>
                    <TableCell>
                      {activeLines(order)
                        .map((item) => `${Number(item.quantity)}× ${item.product_name}`)
                        .join('، ')}
                    </TableCell>
                    <TableCell align="right">{formatOrderTotal(order)}</TableCell>
                    <TableCell align="right">
                      <Button size="small" variant="contained" onClick={() => openOrder(order.id)}>
                        {t('orders.incoming.open')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      <IncomingOrderDrawer
        order={selected}
        reasons={reasons}
        policy={policy}
        now={now}
        onClose={closeOrder}
        onAnswered={afterAnswer}
      />
    </Box>
  );
}

// ----------------------------------------------------------------------

type IncomingOrderDrawerProps = {
  order: OrderHeader | null;
  reasons: DeclineReason[];
  policy: IncomingOrderPolicy | null;
  now: number;
  onClose: () => void;
  onAnswered: () => Promise<void>;
};

function IncomingOrderDrawer({ order, reasons, policy, now, onClose, onAnswered }: IncomingOrderDrawerProps) {
  const { t } = useTranslation();
  const defaultPrep = policy?.defaultPrepMinutes ?? DEFAULT_PREP_MINUTES;
  const [prepMinutes, setPrepMinutes] = useState(defaultPrep);
  const [reasonId, setReasonId] = useState<number | ''>('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);

  useEffect(() => {
    setPrepMinutes(defaultPrep);
    setReasonId('');
    setComment('');
  }, [order?.id, defaultPrep]);

  const clampPrep = (minutes: number) => Math.min(MAX_PREP_MINUTES, Math.max(1, Math.round(minutes || 0)));

  const answer = async (kind: 'accept' | 'reject') => {
    if (!order) return;
    setBusy(kind);
    try {
      if (kind === 'accept') {
        await orderApi.acceptIncomingOrder(order.id, prepMinutes);
        toast.success(t('orders.incoming.accepted', { number: order.order_number }));
      } else {
        await orderApi.rejectIncomingOrder(order.id, Number(reasonId), comment);
        toast.success(t('orders.incoming.rejected', { number: order.order_number }));
      }
    } catch (err) {
      // Most often a 409: another till, or the time limit, answered it a moment earlier.
      showErrorToast(err, t('orders.incoming.answerFailed'));
    } finally {
      setBusy(null);
      await onAnswered();
    }
  };

  const outstanding = Number(order?.outstanding_total ?? order?.due_amount ?? 0);
  const paid = Number(order?.paid_total ?? order?.paid_amount ?? 0);

  return (
    <Drawer
      anchor="right"
      open={!!order}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: 1, maxWidth: 460 } } }}
    >
      {order && (
        <Stack spacing={2.5} sx={{ p: 3 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h6">{order.order_number}</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                <Chip size="small" color="warning" label={sourceOf(order)} />
                <TimeLeftChip order={order} now={now} policy={policy} />
              </Stack>
            </Box>
            <IconButton onClick={onClose} aria-label="close">
              <CloseIcon />
            </IconButton>
          </Stack>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {t('orders.incoming.customer')}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-line', color: 'text.secondary' }}>
              {order.notes || '—'}
            </Typography>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('orders.incoming.items')}
            </Typography>
            <Stack spacing={0.75}>
              {activeLines(order).map((item) => (
                <Stack key={item.id} direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="body2">
                    {Number(item.quantity)}× {item.product_name}
                    {item.special_instructions ? ` (${item.special_instructions})` : ''}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {Number(item.line_total || item.subtotal || 0).toLocaleString()}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {t('orders.incoming.payment')}
            </Typography>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="h6">{formatOrderTotal(order)}</Typography>
              {outstanding <= 0 && paid > 0 ? (
                <Chip size="small" color="success" label={t('orders.incoming.paidOnline')} />
              ) : (
                <Chip
                  size="small"
                  color="warning"
                  label={t('orders.incoming.toCollect', { amount: outstanding.toLocaleString() })}
                />
              )}
            </Stack>
          </Box>

          <Divider />

          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField
                type="number"
                size="small"
                label={t('orders.incoming.prepMinutes')}
                value={prepMinutes}
                onChange={(e) => setPrepMinutes(clampPrep(Number(e.target.value)))}
                slotProps={{ htmlInput: { min: 1, max: MAX_PREP_MINUTES } }}
                sx={{ flexGrow: 1 }}
              />
              <Button variant="outlined" onClick={() => setPrepMinutes((m) => clampPrep(m + 5))}>
                +5
              </Button>
              <Button variant="outlined" onClick={() => setPrepMinutes((m) => clampPrep(m + 10))}>
                +10
              </Button>
            </Stack>
            <Button
              size="large"
              variant="contained"
              color="success"
              disabled={!!busy}
              onClick={() => answer('accept')}
            >
              {t('orders.incoming.accept')}
            </Button>
          </Stack>

          <Divider />

          <Stack spacing={1.5}>
            <TextField
              select
              size="small"
              label={t('orders.incoming.rejectReason')}
              value={reasonId}
              onChange={(e) => setReasonId(Number(e.target.value))}
            >
              {reasons.map((reason) => (
                <MenuItem key={reason.id} value={reason.id}>
                  {reason.title}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label={t('orders.incoming.rejectComment')}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <Button
              variant="outlined"
              color="error"
              disabled={!!busy || reasonId === ''}
              onClick={() => answer('reject')}
            >
              {t('orders.incoming.reject')}
            </Button>
          </Stack>
        </Stack>
      )}
    </Drawer>
  );
}
