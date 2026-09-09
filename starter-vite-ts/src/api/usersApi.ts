import { httpClient } from './httpClient';

export interface AdminUserRow {
  id: string;
  username: string;
  display_name: string;
  role: string;
  /** null means the account is not confined to a location. */
  branch_id: string | null;
  branch_name: string | null;
  is_active: boolean;
  preferred_locale: string;
  last_login_at: string | null;
  /** Whether the account can approve with a pin. The pin itself never leaves the server. */
  has_pin: boolean;
}

export interface AdminUserWrite {
  username?: string;
  display_name?: string;
  role?: string;
  branch_id?: string | null;
  is_active?: boolean;
  preferred_locale?: string;
  /** Optional. Left out, a new account starts on the shared demo password. */
  password?: string;
  pin?: string;
}

export const usersApi = {
  list: async (): Promise<AdminUserRow[]> => {
    const res = await httpClient.get('/api/v1/users');
    return res.data;
  },
  create: async (data: AdminUserWrite): Promise<AdminUserRow> => {
    const res = await httpClient.post('/api/v1/users', data);
    return res.data;
  },
  update: async (id: string, data: AdminUserWrite): Promise<AdminUserRow> => {
    const res = await httpClient.patch(`/api/v1/users/${id}`, data);
    return res.data;
  },
};
