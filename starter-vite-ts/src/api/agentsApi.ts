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
  /** What the agent announced in its last hello, e.g. `app.serve`; null before it ever connected. */
  capabilities?: string[] | null;
  /** The frontend build the agent serves, from its last heartbeat; null while it has none. */
  app_build_id?: string | null;
  /** The addresses other registers reach the agent on, from its last heartbeat. */
  lan_urls?: string[] | null;
}

/** How the build an agent serves compares with the cloud's current one. */
export type AgentAppState = 'NOT_SERVED' | 'UNKNOWN' | 'NO_BUILD' | 'UP_TO_DATE' | 'BEHIND';

/**
 * `cloudBuild` is the cloud's current build id (null when it could not be read). An agent without
 * `app.serve` has no app; one that serves it but has not reported yet is UNKNOWN.
 */
export function agentAppState(agent: BranchAgent, cloudBuild: string | null): AgentAppState {
  if (!agent.capabilities) return 'UNKNOWN';
  if (!agent.capabilities.includes('app.serve')) return 'NOT_SERVED';
  if (agent.app_build_id === undefined || (agent.app_build_id === null && agent.lan_urls == null)) return 'UNKNOWN';
  if (agent.app_build_id === null) return 'NO_BUILD';
  if (!cloudBuild) return 'UNKNOWN';
  return agent.app_build_id === cloudBuild ? 'UP_TO_DATE' : 'BEHIND';
}

const BUILD_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The build id of the frontend this page came from, read from its own /build-manifest.json (the
 * cloud's current build, §19.7). Null when there is no manifest (a dev server) or it cannot be read.
 */
export async function fetchCloudBuildId(): Promise<string | null> {
  try {
    const res = await fetch('/build-manifest.json', { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return null;
    const id = (await res.json())?.build_id;
    return typeof id === 'string' && BUILD_ID.test(id) ? id : null;
  } catch {
    return null;
  }
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
  cancelCode: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/agents/enrolment-codes/${id}`);
  },
};
