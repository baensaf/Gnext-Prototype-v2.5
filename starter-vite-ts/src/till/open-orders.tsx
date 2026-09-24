import type { TillPrint, AgentOrder, TillPrinter } from './agent-client';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import ClearIcon from '@mui/icons-material/Clear';
import PrintIcon from '@mui/icons-material/Print';
import DeleteIcon from '@mui/icons-material/Delete';
import PaymentIcon from '@mui/icons-material/Payment';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import PrintDisabledIcon from '@mui/icons-material/PrintDisabled';
import {
  Box,
  Chip,
  Alert,
  Paper,
  Stack,
  Button,
  Dialog,
  Drawer,
  Select,
  Divider,
  MenuItem,
  TextField,
  InputLabel,
  Typography,
  IconButton,
  DialogTitle,
  FormControl,
  DialogActions,
  DialogContent,
  CircularProgress,
} from '@mui/material';

import { fTime } from 'src/utils/format-time';
import { MoneyUtil } from 'src/utils/money.util';

import { toast } from 'src/components/snackbar';
import { CheckoutModal } from 'src/components/CheckoutModal';

import { useTill } from './till-context';
import { tillApi } from './agent-client';

// ----------------------------------------------------------------------

/** Roles that may approve a change after the edit window (§13.6), as the agent checks them. */
const APPROVER_ROLES = ['SUPERVISOR', 'MANAGER', 'ADMIN', 'OWNER'];

/**
 * The tickets of an order that did not print and have not come out since: a failed ticket counts
 * until a later copy of the same document for the same station printed.
 */
export function failedTickets(o: AgentOrder): TillPrint[] {
  const prints = o.prints || [];
  return prints.filter(
    (p, i) =>
      p.status === 'FAILED' &&
      !prints.some((q, j) => j > i && q.status !== 'FAILED' && q.document_type === p.document_type && (q.label || '') === (p.label || ''))
  );
}

/**
 * The till's orders still open: paid for later, finished when the table leaves, or cancelled.
 * And the ones that ended in the last day with a ticket that did not print, to reprint it.
 */
export function useOpenOrders(active: boolean) {
  const [orders, setOrders] = useState<AgentOrder[]>([]);
  const [troubled, setTroubled] = useState<AgentOrder[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await tillApi.orders();
      const newest = [...res.orders].reverse();
      setOrders(newest.filter((o) => o.state === 'OPEN' && !o.handed_over));
      setTroubled(newest.filter((o) => !(o.state === 'OPEN' && !o.handed_over) && failedTickets(o).length > 0));
    } catch {
      // The header's banner reports an agent that does not answer.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, active ? 5_000 : 20_000);
    return () => window.clearInterval(timer);
  }, [refresh, active]);

  return { orders, troubled, loading, refresh };
}

const DOCUMENT_KEYS: Record<string, string> = {
  KITCHEN_TICKET: 'till.print.kitchen',
  CUSTOMER_RECEIPT: 'till.print.receipt',
  GUEST_BILL: 'till.print.bill',
};

/** The tickets that did not print, each with its reprint. */
function FailedTickets({ order, onReprint }: { order: AgentOrder; onReprint: (p: TillPrint) => void }) {
  const { t } = useTranslation();
  const failed = failedTickets(order);
  if (failed.length === 0) return null;
  return (
    <Stack spacing={0.75} sx={{ mb: 1.5 }}>
      {failed.map((p) => (
        <Alert
          key={p.id}
          severity="error"
          icon={<PrintDisabledIcon fontSize="small" />}
          sx={{ py: 0, alignItems: 'center' }}
          action={
            <Button color="inherit" size="small" startIcon={<PrintIcon fontSize="small" />} onClick={() => onReprint(p)}>
              {t('till.print.reprint')}
            </Button>
          }
        >
          <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>
            {p.label || t(DOCUMENT_KEYS[p.document_type] || 'till.print.kitchen')}
          </Typography>
          <Typography variant="caption">{p.error || t('till.print.failed')}</Typography>
        </Alert>
      ))}
    </Stack>
  );
}

