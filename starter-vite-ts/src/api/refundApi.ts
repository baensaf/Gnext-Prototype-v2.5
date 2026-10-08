import { httpClient } from './httpClient';

export interface RefundAllocation {
  id: string;
  refund_id: string;
  payment_id: string;
  payment_method_id?: string;
  amount: string;
  created_at: string;
}

export interface RefundRecord {
  id: string;
  order_id: string;
  refund_number: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'REVERSED';
  method_id: string;
  method_kind: string;
  amount: string;
  currency_code: string;
  reason_code_id?: string;
  reason_text?: string;
  reference?: string;
  failure_code?: string;
  is_alternative_method: boolean;
  approval_request_id?: string;
  device_id?: string;
  shift_id?: string;
  initiated_at: string;
  posted_at?: string;
  allocations?: RefundAllocation[];
  /** The order's number and total, sent with the list so it needs no second request. */
  order_number?: string | null;
  order_total?: string | null;
  // Legacy UI aliases
  code?: string;
  total_refund_amount?: string;
  note?: string;
  created_at: string;
}

export type RefundRequest = RefundRecord;

const toRecord = (r: any): RefundRecord => ({
  ...r,
  code: r.refund_number,
  total_refund_amount: r.amount,
  note: r.reason_text,
  created_at: r.initiated_at || new Date().toISOString(),
});

export const refundApi = {
  /** A branch account gets its own branch's refunds whatever it asks for; head office picks one. */
  getRefunds: async (params: { orderId?: string; branchId?: string } = {}): Promise<RefundRecord[]> => {
    const res = await httpClient.get('/api/v1/refunds', {
      params: { orderId: params.orderId, branchId: params.branchId, limit: 200 },
    });
    const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
    return list.map(toRecord);
  },

  getRefundById: async (id: string): Promise<RefundRecord> => {
    const res = await httpClient.get(`/api/v1/refunds/${id}`);
    return toRecord(res.data);
  },

  /** Made and settled in one call: it either pays back in full or leaves nothing behind. */
  createRefund: async (data: {
    order_id: string;
    amount?: string;
    full?: boolean;
    reason_code_id?: string;
    reason?: string;
    pin?: string;
    targetMethodId?: string;
    reference?: string;
  }): Promise<RefundRecord> => {
    const payload = {
      amount: data.amount,
      full: data.full,
      targetMethodId: data.targetMethodId,
      reference: data.reference,
      reasonCodeId: data.reason_code_id,
      reason: data.reason || 'Customer return',
      // The server asks for this whenever the account issuing the refund is not one that
      // can approve on its own.
      pin: data.pin,
    };
    const res = await httpClient.post(`/api/v1/orders/${data.order_id}/refunds`, payload);
    return toRecord(res.data);
  },

  cancelPaidOrder: async (orderId: string, reason?: string, targetMethodId?: string, pin?: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/orders/${orderId}/cancel-paid`, {
      reason: reason || 'Paid order cancellation',
      targetMethodId,
      pin,
    });
    return res.data;
  },
};
