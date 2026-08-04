import { httpClient } from './httpClient';

export interface SettlementAccount {
  id: string;
  code: string;
  name: string;
  bank_name?: string;
  account_number?: string;
  iban?: string;
  is_active: boolean;
}

export interface PaymentDevice {
  id: string;
  code: string;
  name: string;
  serial_number?: string;
  device_type: 'POS_TERMINAL' | 'MOBILE_POS' | 'ONLINE_GATEWAY' | 'BANK_TRANSFER';
  branch_id?: string;
  terminal_id?: string;
  settlement_account_id?: string;
  is_active: boolean;
}

export interface PaymentRecord {
  id: string;
  order_id: string;
  payment_method_id: string;
  amount: string;
  status: string;
  reference_number?: string;
  device_id?: string;
  settlement_account_id?: string;
  is_mobile_pos: boolean;
  is_reversed: boolean;
  notes?: string;
  recorded_at: string;
}

export type Payment = PaymentRecord;

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
    quantity: number;
    unit_price: string;
    subtotal: string;
    tax_amount: string;
    total_amount: string;
    options?: Array<{ name: string; price_delta: string }>;
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
  getAccounts: async (): Promise<SettlementAccount[]> => {
    const res = await httpClient.get('/api/v1/payments/accounts');
    return res.data;
  },
  createAccount: async (data: Partial<SettlementAccount>): Promise<SettlementAccount> => {
    const res = await httpClient.post('/api/v1/payments/accounts', data);
    return res.data;
  },
  getDevices: async (branchId?: string): Promise<PaymentDevice[]> => {
    const res = await httpClient.get('/api/v1/payments/devices', { params: { branchId } });
    return res.data;
  },
  createDevice: async (data: Partial<PaymentDevice>): Promise<PaymentDevice> => {
    const res = await httpClient.post('/api/v1/payments/devices', data);
    return res.data;
  },
  getOrderPayments: async (orderId: string): Promise<PaymentRecord[]> => {
    const res = await httpClient.get(`/api/v1/payments/order/${orderId}`);
    return res.data;
  },
  postPayment: async (data: { order_id: string; payment_method_id: string; amount: string; reference_number?: string; notes?: string }): Promise<{ payment: PaymentRecord; order: any }> => {
    const res = await httpClient.post('/api/v1/payments', data);
    return res.data;
  },
  postSplitPayment: async (data: {
    order_id: string;
    tenders: Array<{
      payment_method_id: string;
      amount: string;
      device_id?: string;
      settlement_account_id?: string;
      is_mobile_pos?: boolean;
      reference_number?: string;
    }>;
  }): Promise<any> => {
    const res = await httpClient.post('/api/v1/payments/split', data);
    return res.data;
  },
  retryPaymentAttempt: async (paymentId: string, deviceId?: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/payments/${paymentId}/retry`, { deviceId });
    return res.data;
  },
  reversePayment: async (paymentId: string, reason?: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/payments/${paymentId}/reverse`, { reason });
    return res.data;
  },
  getReceipt: async (orderId: string): Promise<ReceiptData> => {
    const res = await httpClient.get(`/api/v1/orders/${orderId}/receipt`);
    return res.data;
  },
};
