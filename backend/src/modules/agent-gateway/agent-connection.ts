import { randomUUID } from 'crypto';
import { Agent } from '../../entities/Agent.entity';
import { AgentConfig } from './agent-config.service';
import { AgentMessageHandlers } from './agent-message-handlers.service';
import {
  AGENT_CLOSE,
  compareVersions,
  envelope,
  Envelope,
  EnvelopeErrorCode,
  HANDSHAKE_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_S,
  negotiateVersion,
  parseFrame,
} from './agent-protocol';
import { AgentConnectionHandle, AgentSessionsService } from './agent-sessions.service';

/** The part of a WebSocket the connection needs; `ws` provides it, and so does a test double. */
export interface AgentSocket {
  send(data: string): void;
  close(code: number, reason: string): void;
  isOpen(): boolean;
}

export interface DeviceStatusEntry {
  kind: 'printer' | 'terminal';
  id: string;
  status: string;
  detail?: string | null;
  checked_at?: string | null;
}

export interface AgentConnectionDeps {
  sessions: AgentSessionsService;
  handlers: AgentMessageHandlers;
  loadConfig(agent: Agent): Promise<AgentConfig>;
  branchName(agent: Agent): Promise<string | null>;
  /**
   * Stores what the agent said about itself in `hello`. Returns false when the agent is no
   * longer active: it was revoked between the upgrade and now.
   */
  recordHello(agent: Agent, info: { agentVersion: string | null; protocolVersion: number }): Promise<boolean>;
  /** Stamps last_seen_at (throttled by the caller). */
  touch(agent: Agent): Promise<void>;
  minAgentVersion?: string | null;
  /** The newest published build, for `welcome.update` and the minimum version it demands. */
  latestRelease?: () => Promise<{ version: string; min_agent_version: string | null } | null>;
  /** Today's POS call-number count at the agent's branch, for an offline till's `heartbeat.ack` (§13.9). */
  callNumbers?: (agent: Agent) => Promise<{ business_date: string; POS: number }>;
  heartbeatIntervalS?: number;
  handshakeTimeoutMs?: number;
  log?: (message: string) => void;
}

/** The branch snapshot and offline-order backlog an agent reports in its heartbeats (§12.7). */
export interface AgentSyncReport {
  data_version: string | null;
  data_pulled_at: string | null;
  pending_orders: number;
  oldest_pending_at: string | null;
  last_upload_at: string | null;
  last_upload_error: string | null;
  reported_at: string;
}

/** Which till an agent's offline till sells as, and what it still holds (§13.10). */
export interface AgentTillReport {
  terminal_id: string | null;
  mode: 'ONLINE' | 'OFFLINE' | 'HANDOVER';
  open_orders: number;
  reported_at: string;
}

export interface LiveAgentConnectionHandle extends AgentConnectionHandle {
  devices: Map<string, DeviceStatusEntry>;
  lastFrameAt: Date;
  sync?: AgentSyncReport | null;
  till?: AgentTillReport | null;
}

const text = (v: unknown, max = 500) => (typeof v === 'string' && v ? v.slice(0, max) : null);
const TILL_MODES = new Set(['ONLINE', 'OFFLINE', 'HANDOVER']);

/** What the agent said in a heartbeat's `till`, cut to known fields. */
export function readTillReport(raw: unknown, at = new Date()): AgentTillReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const open = Number(t.open_orders);
  const id = text(t.terminal_id, 64);
  return {
    terminal_id: id && /^[0-9a-f-]{36}$/i.test(id) ? id : null,
    mode: TILL_MODES.has(t.mode as string) ? (t.mode as AgentTillReport['mode']) : 'ONLINE',
    open_orders: Number.isInteger(open) && open >= 0 ? open : 0,
    reported_at: at.toISOString(),
  };
}

/** What the agent said in a heartbeat's `sync`, cut to known fields and sizes. */
export function readSyncReport(raw: unknown, at = new Date()): AgentSyncReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const pending = Number(s.pending_orders);
  return {
    data_version: text(s.data_version, 64),
    data_pulled_at: text(s.data_pulled_at, 40),
    pending_orders: Number.isInteger(pending) && pending >= 0 ? pending : 0,
    oldest_pending_at: text(s.oldest_pending_at, 40),
    last_upload_at: text(s.last_upload_at, 40),
    last_upload_error: text(s.last_upload_error),
    reported_at: at.toISOString(),
  };
}

const DEVICE_STATUSES = new Set(['ONLINE', 'OFFLINE', 'ERROR', 'UNSUPPORTED', 'UNKNOWN']);

