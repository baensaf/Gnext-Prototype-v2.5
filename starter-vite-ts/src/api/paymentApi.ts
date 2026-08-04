import { httpClient } from './httpClient';
import { OrderHeader } from './orderApi';

export interface Payment {
  id: string;
  order_id: string;
  payment_method_id: string;
  amount: string;
  status: string;
  reference_number?: string;
  notes?: string;
  recorded_at: string;
}

export interface ReceiptData {
  receipt_header: {
    tenant_name: string;
    branch_name: string;
    branch_address: string;
    branch_phone: string;
    order_number: string;
    order_type: string;
    table_number?: string;
    placed_at: string;
  };
  items: Array<{
    product_name: string;
    quantity: string;
    unit_price: string;
    subtotal: string;
    tax_amount: string;
    total_amount: string;
    options: Array<{ name: string; price_delta: string }>;
  }>;
  totals: {
    subtotal_amount: string;
    tax_amount: string;
    discount_amount: string;
    total_amount: string;
    paid_amount: string;
    due_amount: string;
  };
  tenders: Array<{
    payment_method_code: string;
    payment_method_name: string;
    amount: string;
    reference_number?: string;
    recorded_at: string;
  }>;
  receipt_footer: {
    bilingual_note_fa: string;
    bilingual_note_en: string;
  };
}

export const paymentApi = {
  postPayment: async (data: {
    order_id: string;
    payment_method_id: string;
    amount: string;
    reference_number?: string;
    notes?: string;
  }): Promise<{ payment: Payment; order: OrderHeader }> => {
    const res = await httpClient.post('/api/v1/payments', data);
    return res.data;
  },
  getOrderPayments: async (orderId: string): Promise<Payment[]> => {
    const res = await httpClient.get(`/api/v1/payments/order/${orderId}`);
    return res.data;
  },
  getReceipt: async (orderId: string): Promise<ReceiptData> => {
    const res = await httpClient.get(`/api/v1/orders/${orderId}/receipt`);
    return res.data;
  },
};
