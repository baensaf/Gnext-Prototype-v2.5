import { httpClient } from './httpClient';

export interface RefundRequest {
  id: string;
  code: string;
  order_id: string;
  requester_user_id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
  refund_type: 'FULL' | 'PARTIAL' | 'ITEM_LEVEL';
  reason_code_id?: string;
  total_refund_amount: string;
  note?: string;
  created_at: string;
}

export const refundApi = {
  getRefunds: async (orderId?: string): Promise<RefundRequest[]> => {
    const res = await httpClient.get('/api/v1/refunds', { params: { orderId } });
    return res.data;
  },
  getRefundById: async (id: string): Promise<any> => {
    const res = await httpClient.get(`/api/v1/refunds/${id}`);
    return res.data;
  },
  createRefund: async (data: {
    order_id: string;
    refund_type: 'FULL' | 'PARTIAL' | 'ITEM_LEVEL';
    items?: Array<{ order_item_id: string; quantity: number }>;
    custom_amount?: string;
    reason_code_id?: string;
    note?: string;
    pin?: string;
    alternative_payment_method_id?: string;
  }): Promise<any> => {
    const res = await httpClient.post('/api/v1/refunds', data);
    return res.data;
  },
  cancelPaidOrder: async (orderId: string, reason?: string, pin?: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/orders/${orderId}/cancel-paid`, { reason, pin });
    return res.data;
  },
};