/**
 * One agent socket from the upgrade to the close: handshake (§4.2), heartbeats and liveness
 * (§4.3), and routing everything else to the registered handlers with an ack (§4.4).
 */
export class AgentConnection {
  private state: 'AWAITING_HELLO' | 'OPEN' | 'CLOSED' = 'AWAITING_HELLO';
  private handle: LiveAgentConnectionHandle | null = null;
  private handshakeTimer: NodeJS.Timeout | null = null;
  private livenessTimer: NodeJS.Timeout | null = null;
  private lastFrameAt = Date.now();
  private readonly heartbeatIntervalS: number;

  constructor(
    private readonly socket: AgentSocket,
    private readonly agent: Agent,
    private readonly deps: AgentConnectionDeps,
  ) {
    this.heartbeatIntervalS = deps.heartbeatIntervalS ?? HEARTBEAT_INTERVAL_S;
    this.handshakeTimer = setTimeout(
      () => this.close(AGENT_CLOSE.HANDSHAKE_TIMEOUT, 'HANDSHAKE_TIMEOUT'),
      deps.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS,
    );
  }

  get isOpen(): boolean {
    return this.state === 'OPEN';
  }

  get connectionHandle(): LiveAgentConnectionHandle | null {
    return this.handle;
  }

  async onFrame(raw: string): Promise<void> {
    if (this.state === 'CLOSED') return;
    this.lastFrameAt = Date.now();
    if (this.handle) this.handle.lastFrameAt = new Date(this.lastFrameAt);

    const parsed = parseFrame(raw);
    // The project compiles without strictNullChecks, so `ok` alone does not narrow the union.
    if ('error' in parsed) {
      this.sendError('BAD_MESSAGE', parsed.error, parsed.ref);
      return;
    }
    const message = parsed.message;

    if (this.state === 'AWAITING_HELLO') {
      if (message.type !== 'hello') {
        this.sendError('NOT_READY', 'send hello first', message.id);
        return;
      }
      await this.onHello(message);
      return;
    }

    try {
      await this.route(message);
    } catch (err: any) {
      this.deps.log?.(`agent ${this.agent.id}: ${message.type} failed: ${err?.message || err}`);
      if (expectsAck(message.type)) this.sendAck(message.id, { code: 'INTERNAL', message: 'internal error' });
    }
  }

  /** The socket closed, for whatever reason. */
  onClosed(): void {
    if (this.state === 'CLOSED') return;
    this.state = 'CLOSED';
    this.clearTimers();
    if (this.handle) this.deps.sessions.unregister(this.handle);
  }

  close(code: number, reason: string): void {
    if (this.state === 'CLOSED') return;
    this.onClosed();
    try {
      this.socket.close(code, reason);
    } catch {
      // Already gone.
    }
  }

  private async onHello(message: Envelope) {
    const p = message.payload;
    const version = negotiateVersion(p.protocol_versions);
    if (version === null) {
      this.close(AGENT_CLOSE.PROTOCOL_UNSUPPORTED, 'PROTOCOL_UNSUPPORTED');
      return;
    }
    const agentVersion = typeof p.agent_version === 'string' ? p.agent_version.slice(0, 32) : null;
    const latest = (await this.deps.latestRelease?.().catch(() => null)) ?? null;
    const min = [this.deps.minAgentVersion, latest?.min_agent_version]
      .filter((v): v is string => !!v)
      .sort((a, b) => compareVersions(b, a))[0];
    if (min && (!agentVersion || compareVersions(agentVersion, min) < 0)) {
      this.close(AGENT_CLOSE.UPGRADE_REQUIRED, 'UPGRADE_REQUIRED');
      return;
    }

    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;

    const stillActive = await this.deps.recordHello(this.agent, { agentVersion, protocolVersion: version });
    if (!stillActive) {
      this.close(AGENT_CLOSE.REVOKED, 'AGENT_REVOKED');
      return;
    }
    const [config, branchName] = await Promise.all([this.deps.loadConfig(this.agent), this.deps.branchName(this.agent)]);
    // The socket may have closed while that was loading.
    if (this.state === 'CLOSED' || !this.socket.isOpen()) return;

    const handle: LiveAgentConnectionHandle = {
      agentId: this.agent.id,
      tenantId: this.agent.tenant_id,
      branchId: this.agent.branch_id,
      sessionId: randomUUID(),
      agentVersion,
      capabilities: Array.isArray(p.capabilities) ? p.capabilities.filter((c: unknown) => typeof c === 'string') : [],
      connectedAt: new Date(),
      lastFrameAt: new Date(this.lastFrameAt),
      devices: new Map(),
      send: (m) => this.send(m),
      close: (code, reason) => this.close(code, reason),
    };
    this.recordDevices(handle, p.devices);

    this.state = 'OPEN';
    this.handle = handle;
    this.send(
      envelope(
        'welcome',
        {
          protocol_version: version,
          session_id: handle.sessionId,
          server_time: new Date().toISOString(),
          heartbeat_interval_s: this.heartbeatIntervalS,
          branch: { id: this.agent.branch_id, name: branchName },
          config,
          update:
            latest && (!agentVersion || compareVersions(latest.version, agentVersion) > 0)
              ? { available: true, version: latest.version }
              : { available: false },
        },
        message.id,
      ),
    );
    // Registered after welcome is on the wire: whatever the registry triggers (a replay of
    // pending commands, later) must reach an agent that has already been welcomed.
    this.deps.sessions.register(handle);
    this.startLiveness();
  }

