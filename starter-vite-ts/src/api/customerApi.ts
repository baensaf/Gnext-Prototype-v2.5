import { httpClient } from './httpClient';

export interface Customer {
  id: string;
  code: string;
  first_name: string;
  last_name: string;
  mobile: string;
  email?: string;
  national_id?: string;
  /** Gregorian YYYY-MM-DD; the picker shows it in the chain's calendar. */
  birth_date?: string | null;
  /**
   * The chain refuses to serve this customer: they cannot be put on a new order at all.
   * Not the same as a blocked credit account, which only stops them paying on account.
   */
  is_blocked?: boolean;
  blocked_reason?: string | null;
  blocked_at?: string | null;
  is_active: boolean;
  credit_account?: CustomerCreditAccount | null;
  wallet_balance?: string;
  credit_limit?: string;
}

export interface CustomerAddress {
  id: string;
  customer_id: string;
  title: string;
  address_text: string;
  postal_code?: string;
  is_default: boolean;
}

export interface CustomerCreditAccount {
  id: string;
  customer_id: string;
  credit_limit: string;
  current_balance: string;
  is_blocked: boolean;
}

export interface CustomerCreditTransaction {
  id: string;
  account_id: string;
  transaction_type: 'CHARGE' | 'DEBIT' | 'SETTLEMENT' | 'ADJUSTMENT';
  amount: string;
  note?: string;
  recorded_at: string;
}

export const customerApi = {

  getCustomers: async (search?: string): Promise<Customer[]> => {
    const res = await httpClient.get('/api/v1/customers', { params: { search } });
    return res.data;
  },
  createCustomer: async (data: Partial<Customer> & { credit_limit?: string }): Promise<Customer> => {
    const res = await httpClient.post('/api/v1/customers', data);
    return res.data;
  },
  updateCustomer: async (id: string, data: Partial<Customer>): Promise<Customer> => {
    const res = await httpClient.patch(`/api/v1/customers/${id}`, data);
    return res.data;
  },
  /** Refusing service needs a reason; lifting it does not. */
  blockCustomer: async (id: string, reason: string): Promise<Customer> => {
    const res = await httpClient.post(`/api/v1/customers/${id}/block`, { reason });
    return res.data;
  },
  unblockCustomer: async (id: string): Promise<Customer> => {
    const res = await httpClient.post(`/api/v1/customers/${id}/unblock`, {});
    return res.data;
  },

  getAddresses: async (customerId: string): Promise<CustomerAddress[]> => {
    const res = await httpClient.get(`/api/v1/customers/${customerId}/addresses`);
    return res.data;
  },
  createAddress: async (customerId: string, data: Partial<CustomerAddress>): Promise<CustomerAddress> => {
    const res = await httpClient.post(`/api/v1/customers/${customerId}/addresses`, data);
    return res.data;
  },

  getCreditAccount: async (
    customerId: string,
  ): Promise<{ account: CustomerCreditAccount; transactions: CustomerCreditTransaction[] }> => {
    const res = await httpClient.get(`/api/v1/customers/${customerId}/credit-account`);
    return res.data;
  },
  postCreditTransaction: async (
    customerId: string,
    data: { transaction_type: string; amount: string; note?: string },
  ): Promise<{ account: CustomerCreditAccount; transaction: CustomerCreditTransaction }> => {
    const res = await httpClient.post(`/api/v1/customers/${customerId}/credit-account/transactions`, data);
    return res.data;
  },
  postRepayment: async (
    customerId: string,
    data: { amount: string; note?: string; reference_id?: string },
  ): Promise<{ account: CustomerCreditAccount; transaction: CustomerCreditTransaction }> => {
    const res = await httpClient.post(`/api/v1/customers/${customerId}/credit-account/repayments`, data);
    return res.data;
  },
  postAdjustment: async (
    customerId: string,
    data: { amount: string; note?: string; reference_id?: string },
  ): Promise<{ account: CustomerCreditAccount; transaction: CustomerCreditTransaction }> => {
    const res = await httpClient.post(`/api/v1/customers/${customerId}/credit-account/adjustments`, data);
    return res.data;
  },
  getCreditStatement: async (customerId: string): Promise<any> => {
    const res = await httpClient.get(`/api/v1/customers/${customerId}/credit-account/statement`);
    return res.data;
  },
  getCreditAgingReport: async (): Promise<any[]> => {
    const res = await httpClient.get('/api/v1/customers/credit/aging');
    return res.data;
  },
};
