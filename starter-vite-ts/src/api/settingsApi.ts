import { httpClient } from './httpClient';

export interface Currency {
  id: string;
  code: string;
  symbol: string;
  decimal_precision: number;
  rounding_increment: string;
  is_enabled: boolean;
  is_base: boolean;
}

export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  kind: string;
  currency_code: string;
  requires_reference: boolean;
  requires_device: boolean;
  allows_refund: boolean;
  allows_alternative_refund: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface ReasonCode {
  id: string;
  code: string;
  name: string;
  applies_to: string[];
  requires_note: boolean;
  is_active: boolean;
}

export const settingsApi = {
  getSettings: async (): Promise<Record<string, any>> => {
    const res = await httpClient.get('/api/v1/settings');
    return res.data;
  },
  updateSetting: async (key: string, value: any): Promise<any> => {
    const res = await httpClient.patch('/api/v1/settings', { key, value });
    return res.data;
  },
  getCurrencies: async (): Promise<Currency[]> => {
    const res = await httpClient.get('/api/v1/currencies');
    return res.data;
  },
  createCurrency: async (data: Partial<Currency>): Promise<Currency> => {
    const res = await httpClient.post('/api/v1/currencies', data);
    return res.data;
  },
  updateCurrency: async (id: string, data: Partial<Currency>): Promise<Currency> => {
    const res = await httpClient.patch(`/api/v1/currencies/${id}`, data);
    return res.data;
  },
  getPaymentMethods: async (): Promise<PaymentMethod[]> => {
    const res = await httpClient.get('/api/v1/payment-methods');
    return res.data;
  },
  createPaymentMethod: async (data: Partial<PaymentMethod>): Promise<PaymentMethod> => {
    const res = await httpClient.post('/api/v1/payment-methods', data);
    return res.data;
  },
  updatePaymentMethod: async (id: string, data: Partial<PaymentMethod>): Promise<PaymentMethod> => {
    const res = await httpClient.patch(`/api/v1/payment-methods/${id}`, data);
    return res.data;
  },
  getReasonCodes: async (): Promise<ReasonCode[]> => {
    const res = await httpClient.get('/api/v1/reason-codes');
    return res.data;
  },
  createReasonCode: async (data: Partial<ReasonCode>): Promise<ReasonCode> => {
    const res = await httpClient.post('/api/v1/reason-codes', data);
    return res.data;
  },
  updateReasonCode: async (id: string, data: Partial<ReasonCode>): Promise<ReasonCode> => {
    const res = await httpClient.patch(`/api/v1/reason-codes/${id}`, data);
    return res.data;
  },
};
