import { httpClient } from './httpClient';

/** Mirrors the backend BranchType: only a RESTAURANT sells to customers. */
export type BranchType = 'COMMISSARY' | 'OFFICE' | 'RESTAURANT';

export interface Branch {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  branch_type?: BranchType;
  phone?: string;
  address?: string;
  time_zone?: string;
  /** The branch's pin on the map; null on branches made before pins were required. */
  latitude?: number | null;
  longitude?: number | null;
  is_active: boolean;
  created_at: string;
  /** Set while archived. */
  deleted_at?: string | null;
}

/** One shift of a day as the server takes it; a closed day is one row with is_closed. */
export type OpeningHoursInput = { day_of_week: number; open_time?: string; close_time?: string; is_closed?: boolean };

/** What head office sends to add a branch: its details, pin and weekly hours in one go. */
export interface NewBranch {
  name: string;
  branch_type?: BranchType;
  phone?: string;
  address?: string;
  time_zone: string;
  latitude: number;
  longitude: number;
  hours: OpeningHoursInput[];
}

export interface BranchOperatingHour {
  id: string;
  branch_id: string;
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
  spans_midnight: boolean;
}

export interface Terminal {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  terminal_type: 'CASHIER' | 'KIOSK' | 'KDS';
  is_active: boolean;
  last_seen_at?: string;
  /** A kiosk's card terminal, charged through the branch agent. */
  payment_device_id?: string | null;
  /** Where its receipts, bills and courier slips print; null: the branch's receipt printer. */
  receipt_printer_id?: string | null;
  receipt_copies?: number;
  receipt_template?: 'COMPACT' | 'DETAILED' | null;
}

export const tenantApi = {
  getTenantProfile: async (): Promise<any> => {
    const res = await httpClient.get('/api/v1/tenant');
    return res.data;
  },
  updateTenantProfile: async (data: any): Promise<any> => {
    const res = await httpClient.patch('/api/v1/tenant', data);
    return res.data;
  },
  /** `archived` adds archived branches, for head office's branch list. */
  getBranches: async (options: { archived?: boolean } = {}): Promise<Branch[]> => {
    const res = await httpClient.get('/api/v1/branches', { params: options.archived ? { archived: 1 } : undefined });
    return res.data;
  },
  getBranchById: async (id: string): Promise<Branch> => {
    const res = await httpClient.get(`/api/v1/branches/${id}`);
    return res.data;
  },
  createBranch: async (data: NewBranch): Promise<Branch> => {
    const res = await httpClient.post('/api/v1/branches', data);
    return res.data;
  },
  updateBranch: async (id: string, data: Partial<Branch>): Promise<Branch> => {
    const res = await httpClient.patch(`/api/v1/branches/${id}`, data);
    return res.data;
  },
  archiveBranch: async (id: string): Promise<{ agentsRevoked: number; staffWithoutBranch: number }> => {
    const res = await httpClient.delete(`/api/v1/branches/${id}`);
    return res.data;
  },
  restoreBranch: async (id: string): Promise<Branch> => {
    const res = await httpClient.post(`/api/v1/branches/${id}/restore`);
    return res.data;
  },
  getBranchHours: async (id: string): Promise<BranchOperatingHour[]> => {
    const res = await httpClient.get(`/api/v1/branches/${id}/operating-hours`);
    return res.data;
  },
  updateBranchHours: async (id: string, hours: OpeningHoursInput[]): Promise<BranchOperatingHour[]> => {
    const res = await httpClient.patch(`/api/v1/branches/${id}/operating-hours`, { hours });
    return res.data;
  },
  getTerminals: async (branchId?: string): Promise<Terminal[]> => {
    const res = await httpClient.get('/api/v1/terminals', { params: { branchId } });
    return res.data;
  },
  createTerminal: async (data: Partial<Terminal>): Promise<Terminal> => {
    const res = await httpClient.post('/api/v1/terminals', data);
    return res.data;
  },
  updateTerminal: async (id: string, data: Partial<Terminal>): Promise<Terminal> => {
    const res = await httpClient.patch(`/api/v1/terminals/${id}`, data);
    return res.data;
  },
  archiveTerminal: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/terminals/${id}`);
  },
};