  private async route(message: Envelope) {
    switch (message.type) {
      case 'hello':
        this.sendError('BAD_MESSAGE', 'hello was already received', message.id);
        return;
      case 'heartbeat': {
        const ack: Record<string, unknown> = { server_time: new Date().toISOString() };
        // The offline till numbers on from here if the link drops before the next beat (§13.9).
        if (this.deps.callNumbers && this.handle!.capabilities.includes('pos.offline')) {
          ack.call_numbers = await this.deps.callNumbers(this.agent).catch(() => undefined);
        }
        this.send(envelope('heartbeat.ack', ack, message.id));
        if (message.payload?.sync !== undefined) this.handle!.sync = readSyncReport(message.payload.sync);
        if (message.payload?.till !== undefined) this.handle!.till = readTillReport(message.payload.till);
        await this.deps.touch(this.agent);
        return;
      }
      case 'device.status':
        this.recordDevices(this.handle!, message.payload.devices);
        this.sendAck(message.id);
        return;
      case 'error':
        this.deps.log?.(`agent ${this.agent.id} reported ${message.payload.code}: ${message.payload.message ?? ''}`);
        return;
    }

    const handler = this.deps.handlers.get(message.type);
    if (!handler) {
      // An ack is never acked; anything else we do not know is refused so the agent stops resending it.
      if (message.type !== 'ack') this.sendAck(message.id, { code: 'UNKNOWN_TYPE', message: `unknown type ${message.type}` });
      return;
    }
    const result = await handler(message, this.handle!);
    if (result && message.type !== 'ack') this.sendAck(message.id, 'error' in result ? result.error : undefined);
  }

  private recordDevices(handle: LiveAgentConnectionHandle, devices: unknown) {
    if (!Array.isArray(devices)) return;
    for (const d of devices) {
      if (!d || typeof d !== 'object') continue;
      const kind = (d as any).kind;
      const id = (d as any).id;
      const status = String((d as any).status || '').toUpperCase();
      if ((kind !== 'printer' && kind !== 'terminal') || typeof id !== 'string') continue;
      handle.devices.set(`${kind}:${id}`, {
        kind,
        id,
        status: DEVICE_STATUSES.has(status) ? status : 'UNKNOWN',
        detail: typeof (d as any).detail === 'string' ? (d as any).detail.slice(0, 500) : null,
        checked_at: typeof (d as any).checked_at === 'string' ? (d as any).checked_at : null,
      });
    }
  }

  private startLiveness() {
    const limitMs = this.heartbeatIntervalS * 3 * 1000;
    this.livenessTimer = setInterval(() => {
      if (Date.now() - this.lastFrameAt > limitMs) {
        this.deps.log?.(`agent ${this.agent.id}: no frame for ${limitMs / 1000}s, closing`);
        this.close(AGENT_CLOSE.GOING_AWAY, 'HEARTBEAT_TIMEOUT');
      }
    }, Math.min(5000, limitMs));
    this.livenessTimer.unref?.();
  }

  private clearTimers() {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    if (this.livenessTimer) clearInterval(this.livenessTimer);
    this.handshakeTimer = null;
    this.livenessTimer = null;
  }

  private send(message: Envelope): boolean {
    if (this.state === 'CLOSED' || !this.socket.isOpen()) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  private sendAck(ref: string, error?: { code: string; message?: string }) {
    this.send(envelope('ack', error ? { ok: false, error } : { ok: true }, ref));
  }

  private sendError(code: EnvelopeErrorCode, message: string, ref: string | null) {
    this.send(envelope('error', { code, message }, ref));
  }
}

function expectsAck(type: string): boolean {
  return type !== 'ack' && type !== 'error' && type !== 'heartbeat';
}
