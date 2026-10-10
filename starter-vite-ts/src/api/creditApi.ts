import { httpClient } from './httpClient';

export interface CreditAccountCustomer {
  id: string;
  code: string;
  first_name: string;
  last_name: string;
  name?: string;
  mobile: string;
  email?: string;
}

export type CreditMode = 'FINITE' | 'UNLIMITED' | 'POLICY';

export interface CreditAccount {
  id: string;
  customer_id: string;
  currency_code: string;
  mode: CreditMode;
  credit_limit?: string;
  /** Negative is what the customer owes. */
  current_balance: string;
  availableCredit: string;
  policy_note?: string;
  created_at: string;
  updated_at?: string;
  customer?: CreditAccountCustomer | null;
  /** The transactions, newest first; only on a single account. */
  entries?: CreditEntry[];
}

export interface CreditEntry {
  id: string;
  account_id: string;
  entry_type: 'PURCHASE' | 'REPAYMENT' | 'REVERSAL' | 'LOYALTY_CASHBACK' | 'LOYALTY_CASHBACK_REVERSAL';
  amount: string;
  currency_code: string;
  order_id?: string;
  payment_id?: string;
  reason_text?: string;
  reference?: string;
  business_date: string;
  posted_at: string;
  posted_by?: string;
  balance_after: string;
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
      mode?: CreditMode;
      creditLimit?: string;
      policyNote?: string;
    },
  ): Promise<CreditAccount> => {
    const res = await httpClient.post(`/api/v1/customers/${customerId}/credit-accounts`, data);
    return res.data;
  },

  /** One account with its transactions. */
  getAccountById: async (id: string): Promise<CreditAccount> => {
    const res = await httpClient.get(`/api/v1/credit-accounts/${id}`);
    return res.data;
  },

  updateAccount: async (
    id: string,
    data: {
      mode?: CreditMode;
      creditLimit?: string;
      policyNote?: string;
    },
  ): Promise<CreditAccount> => {
    const res = await httpClient.patch(`/api/v1/credit-accounts/${id}`, data);
    return res.data;
  },

  postRepayment: async (
    id: string,
    data: {
      amount: string;
      reference?: string;
      reason?: string;
    },
  ): Promise<{ entry: CreditEntry; newBalance: string; availableCredit: string }> => {
    const res = await httpClient.post(`/api/v1/credit-accounts/${id}/repayments`, data);
    return res.data;
  },
};
