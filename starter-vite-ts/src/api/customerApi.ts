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
  /** Answers to head office's customer fields, by field id. */
  custom_values?: Record<string, string | null>;
  is_active: boolean;
  /** Pay later: what the customer owes (a negative balance) against a limit. */
  credit_account?: CustomerCreditAccount | null;
  /** Cashback the customer earned, spent at the till. Never shares a balance with credit. */
  wallet_account?: CustomerCreditAccount | null;
  wallet_balance?: string;
  credit_limit?: string;
  /** The groups the customer is in. */
  groups?: CustomerGroupRef[];
}

/** A group a customer is in, and the branch they belong to there. */
export interface CustomerGroupRef {
  id: string;
  name: string;
  branch_id: string | null;
}

/** The customer list's filters: anyone in a group, who owes, who has wallet money. */
export type CustomerListFilter = 'GROUPED' | 'OWES' | 'WALLET';

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
  birth_date?: string;
  custom_values?: Record<string, string | null>;
  credit_limit?: string;
  addresses?: CustomerAddressDraft[];
}

export type CustomFieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'CHOICE';

/** A question head office adds to every customer record, such as gender or a wedding date. */
export interface CustomField {
  id: string;
  name: string;
  data_type: CustomFieldType;
  /** The answers a CHOICE field offers. */
  options: string[];
  is_required: boolean;
  is_active: boolean;
}

export type CustomFieldDraft = Pick<CustomField, 'name' | 'data_type' | 'options' | 'is_required'>;

export interface CustomerCreditAccount {
  id: string;
  customer_id: string;
  credit_limit: string;
  current_balance: string;
  mode?: 'FINITE' | 'UNLIMITED' | 'POLICY';
}

export interface CustomerPage {
  items: Customer[];
  total: number;
  page: number;
  limit: number;
  /** How many customers each tab of the list holds. */
  counts?: Record<'ALL' | CustomerListFilter, number>;
}

export const customerApi = {
  getCustomFields: async (includeArchived = false): Promise<CustomField[]> => {
    const res = await httpClient.get('/api/v1/customer-fields', { params: includeArchived ? { includeArchived: 'true' } : undefined });
    return res.data;
  },
  createCustomField: async (data: CustomFieldDraft): Promise<CustomField> => {
    const res = await httpClient.post('/api/v1/customer-fields', data);
    return res.data;
  },
  updateCustomField: async (id: string, data: Partial<CustomFieldDraft>): Promise<CustomField> => {
    const res = await httpClient.patch(`/api/v1/customer-fields/${id}`, data);
    return res.data;
  },
  archiveCustomField: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/customer-fields/${id}`);
  },


  /** Every customer, unpaged. Only for small lists (the V3 credit screen); the POS and the
   *  customers page search on the server instead. */
  getCustomers: async (): Promise<Customer[]> => {
    const res = await httpClient.get('/api/v1/customers');
    return res.data;
  },
  /** One page of the customers list, newest first, or the best matches when searching. */
  getCustomersPage: async (params: {
    search?: string;
    page: number;
    limit: number;
    has?: CustomerListFilter;
    groupId?: string;
  }): Promise<CustomerPage> => {
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
  /** Email and national ID take null to clear them. */
  updateCustomer: async (
    id: string,
    data: Partial<Omit<Customer, 'email' | 'national_id'>> & { email?: string | null; national_id?: string | null }
  ): Promise<Customer> => {
    const res = await httpClient.patch(`/api/v1/customers/${id}`, data);
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
};
