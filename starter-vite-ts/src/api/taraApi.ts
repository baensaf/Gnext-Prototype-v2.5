import { httpClient } from './httpClient';

/** One of Tara's product groups. */
export interface TaraGroup {
  tag: string;
  id: number;
  name: string;
  title: string;
}

export interface TaraSetup {
  connection: {
    username: string;
    connected: boolean;
    connected_at: string | null;
    groups: TaraGroup[];
    default_group_id: number | null;
    category_groups: Record<string, number>;
  } | null;
  method: { id: string; is_active: boolean } | null;
  branches: Array<{
    branch_id: string;
    name: string;
    branch_code: string | null;
    terminals_fetched_at: string | null;
    terminals: Array<{ id: string; terminal_code: string; terminal_title: string | null; register_id: string | null }>;
    registers: Array<{ id: string; name: string; code: string }>;
  }>;
  categories: Array<{ id: string; name: string }>;
}

/** Whether this till can take Tara, or why not. */
export type TaraTill =
  | { available: true; terminal_title: string | null; terminal_code: string }
  | { available: false; reason: 'NOT_CONNECTED' | 'NO_BRANCH_CODE' | 'NO_TERMINAL' };

export interface TaraDemoCustomer {
  barcode: string;
  outcome: 'APPROVED' | 'NOT_ELIGIBLE' | 'LOW_LIMIT' | 'REQUEST_NO_REPLY' | 'VERIFY_NO_REPLY';
  limit: string;
}

export const taraApi = {
  getSetup: async (): Promise<TaraSetup> => (await httpClient.get('/api/v1/tara/setup')).data,

  connect: async (data: { username: string; password?: string }): Promise<TaraSetup> =>
    (await httpClient.put('/api/v1/tara/connection', data)).data,

  disconnect: async (): Promise<TaraSetup> => (await httpClient.delete('/api/v1/tara/connection')).data,

  /** Saves a branch's Tara code and fetches its terminals; an empty code removes them. */
  setBranchCode: async (branchId: string, branchCode: string): Promise<TaraSetup> =>
    (await httpClient.put(`/api/v1/tara/branches/${branchId}`, { branchCode })).data,

  assignTerminal: async (terminalId: string, registerId: string | null): Promise<TaraSetup> =>
    (await httpClient.put(`/api/v1/tara/terminals/${terminalId}`, { registerId })).data,

  saveGroups: async (data: { defaultGroupId: number | null; categoryGroups: Record<string, number | null> }): Promise<TaraSetup> =>
    (await httpClient.put('/api/v1/tara/groups', data)).data,

  refreshGroups: async (): Promise<TaraSetup> => (await httpClient.post('/api/v1/tara/groups/refresh', {})).data,

  till: async (orderId: string): Promise<TaraTill> => (await httpClient.get('/api/v1/tara/till', { params: { orderId } })).data,

  demoCustomers: async (): Promise<TaraDemoCustomer[]> => (await httpClient.get('/api/v1/tara/demo-customers')).data,

  /** A manager asks Tara again about a sale that never got an answer. */
  check: async (paymentId: string) => (await httpClient.post(`/api/v1/tara/payments/${paymentId}/check`, {})).data,
};
