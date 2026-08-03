import { httpClient } from './httpClient';

export interface CustomerGroup {
  id: string;
  code: string;
  name: string;
  discount_id?: string;
  price_group_id?: string;
  is_active: boolean;
}

export interface Customer {
  id: string;
  code: string;
  first_name: string;
  last_name: string;
  mobile: string;
  email?: string;
  customer_group_id?: string;
  national_id?: string;
  is_active: boolean;
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
  getCustomerGroups: async (): Promise<CustomerGroup[]> => {
    const res = await httpClient.get('/api/v1/customer-groups');
    return res.data;
  },
  createCustomerGroup: async (data: Partial<CustomerGroup>): Promise<CustomerGroup> => {
    const res = await httpClient.post('/api/v1/customer-groups', data);
    return res.data;
  },

  getCustomers: async (search?: string): Promise<Customer[]> => {
    const res = await httpClient.get('/api/v1/customers', { params: { search } });
    return res.data;
  },
  createCustomer: async (data: Partial<Customer> & { credit_limit?: string }): Promise<Customer> => {
    const res = await httpClient.post('/api/v1/customers', data);
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
};
