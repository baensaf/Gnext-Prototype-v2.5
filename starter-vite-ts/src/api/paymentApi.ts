import { httpClient } from './httpClient';

export interface SettlementAccount {
  id: string;
  code: string;
  name: string;
  account_type: string;
  masked_identifier?: string;
  currency_code: string;
  is_company_owned: boolean;
  is_active: boolean;
  // Legacy UI aliases
  bank_name?: string;
  account_number?: string;
  iban?: string;
}

export interface PaymentDevice {
  id: string;
  code: string;
  name: string;
  kind: 'POS' | 'NETWORK' | 'MOBILE';
  ownership: 'COMPANY' | 'COURIER' | 'THIRD_PARTY';
  branch_id?: string;
  settlement_account_id?: string;
  device_identifier?: string;
  is_active: boolean;
  // Legacy UI aliases
  device_type?: string;
  serial_number?: string;
}

export interface PaymentRecord {
  id: string;
  order_id: string;
  payment_number: string;
  method_id: string;
  method_kind: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'REVERSED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
  amount: string;
  currency_code: string;
  device_id?: string;
  settlement_account_id?: string;
  reference?: string;
  receipt_number?: string;
  shift_id?: string;
  business_date: string;
  idempotency_key?: string;
  original_payment_id?: string;
  correction_group_id?: string;
  failure_code?: string;
  initiated_at: string;
  posted_at?: string;
  // Legacy UI aliases
  recorded_at: string;
  reference_number?: string;
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
    const res = await httpClient.get('/api/v1/settlement-accounts');
    return (res.data || []).map((acc: any) => ({
      ...acc,
      bank_name: acc.name,
      account_number: acc.masked_identifier,
      iban: acc.masked_identifier,
    }));
  },

  createAccount: async (data: any): Promise<SettlementAccount> => {
    const payload = {
      code: data.code || `SA-${Date.now()}`,
      name: data.name || data.bank_name || 'Bank Account',
      accountType: data.account_type || data.accountType || 'BANK_ACCOUNT',
      maskedIdentifier: data.masked_identifier || data.account_number || data.iban || data.maskedIdentifier,
      currencyCode: data.currency_code || data.currencyCode || 'IRR',
    };
    const res = await httpClient.post('/api/v1/settlement-accounts', payload);
    return res.data;
  },

  getDevices: async (branchId?: string): Promise<PaymentDevice[]> => {
    const res = await httpClient.get('/api/v1/payment-devices', { params: { branchId } });
    return (res.data || []).map((dev: any) => ({
      ...dev,
      device_type: dev.kind === 'MOBILE' ? 'MOBILE_POS' : dev.kind === 'POS' ? 'POS_TERMINAL' : dev.kind,
      serial_number: dev.device_identifier,
    }));
  },

  createDevice: async (data: any): Promise<PaymentDevice> => {
    const payload = {
      code: data.code || `DEV-${Date.now()}`,
      name: data.name || 'Payment Terminal',
      kind: data.kind || (data.device_type === 'MOBILE_POS' ? 'MOBILE' : 'POS'),
      ownership: data.ownership || 'COMPANY',
      branchId: data.branchId || data.branch_id,
      settlementAccountId: data.settlementAccountId || data.settlement_account_id,
      deviceIdentifier: data.device_identifier || data.serial_number,
    };
    const res = await httpClient.post('/api/v1/payment-devices', payload);
    return res.data;
  },

  getOrderPayments: async (orderId: string): Promise<PaymentRecord[]> => {
    const res = await httpClient.get(`/api/v1/orders/${orderId}/payments`);
    return (res.data || []).map((p: any) => ({
      ...p,
      recorded_at: p.posted_at || p.initiated_at || new Date().toISOString(),
      reference_number: p.reference,
    }));
  },

  createPaymentIntent: async (data: {
    orderId: string;
    methodId: string;
    amount: string;
    deviceId?: string;
    settlementAccountId?: string;
    reference?: string;
    receiptNumber?: string;
    idempotencyKey?: string;
  }): Promise<PaymentRecord> => {
    const res = await httpClient.post('/api/v1/payments', data);
    return {
      ...res.data,
      recorded_at: res.data.posted_at || res.data.initiated_at || new Date().toISOString(),
      reference_number: res.data.reference,
    };
  },

  processPayment: async (
    id: string,
    data?: { scenarioId?: string; externalReference?: string; receiptNumber?: string },
  ): Promise<PaymentRecord> => {
    const res = await httpClient.post(`/api/v1/payments/${id}/process`, data || {});
    return {
      ...res.data,
      recorded_at: res.data.posted_at || res.data.initiated_at || new Date().toISOString(),
      reference_number: res.data.reference,
    };
  },

  voidPayment: async (id: string): Promise<PaymentRecord> => {
    const res = await httpClient.post(`/api/v1/payments/${id}/void`, {});
    return {
      ...res.data,
      recorded_at: res.data.posted_at || res.data.initiated_at || new Date().toISOString(),
      reference_number: res.data.reference,
    };
  },

  postPayment: async (data: {
    order_id: string;
    payment_method_id: string;
    amount: string;
    reference_number?: string;
    notes?: string;
  }): Promise<{ payment: PaymentRecord; order: any }> => {
    const intent = await paymentApi.createPaymentIntent({
      orderId: data.order_id,
      methodId: data.payment_method_id,
      amount: data.amount,
      reference: data.reference_number,
    });
    const processed = await paymentApi.processPayment(intent.id, {});
    const resOrder = await httpClient.get(`/api/v1/orders/${data.order_id}`);
    const orderData = resOrder.data ? {
      ...resOrder.data,
      due_amount: resOrder.data.due_amount || resOrder.data.outstanding_total || '0',
      paid_amount: resOrder.data.paid_amount || resOrder.data.paid_total || '0',
      total_amount: resOrder.data.total_amount || resOrder.data.grand_total || '0',
    } : null;
    return { payment: processed, order: orderData };
  },

  reversePayment: async (paymentId: string, reason?: string): Promise<PaymentRecord> => {
    const res = await httpClient.post(`/api/v1/payments/${paymentId}/reverse`, { reason: reason || 'Payment reversal' });
    return res.data;
  },

  correctPayment: async (
    paymentId: string,
    data: { reason: string; replacementMethodId: string; replacementAmount?: string },
  ): Promise<{ originalPayment: PaymentRecord; replacementPayment: PaymentRecord; correctionGroupId: string }> => {
    const res = await httpClient.post(`/api/v1/payments/${paymentId}/correct`, data);
    return res.data;
  },

  getReceipt: async (orderId: string): Promise<ReceiptData> => {
    const res = await httpClient.get(`/api/v1/orders/${orderId}/receipt`);
    return res.data;
  },
};
