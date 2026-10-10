import { httpClient } from './httpClient';

export interface ProfileOrder {
  id: string;
  order_number: string;
  order_type: string;
  channel: string;
  state: string;
  grand_total: string;
  currency_code: string;
  placed_at: string;
  branch_id: string;
  branch_name: string | null;
}

export interface ProfileOrderStats {
  order_count: number;
  completed_count: number;
  cancelled_count: number;
  completed_value: string;
  average_value: string;
  first_order_at: string | null;
  last_order_at: string | null;
}

export interface ProfileAuditEvent {
  id: string;
  action: string;
  actor_type: string;
  actor_id: string | null;
  actor_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  branch_id: string | null;
  correlation_id: string | null;
  before_data: Record<string, any> | null;
  after_data: Record<string, any> | null;
  details: Record<string, any> | null;
  occurred_at: string;
}

export interface CustomerProfile {
  customer: {
    id: string;
    code: string;
    first_name: string;
    last_name: string;
    mobile: string;
    email: string | null;
    national_id: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  };
  phones: { id: string; phone_number: string; label: string; is_primary: boolean; is_verified: boolean }[];
  addresses: { id: string; title: string; address_text: string; postal_code?: string | null; is_default: boolean }[];
  stats: ProfileOrderStats;
  orders: ProfileOrder[];
  credit: {
    account: {
      id: string;
      credit_limit: string;
      current_balance: string;
      currency_code: string;
    };
    entries: {
      id: string;
      entry_type: string;
      amount: string;
      balance_after: string;
      currency_code: string;
      order_id: string | null;
      reason_text: string | null;
      reference: string | null;
      posted_at: string;
    }[];
  } | null;
  audit: ProfileAuditEvent[];
}

export interface UserProfile {
  user: {
    id: string;
    username: string;
    display_name: string;
    role: string;
    branch_id: string | null;
    branch_name: string | null;
    is_active: boolean;
    preferred_locale: string;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
    has_pin: boolean;
    created_by_name: string | null;
  };
  stats: ProfileOrderStats & {
    shift_count: number;
    closed_shift_count: number;
    net_short_over: string;
    approval_decision_count: number;
    approved_count: number;
    rejected_count: number;
  };
  orders: ProfileOrder[];
  shifts: {
    id: string;
    shift_number: string;
    state: string;
    business_date: string;
    opened_at: string;
    closed_at: string | null;
    currency_code: string;
    opening_cash: string;
    expected_cash: string | null;
    actual_cash: string | null;
    short_over: string | null;
    branch_name: string | null;
    terminal_name: string | null;
    opened_by_user: boolean;
    closed_by_user: boolean;
  }[];
  audit: ProfileAuditEvent[];
}

export const profilesApi = {
  customer: async (id: string): Promise<CustomerProfile> => {
    const res = await httpClient.get(`/api/v1/customers/${id}/profile`);
    return res.data;
  },
  user: async (id: string): Promise<UserProfile> => {
    const res = await httpClient.get(`/api/v1/users/${id}/profile`);
    return res.data;
  },
};
