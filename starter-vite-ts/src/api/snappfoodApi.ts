import { httpClient } from './httpClient';

export type SnappfoodMode = 'SIMULATED' | 'STAGING' | 'PRODUCTION';

export interface SnappfoodSetup {
  webhook: { path: string; hmac_set: boolean; last_received_at: string | null };
  branches: Array<{
    branch_id: string;
    name: string;
    mode: SnappfoodMode;
    vendor_code: string | null;
    client_id: string | null;
    username: string | null;
    has_client_secret: boolean;
    has_password: boolean;
    live: boolean;
  }>;
}

export interface SnappfoodBranchInput {
  mode: SnappfoodMode;
  vendorCode: string | null;
  clientId: string | null;
  /** Left out to keep the one saved. */
  clientSecret?: string;
  username: string | null;
  /** Left out to keep the one saved. */
  password?: string;
}

export type SnappfoodTestResult =
  | { ok: true; status: string | null; vendor_title: string | null; vendor_code: string | null }
  | { ok: false; code: string; message: string };

export const snappfoodApi = {
  getSetup: async (): Promise<SnappfoodSetup> => (await httpClient.get('/api/v1/snappfood/setup')).data,

  rotateWebhook: async (): Promise<SnappfoodSetup> => (await httpClient.post('/api/v1/snappfood/webhook/rotate', {})).data,

  /** null clears the secret, and the address alone authenticates Snappfood again. */
  setHmac: async (secret: string | null): Promise<SnappfoodSetup> =>
    (await httpClient.put('/api/v1/snappfood/webhook/hmac', { secret })).data,

  saveBranch: async (branchId: string, data: SnappfoodBranchInput): Promise<SnappfoodSetup> =>
    (await httpClient.put(`/api/v1/snappfood/branches/${branchId}`, data)).data,

  testBranch: async (branchId: string): Promise<SnappfoodTestResult> =>
    (await httpClient.post(`/api/v1/snappfood/branches/${branchId}/test`, {})).data,
};