/** One ticket again, to its printer or another one the cashier picks (§13.8). */
function ReprintDialog({ order, ticket, onClose }: { order: AgentOrder | null; ticket: TillPrint | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [printers, setPrinters] = useState<TillPrinter[]>([]);
  const [printerId, setPrinterId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ticket) return;
    setPrinterId(ticket.printer_id || '');
    tillApi
      .printers()
      .then((res) => setPrinters(res.printers))
      .catch(() => setPrinters([]));
  }, [ticket]);

  if (!order || !ticket) return null;

  const reprint = async () => {
    setBusy(true);
    try {
      await tillApi.print(order.id, { print_id: ticket.id, printer_id: printerId !== ticket.printer_id ? printerId : undefined });
      toast.success(t('till.print.sent'));
      onClose();
    } catch (err: any) {
      toast.error(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => !busy && onClose()} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold' }}>
        {t('till.print.reprintTitle', { ticket: ticket.label || t(DOCUMENT_KEYS[ticket.document_type] || 'till.print.kitchen') })}
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <FormControl fullWidth sx={{ mt: 1 }}>
          <InputLabel>{t('till.print.printer')}</InputLabel>
          <Select value={printerId} label={t('till.print.printer')} onChange={(e) => setPrinterId(e.target.value)}>
            {printers.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name || p.code}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button variant="contained" onClick={reprint} disabled={busy || !printerId} startIcon={<PrintIcon />}>
          {t('till.print.reprint')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function due(o: AgentOrder): bigint {
  const paid = o.payments.reduce((sum, p) => sum + BigInt(p.amount.split('.')[0] || '0'), 0n);
  const total = BigInt(o.totals.grand_total.split('.')[0] || '0');
  return total > paid ? total - paid : 0n;
}

type Props = {
  open: boolean;
  onClose: () => void;
  orders: AgentOrder[];
  troubled: AgentOrder[];
  loading: boolean;
  refresh: () => Promise<void>;
};

/**
 * Where the web POS sends the cashier to the Orders pages, the offline till lists its own open
 * orders beside the register, in the drawer the web POS uses for held carts.
 */
export function OpenOrdersDrawer({ open, onClose, orders, troubled, loading, refresh }: Props) {
  const { t } = useTranslation();
  const [payingId, setPayingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<AgentOrder | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reprinting, setReprinting] = useState<{ order: AgentOrder; ticket: TillPrint } | null>(null);

  const bill = async (o: AgentOrder) => {
    setBusyId(o.id);
    try {
      await tillApi.print(o.id, { document: 'GUEST_BILL' });
      toast.success(t('till.print.sent'));
      await refresh();
    } catch (err: any) {
      toast.error(err.detail || err.message);
    } finally {
      setBusyId(null);
    }
  };

  const finish = async (o: AgentOrder) => {
    setBusyId(o.id);
    try {
      await tillApi.finish(o.id);
      toast.success(t('till.orders.finished', { number: o.call_number ?? '' }));
      await refresh();
    } catch (err: any) {
      toast.error(err.detail || err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 420, md: 460 }, p: 3, bgcolor: 'background.paper' } } }}
      >
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
              <ReceiptLongIcon color="primary" />
              {t('till.orders.title')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('till.orders.help')}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose}>
            <ClearIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        {loading && orders.length === 0 && troubled.length === 0 ? (
          <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={32} />
          </Box>
        ) : orders.length === 0 && troubled.length === 0 ? (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <Typography variant="body1" color="text.secondary">
              {t('till.orders.empty')}
            </Typography>
          </Box>
        ) : (
          <Stack spacing={2} sx={{ overflowY: 'auto', flexGrow: 1, pr: 0.5 }}>
            {orders.map((o) => {
              const outstanding = due(o);
              const charging = o.payments.some((p) => p.status === 'RUNNING');
              const paid = outstanding === 0n;
              return (
                <Paper key={o.id} variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Box>
                      <Typography variant="h5" sx={{ fontWeight: 'bold', lineHeight: 1.1 }}>
                        {o.call_number ?? '—'}
                      </Typography>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.75 }}>
                        <Chip
                          label={o.order_type === 'DINE_IN' ? t('pos.dineIn') : t('pos.takeaway')}
                          size="small"
                          variant="outlined"
                          sx={{ fontWeight: 600, height: 20, fontSize: '0.7rem' }}
                        />
                        {charging ? (
                          <Chip label={t('till.orders.charging')} size="small" color="warning" sx={{ height: 20, fontSize: '0.7rem' }} />
                        ) : paid ? (
                          <Chip label={t('till.orders.paid')} size="small" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />
                        ) : null}
                      </Stack>
                    </Box>
                    <Box sx={{ textAlign: 'end' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                        {MoneyUtil.formatCurrency(o.totals.grand_total)} IRR
                      </Typography>
                      {!paid && (
                        <Typography variant="caption" color="warning.main" sx={{ fontWeight: 600 }}>
                          {t('till.orders.due', { amount: MoneyUtil.formatCurrency(outstanding.toString()) })}
                        </Typography>
                      )}
                    </Box>
                  </Stack>

                  <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
                    <AccessTimeIcon sx={{ fontSize: 14 }} />
                    {fTime(o.placed_at)}
                    {` • ${o.lines.map((l) => `${l.product_name}${l.variant_name ? ` (${l.variant_name})` : ''} ×${l.quantity}`).join('، ')}`}
                  </Typography>

                  <FailedTickets order={o} onReprint={(ticket) => setReprinting({ order: o, ticket })} />

                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1 }}>
                    {o.order_type === 'DINE_IN' && (
                      <Button
                        size="small"
                        color="inherit"
                        disabled={busyId === o.id}
                        startIcon={<PrintIcon fontSize="small" />}
                        onClick={() => bill(o)}
                      >
                        {t('till.print.billButton')}
                      </Button>
                    )}
                    {o.payments.length === 0 && (
                      <Button size="small" color="error" startIcon={<DeleteIcon fontSize="small" />} onClick={() => setCancelling(o)}>
                        {t('till.orders.cancel')}
                      </Button>
                    )}
                    {paid && !charging && o.order_type === 'DINE_IN' && (
                      <Button
                        size="small"
                        variant="contained"
                        color="success"
                        disabled={busyId === o.id}
                        startIcon={<DoneAllIcon fontSize="small" />}
                        onClick={() => finish(o)}
                      >
                        {t('till.orders.finish')}
                      </Button>
                    )}
                    {!paid && (
                      <Button
                        size="small"
                        variant="contained"
                        disabled={charging}
                        startIcon={<PaymentIcon fontSize="small" />}
                        onClick={() => setPayingId(o.id)}
                      >
                        {t('till.orders.pay')}
                      </Button>
                    )}
                  </Stack>
                </Paper>
              );
            })}

            {troubled.length > 0 && (
              <>
                <Typography variant="subtitle2" color="error" sx={{ fontWeight: 700, pt: 1 }}>
                  {t('till.print.problems')}
                </Typography>
                {troubled.map((o) => (
                  <Paper key={o.id} variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: 'error.light' }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                        {o.call_number ?? '—'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {fTime(o.placed_at)}
                      </Typography>
                    </Stack>
                    <FailedTickets order={o} onReprint={(ticket) => setReprinting({ order: o, ticket })} />
                  </Paper>
                ))}
              </>
            )}
          </Stack>
        )}
      </Drawer>

      <ReprintDialog
        order={reprinting?.order ?? null}
        ticket={reprinting?.ticket ?? null}
        onClose={() => {
          setReprinting(null);
          refresh();
        }}
      />

      <CheckoutModal
        open={Boolean(payingId)}
        orderId={payingId}
        onClose={() => {
          setPayingId(null);
          refresh();
        }}
      />

      <CancelDialog
        order={cancelling}
        onClose={() => setCancelling(null)}
        onDone={async () => {
          setCancelling(null);
          await refresh();
        }}
      />
    </>
  );
}

