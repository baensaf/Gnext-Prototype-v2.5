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
  /** Whether its branch could sell offline if the internet went now (§16.8); null when away. */
  offline_ready?: {
    ready: boolean;
    problems: ('AGENT_TOO_OLD' | 'NO_TILL' | 'NO_SHIFT' | 'NO_STAFF' | 'SNAPSHOT_STALE' | 'UPLOADS_WAITING')[];
  } | null;
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

/** The branch snapshot and offline-order backlog, as the agent's last heartbeat reported them. */
export interface AgentSyncReport {
  data_version: string | null;
  data_pulled_at: string | null;
  pending_orders: number;
  oldest_pending_at: string | null;
  last_upload_at: string | null;
  last_upload_error: string | null;
  reported_at: string;
}

export type AgentSyncWarning = 'SNAPSHOT_STALE' | 'BACKLOG_STUCK' | 'UPLOAD_FAILING';

/** Which till the agent's offline till sells as, and what it still holds. */
export interface AgentTillReport {
  terminal_id: string | null;
  mode: 'ONLINE' | 'OFFLINE' | 'HANDOVER';
  open_orders: number;
  reported_at: string;
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
    sync?: AgentSyncReport | null;
    till?: AgentTillReport | null;
  };
  sync_warnings?: AgentSyncWarning[];
  recent_commands: AgentCommandSummary[];
}

/** An order a branch took offline, as its agent uploaded it. */
export interface SyncOrderRow {
  id: string;
  branch_id: string;
  branch_name: string | null;
  status: 'ACCEPTED' | 'HELD';
  flags: string[];
  error: string | null;
  order_number: string | null;
  order_state: 'COMPLETED' | 'CANCELLED' | 'OPEN' | null;
  call_number: number | null;
  placed_at: string | null;
  grand_total: string | null;
  received_at: string;
  booked_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface SyncResult {
  id: string;
  result: 'ACCEPTED' | 'DUPLICATE' | 'HELD';
  order_number: string | null;
  flags: string[];
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
  /** CI stored the setup wizard with this build. */
  has_installer: boolean;
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
  /** Saves the setup wizard of the newest published build that has one. */
  downloadInstaller: async (): Promise<void> => {
    let res;
    try {
      res = await httpClient.get('/api/v1/agent-releases/installer', { responseType: 'blob', timeout: 10 * 60_000 });
    } catch (err) {
      // A refusal arrives as a Blob too; read the problem out of it.
      if (err instanceof Blob) throw JSON.parse(await err.text());
      throw err;
    }
    const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] || '')?.[1] || 'gnext-agent-setup.exe';
    const url = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  publishRelease: async (id: string): Promise<AgentReleaseRow> => {
    const res = await httpClient.post(`/api/v1/agent-releases/${id}/publish`, {});
    return res.data;
  },
  unpublishRelease: async (id: string): Promise<AgentReleaseRow> => {
    const res = await httpClient.post(`/api/v1/agent-releases/${id}/unpublish`, {});
    return res.data;
  },
  listSyncOrders: async (params: { view?: 'attention' | 'all'; branchId?: string } = {}): Promise<SyncOrderRow[]> => {
    const res = await httpClient.get('/api/v1/agent-sync/orders', { params: { view: params.view, branchId: params.branchId || undefined } });
    return res.data;
  },
  retrySyncOrder: async (id: string): Promise<SyncResult> => {
    const res = await httpClient.post(`/api/v1/agent-sync/orders/${id}/retry`, {});
    return res.data;
  },
  reviewSyncOrder: async (id: string): Promise<void> => {
    await httpClient.post(`/api/v1/agent-sync/orders/${id}/review`, {});
  },
  cancelCode: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/agents/enrolment-codes/${id}`);
  },
};
