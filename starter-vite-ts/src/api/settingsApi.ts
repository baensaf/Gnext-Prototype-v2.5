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

/** One setting group as it applies somewhere, and where the value came from. */
export interface ScopedSettingGroup {
  value: Record<string, any>;
  /** ORG when inherited from head office, BRANCH when this location overrides it. */
  source: 'BRANCH' | 'ORG';
  /** Whether a branch is allowed to diverge from head office on this group at all. */
  overridable: boolean;
}

export interface ScopedSettings {
  branch_id: string | null;
  groups: Record<string, ScopedSettingGroup>;
  /**
   * Every group a branch is allowed to diverge on, including ones nobody has written yet.
   * Those have no row to resolve, so they never appear in `groups` — and a screen listing
   * only what exists cannot show what a branch is permitted to change.
   */
  overridable_groups?: string[];
}

export const settingsApi = {
  /** Values in force at `branchId` — the branch's overrides over the organization's. */
  getSettings: async (branchId?: string): Promise<Record<string, any>> => {
    const res = await httpClient.get('/api/v1/settings', { params: { branchId } });
    return res.data;
  },
  /** The same values, annotated with the level that supplied each one. */
  getScopedSettings: async (branchId?: string): Promise<ScopedSettings> => {
    const res = await httpClient.get('/api/v1/settings/scoped', { params: { branchId } });
    return res.data;
  },
  updateSetting: async (key: string, value: any, branchId?: string): Promise<any> => {
    const res = await httpClient.patch('/api/v1/settings', { key, value, branchId });
    return res.data;
  },
  /** Drop this branch's override so it inherits from head office again. */
  clearBranchOverride: async (key: string, branchId: string): Promise<any> => {
    const res = await httpClient.delete(`/api/v1/settings/${key}/override`, { params: { branchId } });
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
