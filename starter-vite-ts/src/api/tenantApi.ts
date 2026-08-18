import { httpClient } from './httpClient';

export interface Branch {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  phone?: string;
  address?: string;
  time_zone?: string;
  price_group_id?: string;
  is_active: boolean;
  created_at: string;
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
}

export interface BranchStatusSnapshot {
  is_online: boolean;
  agent_version?: string;
  agent_health: string;
  last_heartbeat_at?: string;
  last_sync_at?: string;
  simulated?: boolean;
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
  getBranches: async (): Promise<Branch[]> => {
    const res = await httpClient.get('/api/v1/branches');
    return res.data;
  },
  getBranchById: async (id: string): Promise<Branch> => {
    const res = await httpClient.get(`/api/v1/branches/${id}`);
    return res.data;
  },
  createBranch: async (data: Partial<Branch>): Promise<Branch> => {
    const res = await httpClient.post('/api/v1/branches', data);
    return res.data;
  },
  updateBranch: async (id: string, data: Partial<Branch>): Promise<Branch> => {
    const res = await httpClient.patch(`/api/v1/branches/${id}`, data);
    return res.data;
  },
  archiveBranch: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/branches/${id}`);
  },
  getBranchHours: async (id: string): Promise<BranchOperatingHour[]> => {
    const res = await httpClient.get(`/api/v1/branches/${id}/operating-hours`);
    return res.data;
  },
  updateBranchHours: async (id: string, hours: BranchOperatingHour[]): Promise<BranchOperatingHour[]> => {
    const res = await httpClient.patch(`/api/v1/branches/${id}/operating-hours`, { hours });
    return res.data;
  },
  getBranchStatus: async (id: string): Promise<BranchStatusSnapshot> => {
    const res = await httpClient.get(`/api/v1/branches/${id}/status`);
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
