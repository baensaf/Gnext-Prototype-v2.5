import { httpClient } from './httpClient';

export type AgentStatus = 'ACTIVE' | 'REVOKED';

/** A branch agent: the program on the branch PC that drives its printers and card terminals. */
export interface BranchAgent {
  id: string;
  tenant_id: string;
  branch_id: string;
  branch_name?: string;
  branch_code?: string;
  status: AgentStatus;
  agent_version?: string | null;
  protocol_version?: number | null;
  hostname?: string | null;
  os?: string | null;
  machine_id?: string | null;
  enrolled_at: string;
  last_seen_at?: string | null;
  revoked_at?: string | null;
  revoked_by?: string | null;
  revoke_reason?: string | null;
  /** Whether the agent holds a live connection to the cloud right now. */
  connected?: boolean;
}

export interface AgentDeviceStatus {
  kind: 'printer' | 'terminal';
  id: string;
  status: 'ONLINE' | 'OFFLINE' | 'ERROR' | 'UNSUPPORTED' | 'UNKNOWN' | string;
  detail?: string | null;
  checked_at?: string | null;
}

export interface AgentCommandSummary {
  id: string;
  type: string;
  status: 'QUEUED' | 'SENT' | 'ACKED' | 'DONE' | 'FAILED' | 'EXPIRED';
  send_count: number;
  created_at: string;
  acked_at?: string | null;
  completed_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
}

export interface AgentHealth {
  agent: BranchAgent;
  connection: {
    connected: boolean;
    session_id?: string;
    connected_at?: string;
    last_frame_at?: string | null;
    agent_version?: string | null;
    capabilities?: string[];
    devices: AgentDeviceStatus[];
  };
  recent_commands: AgentCommandSummary[];
}

export interface AgentReleaseRow {
  id: string;
  version: string;
  sha256: string;
  size_bytes: number;
  notes?: string | null;
  min_agent_version?: string | null;
  published: boolean;
  published_at?: string | null;
  created_at: string;
  url: string;
}

export type EnrolmentCodeState = 'PENDING' | 'USED' | 'EXPIRED' | 'CANCELLED';

export interface EnrolmentCode {
  id: string;
  branch_id: string;
  expires_at: string;
  used_at?: string | null;
  agent_id?: string | null;
  cancelled_at?: string | null;
  created_by?: string | null;
  created_at: string;
  state: EnrolmentCodeState;
}

/** Returned once, when the code is created. The server keeps only a hash. */
export interface NewEnrolmentCode {
  id: string;
  branch_id: string;
  code: string;
  expires_at: string;
}

export const agentsApi = {
  list: async (params: { branchId?: string; includeRevoked?: boolean } = {}): Promise<BranchAgent[]> => {
    const res = await httpClient.get('/api/v1/agents', {
      params: { branchId: params.branchId || undefined, includeRevoked: params.includeRevoked ? 'true' : undefined },
    });
    return res.data;
  },
  health: async (id: string): Promise<AgentHealth> => {
    const res = await httpClient.get(`/api/v1/agents/${id}/health`);
    return res.data;
  },
  revoke: async (id: string, reason?: string): Promise<BranchAgent> => {
    const res = await httpClient.post(`/api/v1/agents/${id}/revoke`, { reason: reason || undefined });
    return res.data;
  },
  listCodes: async (branchId?: string): Promise<EnrolmentCode[]> => {
    const res = await httpClient.get('/api/v1/agents/enrolment-codes', { params: { branchId: branchId || undefined } });
    return res.data;
  },
  createCode: async (branchId: string): Promise<NewEnrolmentCode> => {
    const res = await httpClient.post('/api/v1/agents/enrolment-codes', { branch_id: branchId });
    return res.data;
  },
  listReleases: async (): Promise<AgentReleaseRow[]> => {
    const res = await httpClient.get('/api/v1/agent-releases');
    return res.data;
  },
  uploadRelease: async (data: { version: string; minAgentVersion?: string; notes?: string; file: File }): Promise<AgentReleaseRow> => {
    const form = new FormData();
    form.append('version', data.version);
    if (data.minAgentVersion) form.append('min_agent_version', data.minAgentVersion);
    if (data.notes) form.append('notes', data.notes);
    form.append('file', data.file);
    const res = await httpClient.post('/api/v1/agent-releases', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 10 * 60_000,
    });
    return res.data;
  },
  publishRelease: async (id: string): Promise<AgentReleaseRow> => {
    const res = await httpClient.post(`/api/v1/agent-releases/${id}/publish`, {});
    return res.data;
  },
  unpublishRelease: async (id: string): Promise<AgentReleaseRow> => {
    const res = await httpClient.post(`/api/v1/agent-releases/${id}/unpublish`, {});
    return res.data;
  },
  cancelCode: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/agents/enrolment-codes/${id}`);
  },
};
