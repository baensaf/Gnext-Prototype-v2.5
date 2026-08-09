import { httpClient } from './httpClient';

export interface CreditAccount {
  id: string;
  customer_id: string;
  currency_code: string;
  mode: 'FINITE' | 'UNLIMITED' | 'POLICY';
  credit_limit?: string;
  current_balance: string;
  availableCredit: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  is_blocked: boolean;
  policy_note?: string;
  created_at: string;
}

export interface CreditEntry {
  id: string;
  account_id: string;
  entry_type: 'PURCHASE' | 'REPAYMENT' | 'ADJUSTMENT' | 'REFUND' | 'REVERSAL';
  amount: string;
  currency_code: string;
  order_id?: string;
  payment_id?: string;
  reason_text?: string;
  reference?: string;
  business_date: string;
  posted_at: string;
  balance_after: string;
}

export interface CreditStatement {
  accountId: string;
  customerId: string;
  currencyCode: string;
  openingBalance: string;
  closingBalance: string;
  entries: CreditEntry[];
}

export interface CreditAging {
  asOf: string;
  totals: {
    totalOutstanding: string;
    current: string;
    days31_60: string;
    days61_90: string;
    days90Plus: string;
  };
  customers: Array<{
    accountId: string;
    customerId: string;
    totalExposure: string;
    current: string;
    days31_60: string;
    days61_90: string;
    days90Plus: string;
  }>;
}

export const creditApi = {
  getAccounts: async (params?: Record<string, any>): Promise<{ data: CreditAccount[]; total: number }> => {
    const res = await httpClient.get('/api/v1/credit-accounts', { params });
    if (Array.isArray(res.data)) {
      return { data: res.data, total: res.data.length };
    }
    return res.data;
  },

  createAccount: async (
    customerId: string,
    data: {
      currencyCode?: string;
      mode?: 'FINITE' | 'UNLIMITED' | 'POLICY';
      creditLimit?: string;
      policyNote?: string;
    },
  ): Promise<CreditAccount> => {
    const res = await httpClient.post(`/api/v1/customers/${customerId}/credit-accounts`, data);
    return res.data;
  },

  getAccountById: async (id: string): Promise<CreditAccount> => {
    const res = await httpClient.get(`/api/v1/credit-accounts/${id}`);
    return res.data;
  },

  updateAccount: async (
    id: string,
    data: {
      mode?: 'FINITE' | 'UNLIMITED' | 'POLICY';
      creditLimit?: string;
      policyNote?: string;
      approvalRequestId?: string;
    },
  ): Promise<CreditAccount> => {
    const res = await httpClient.patch(`/api/v1/credit-accounts/${id}`, data);
    return res.data;
  },

  suspendAccount: async (id: string, reason: string): Promise<CreditAccount> => {
    const res = await httpClient.post(`/api/v1/credit-accounts/${id}/suspend`, { reason });
    return res.data;
  },

  activateAccount: async (id: string, reason: string): Promise<CreditAccount> => {
    const res = await httpClient.post(`/api/v1/credit-accounts/${id}/activate`, { reason });
    return res.data;
  },

  getStatement: async (id: string, params?: Record<string, any>): Promise<CreditStatement> => {
    const res = await httpClient.get(`/api/v1/credit-accounts/${id}/statement`, { params });
    return res.data;
  },

  postRepayment: async (
    id: string,
    data: {
      amount: string;
      methodId?: string;
      reference?: string;
      reason?: string;
      approvalRequestId?: string;
    },
  ): Promise<{ entry: CreditEntry; newBalance: string; availableCredit: string }> => {
    const res = await httpClient.post(`/api/v1/credit-accounts/${id}/repayments`, data);
    return res.data;
  },

  postAdjustment: async (
    id: string,
    data: {
      amountSigned: string;
      reasonCodeId?: string;
      reason: string;
      reference?: string;
      approvalRequestId: string;
    },
  ): Promise<{ entry: CreditEntry; newBalance: string; availableCredit: string }> => {
    const res = await httpClient.post(`/api/v1/credit-accounts/${id}/adjustments`, data);
    return res.data;
  },

  getCreditAging: async (params?: Record<string, any>): Promise<CreditAging> => {
    const res = await httpClient.get('/api/v1/credit-aging', { params });
    return res.data;
  },
};