/** Cancel with a reason; after the tenant's window the agent asks for an approver's PIN (§13.6). */
function CancelDialog({ order, onClose, onDone }: { order: AgentOrder | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const { state } = useTill();
  const [note, setNote] = useState('');
  const [needsApproval, setNeedsApproval] = useState(false);
  const [approverId, setApproverId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote('');
    setNeedsApproval(false);
    setApproverId('');
    setPin('');
    setError(null);
  }, [order?.id]);

  if (!order) return null;
  const approvers = state.staff.filter((u) => APPROVER_ROLES.includes(u.role));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await tillApi.cancel(order.id, note.trim(), needsApproval ? approverId : '', needsApproval ? pin : '');
      toast.success(res.dropped ? t('till.orders.dropped') : t('till.orders.cancelled', { number: order.call_number ?? '' }));
      await onDone();
    } catch (err: any) {
      if (err.code === 'APPROVAL_REQUIRED' && !needsApproval) setNeedsApproval(true);
      setError(err.detail || err.message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => !busy && onClose()} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold' }}>{t('till.orders.cancelTitle', { number: order.call_number ?? '' })}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label={t('till.orders.cancelNote')} value={note} onChange={(e) => setNote(e.target.value)} autoFocus fullWidth />
          {needsApproval && (
            <>
              <FormControl fullWidth>
                <InputLabel>{t('till.orders.approver')}</InputLabel>
                <Select value={approverId} label={t('till.orders.approver')} onChange={(e) => setApproverId(e.target.value)}>
                  {approvers.map((u) => (
                    <MenuItem key={u.id} value={u.id}>
                      {u.display_name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label={t('till.signIn.pin')}
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'off', dir: 'ltr' } }}
                fullWidth
              />
            </>
          )}
          {error && <Alert severity={needsApproval && !pin ? 'warning' : 'error'}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t('till.orders.keep')}
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={submit}
          disabled={busy || (needsApproval && (!approverId || pin.length < 4))}
        >
          {t('till.orders.cancel')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
