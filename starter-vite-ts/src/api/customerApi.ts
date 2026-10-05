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
  gender?: 'MALE' | 'FEMALE' | null;
  /** Wedding date, Gregorian YYYY-MM-DD. */
  marriage_date?: string | null;
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
  /** The optional map pin. */
  latitude?: string | number | null;
  longitude?: string | number | null;
  is_default: boolean;
  /** Zones of past orders delivered to this address, the latest first. */
  last_zone_ids?: string[];
}

/** A delivery address as the register form sends it; the pin is optional. */
export interface CustomerAddressDraft {
  title: string;
  address_text: string;
  postal_code?: string;
  latitude?: number | null;
  longitude?: number | null;
}

/** What the register form sends: the whole name in one box, the mobile as the code. */
export interface CustomerRegistration {
  name: string;
  mobile: string;
  gender?: 'MALE' | 'FEMALE' | null;
  birth_date?: string;
  marriage_date?: string;
  credit_limit?: string;
  addresses?: CustomerAddressDraft[];
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

export interface CustomerPage {
  items: Customer[];
  total: number;
  page: number;
  limit: number;
}

export const customerApi = {

  /** Every customer, unpaged. Only for small lists (the V3 credit screens); the POS and the
   *  customers page search on the server instead. */
  getCustomers: async (): Promise<Customer[]> => {
    const res = await httpClient.get('/api/v1/customers');
    return res.data;
  },
  /** One page of the customers list, newest first, or the best matches when searching. */
  getCustomersPage: async (params: { search?: string; page: number; limit: number }): Promise<CustomerPage> => {
    const res = await httpClient.get('/api/v1/customers', { params: { ...params, search: params.search || undefined } });
    return res.data;
  },
  /** The POS picker: up to `limit` best matches for 3+ typed characters (mobile or name). */
  searchCustomers: async (q: string, limit = 20): Promise<Customer[]> => {
    const res = await httpClient.get('/api/v1/customers/search', { params: { q, limit } });
    return res.data;
  },
  getCustomer: async (id: string): Promise<Customer> => {
    const res = await httpClient.get(`/api/v1/customers/${id}`);
    return res.data;
  },
  createCustomer: async (data: (Partial<Customer> & { credit_limit?: string }) | CustomerRegistration): Promise<Customer> => {
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
  createAddress: async (customerId: string, data: Partial<CustomerAddress> | (CustomerAddressDraft & { is_default?: boolean })): Promise<CustomerAddress> => {
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
