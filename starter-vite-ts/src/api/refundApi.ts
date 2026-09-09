import { httpClient } from './httpClient';

export interface RefundAllocation {
  id: string;
  refund_id: string;
  payment_id: string;
  order_item_id?: string;
  amount: string;
  created_at: string;
}

export interface RefundRecord {
  id: string;
  order_id: string;
  refund_number: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'APPROVED' | 'FAILED' | 'CANCELLED' | 'REVERSED';
  method_id: string;
  method_kind: string;
  amount: string;
  currency_code: string;
  reason_code_id?: string;
  reason_text?: string;
  reference?: string;
  is_alternative_method: boolean;
  approval_request_id?: string;
  device_id?: string;
  shift_id?: string;
  initiated_at: string;
  posted_at?: string;
  allocations?: RefundAllocation[];
  // Legacy UI aliases
  code?: string;
  refund_type?: string;
  total_refund_amount?: string;
  note?: string;
  created_at: string;
}

export type RefundRequest = RefundRecord;

export const refundApi = {
  getRefunds: async (orderId?: string): Promise<RefundRecord[]> => {
    const res = await httpClient.get('/api/v1/refunds', { params: { orderId } });
    const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
    return list.map((r: any) => ({
      ...r,
      code: r.refund_number,
      refund_type: r.amount === r.order_grand_total ? 'FULL' : 'PARTIAL',
      total_refund_amount: r.amount,
      note: r.reason_text,
      created_at: r.initiated_at || new Date().toISOString(),
    }));
  },

  getRefundById: async (id: string): Promise<RefundRecord> => {
    const res = await httpClient.get(`/api/v1/refunds/${id}`);
    const r = res.data;
    return {
      ...r,
      code: r.refund_number,
      refund_type: 'PARTIAL',
      total_refund_amount: r.amount,
      note: r.reason_text,
      created_at: r.initiated_at || new Date().toISOString(),
    };
  },

  createRefund: async (data: {
    order_id: string;
    refund_type?: 'FULL' | 'PARTIAL' | 'ITEM_LEVEL';
    items?: Array<{ order_item_id: string; quantity: number }>;
    custom_amount?: string;
    amount?: string;
    full?: boolean;
    reason_code_id?: string;
    reason?: string;
    note?: string;
    pin?: string;
    alternative_payment_method_id?: string;
    targetMethodId?: string;
    approvalRequestId?: string;
    reference?: string;
  }): Promise<RefundRecord> => {
    const payload = {
      amount: data.amount || data.custom_amount,
      full: data.full || data.refund_type === 'FULL',
      items: data.items?.map((it) => ({ orderItemId: it.order_item_id, quantity: it.quantity })),
      targetMethodId: data.targetMethodId || data.alternative_payment_method_id,
      reference: data.reference,
      reasonCodeId: data.reason_code_id,
      reason: data.reason || data.note || 'Customer return',
      approvalRequestId: data.approvalRequestId,
      // The server asks for this whenever the account issuing the refund is not one that
      // can approve on its own. It was collected here and then dropped on the floor.
      pin: data.pin,
    };
    const res = await httpClient.post(`/api/v1/orders/${data.order_id}/refunds`, payload);
    const r = res.data;
    return {
      ...r,
      code: r.refund_number,
      refund_type: 'PARTIAL',
      total_refund_amount: r.amount,
      note: r.reason_text,
      created_at: r.initiated_at || new Date().toISOString(),
    };
  },

  processRefund: async (id: string, data?: { scenarioId?: string; externalReference?: string; pin?: string }): Promise<RefundRecord> => {
    const res = await httpClient.post(`/api/v1/refunds/${id}/process`, data || {});
    const r = res.data;
    return {
      ...r,
      code: r.refund_number,
      refund_type: 'PARTIAL',
      total_refund_amount: r.amount,
      note: r.reason_text,
      created_at: r.initiated_at || new Date().toISOString(),
    };
  },

  cancelPaidOrder: async (
    orderId: string,
    reason?: string,
    approvalRequestId?: string,
    targetMethodId?: string,
    pin?: string,
  ): Promise<any> => {
    const res = await httpClient.post(`/api/v1/orders/${orderId}/cancel-paid`, {
      reason: reason || 'Paid order cancellation',
      approvalRequestId,
      targetMethodId,
      pin,
    });
    return res.data;
  },

  reverseRefund: async (id: string, reason: string, approvalRequestId: string, pin?: string): Promise<RefundRecord> => {
    const res = await httpClient.post(`/api/v1/refunds/${id}/reverse`, { reason, approvalRequestId, pin });
    const r = res.data;
    return {
      ...r,
      code: r.refund_number,
      refund_type: 'PARTIAL',
      total_refund_amount: r.amount,
      note: r.reason_text,
      created_at: r.initiated_at || new Date().toISOString(),
    };
  },
};
