import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Stack,
  Alert,
  Button,
  Dialog,
  TextField,
  DialogTitle,
  DialogActions,
  DialogContent,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyLabel } from 'src/utils/currency';

import { refundApi } from 'src/api/refundApi';
import { useAuthStore } from 'src/store/useAuthStore';

import { ApprovalModal } from 'src/components/approval/ApprovalModal';

/** Roles that release a refund on their own authority. Everyone else produces a PIN. */
const APPROVER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OWNER', 'MANAGER', 'SUPERVISOR'];

/** What the dialog needs of the order it refunds. */
export interface RefundableOrder {
  id: string;
  order_number?: string;
  call_number?: number | null;
  paid_total?: string;
  paid_amount?: string;
  refunded_total?: string;
}

/** What is left to give back of an order: what it took less what was already refunded. */
export const refundableOf = (order: Pick<RefundableOrder, 'paid_total' | 'paid_amount' | 'refunded_total'>): string =>
  MoneyUtil.subtract(order.paid_total || order.paid_amount || '0', order.refunded_total || '0');

interface Props {
  /** The order to refund; the dialog is open while there is one. */
  order: RefundableOrder | null;
  /** The name the order goes by on screen (its call number for a cashier). */
  orderRef: string;
  onClose: () => void;
  /** Called once the money has gone back. */
  onRefunded: () => void;
}

/**
 * The reason, and a manager's PIN when the person at the till is not one, for sending a whole
 * paid order back. The order is chosen before it opens: Orders offers it on the order itself.
 * A cashier is asked for the PIN before anything is created, so a refused authorization
 * leaves no half-made refund behind.
 */
export function RefundDialog({ order, orderRef, onClose, onRefunded }: Props) {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();
  const role = useAuthStore((state) => state.user?.role);
  const canApprove = APPROVER_ROLES.includes((role || '').toUpperCase());

  const [reason, setReason] = useState('');
  const [pinOpen, setPinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each order opens on a blank form.
  const orderId = order?.id;
  useEffect(() => {
    setReason('');
    setError(null);
    setPinOpen(false);
  }, [orderId]);

  const submit = async (approvalRequestId?: string) => {
    if (!order) return;
    setSubmitting(true);
    setError(null);
    try {
      await refundApi.createRefund({ order_id: order.id, reason, approval_request_id: approvalRequestId });
      onRefunded();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.detail || err.message || t('refunds.createFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitClick = () => {
    if (canApprove) submit();
    else setPinOpen(true);
  };

  return (
    <>
      <Dialog open={!!order} onClose={() => !submitting && onClose()} maxWidth="xs" fullWidth>
        <DialogTitle>{t('refunds.dialog.title', { number: orderRef })}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            {order && (
              <Alert severity="info">
                {t('refunds.refundable', { amount: `${MoneyUtil.formatCurrency(refundableOf(order))} ${currency}` })}
              </Alert>
            )}

            <TextField
              label={t('refunds.reason')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              multiline
              rows={2}
              fullWidth
            />

            {!canApprove && <Alert severity="info">{t('refunds.pinNotice')}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={submitting}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="contained" onClick={handleSubmitClick} disabled={submitting || !reason.trim()}>
            {canApprove ? t('common.save', 'Save') : t('refunds.continue')}
          </Button>
        </DialogActions>
      </Dialog>

      <ApprovalModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        onSuccess={(_unused, requestId) => {
          setPinOpen(false);
          submit(requestId);
        }}
        actionName="REFUND_ORDER"
        entityType="ORDER"
        entityId={order?.id}
        createRequest
        detailsText={t('refunds.approvalDetails')}
      />
    </>
  );
}
