import type { ReasonCode } from 'src/api/settingsApi';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Stack,
  Alert,
  Button,
  Dialog,
  Select,
  MenuItem,
  InputLabel,
  DialogTitle,
  FormControl,
  DialogActions,
  DialogContent,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyLabel } from 'src/utils/currency';

import { refundApi } from 'src/api/refundApi';
import { settingsApi } from 'src/api/settingsApi';
import { useAuthStore } from 'src/store/useAuthStore';

import { ApprovalModal } from 'src/components/approval/ApprovalModal';

/** Roles that release a refund on their own authority. For anyone else a manager signs in. */
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
 * One of head office's refund reasons, and a manager's sign-in when the person at the till is not
 * one, for sending a whole paid order back. The order is chosen before it opens: Orders offers it
 * on the order itself. A manager signs in before anything is created, so a refused authorization
 * leaves no half-made refund behind.
 */
export function RefundDialog({ order, orderRef, onClose, onRefunded }: Props) {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();
  const role = useAuthStore((state) => state.user?.role);
  const canApprove = APPROVER_ROLES.includes((role || '').toUpperCase());

  const [reasons, setReasons] = useState<ReasonCode[]>([]);
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [pinOpen, setPinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each order opens on a blank form.
  const orderId = order?.id;
  useEffect(() => {
    setReasonCodeId('');
    setError(null);
    setPinOpen(false);
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    settingsApi
      .getReasonCodes()
      .then((codes) => setReasons(codes.filter((r) => r.is_active !== false && (r.applies_to || []).includes('REFUND'))))
      .catch(() => setReasons([]));
  }, [orderId]);

  const submit = async (approvalRequestId?: string) => {
    if (!order) return;
    setSubmitting(true);
    setError(null);
    try {
      await refundApi.createRefund({ order_id: order.id, reason_code_id: reasonCodeId, approval_request_id: approvalRequestId });
      onRefunded();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.detail || err.message || t('refunds.createFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  // The refund and its pay-backs go together or not at all (Y-18): a pay-back that can't be
  // made is shown here, before a manager is asked to sign in for it.
  const handleSubmitClick = async () => {
    if (canApprove) {
      submit();
      return;
    }
    if (!order) return;
    setError(null);
    try {
      await refundApi.checkPayBack(order.id);
      setPinOpen(true);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.detail || err.message || t('refunds.createFailed'));
    }
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

            {reasons.length === 0 ? (
              <Alert severity="warning">{t('refunds.noReasons')}</Alert>
            ) : (
              <FormControl fullWidth>
                <InputLabel>{t('refunds.reason')}</InputLabel>
                <Select label={t('refunds.reason')} value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
                  {reasons.map((r) => (
                    <MenuItem key={r.id} value={r.id}>
                      {r.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {!canApprove && <Alert severity="info">{t('refunds.pinNotice')}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={submitting}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="contained" onClick={handleSubmitClick} disabled={submitting || !reasonCodeId}>
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
