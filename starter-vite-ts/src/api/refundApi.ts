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
  failure_code?: string;
  approval_request_id?: string;
  shift_id?: string;
  initiated_at: string;
  posted_at?: string;
  allocations?: RefundAllocation[];
  /** The order's number and total, sent with the list so it needs no second request. */
  order_number?: string | null;
  order_call_number?: number | null;
  order_total?: string | null;
  /** Who released the money: the approver whose PIN was given, or whoever made the refund. */
  approved_by_name?: string | null;
  // Legacy UI aliases
  code?: string;
  total_refund_amount?: string;
  note?: string;
  created_at: string;
}

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

  /**
   * One page of refunds, newest first, for the Orders page's Refunded tab. `from` and `to`
   * bound the time the money went back (not the day the order was placed); `q` searches the
   * order number, the refund number and the reason.
   */
  listRefunds: async (
    params: { branchId?: string; from?: string; to?: string; q?: string; page?: number; limit?: number } = {}
  ): Promise<{ data: RefundRecord[]; total: number }> => {
    const res = await httpClient.get('/api/v1/refunds', {
      params: {
        branchId: params.branchId,
        from: params.from,
        to: params.to,
        q: params.q,
        page: params.page,
        limit: params.limit,
      },
    });
    const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
    return { data: list.map(toRecord), total: Number(res.data?.total ?? list.length) };
  },

  /**
   * Made and settled in one call: the whole order goes back, each payment by its own method
   * (a split sale comes back as one refund per payment), or nothing happens.
   */
  createRefund: async (data: {
    order_id: string;
    reason_code_id?: string;
    reason?: string;
    pin?: string;
  }): Promise<RefundRecord[]> => {
    const payload = {
      reasonCodeId: data.reason_code_id,
      reason: data.reason || 'Customer return',
      // The server asks for this whenever the account issuing the refund is not one that
      // can approve on its own.
      pin: data.pin,
    };
    const res = await httpClient.post(`/api/v1/orders/${data.order_id}/refunds`, payload);
    return (Array.isArray(res.data) ? res.data : [res.data]).map(toRecord);
  },

  cancelPaidOrder: async (orderId: string, reason?: string, pin?: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/orders/${orderId}/cancel-paid`, {
      reason: reason || 'Paid order cancellation',
      pin,
    });
    return res.data;
  },
};
