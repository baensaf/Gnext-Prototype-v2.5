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
  heartbeatIntervalS?: number;
  handshakeTimeoutMs?: number;
  log?: (message: string) => void;
}

export interface LiveAgentConnectionHandle extends AgentConnectionHandle {
  devices: Map<string, DeviceStatusEntry>;
  lastFrameAt: Date;
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
    const min = this.deps.minAgentVersion;
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
          update: { available: false },
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
      case 'heartbeat':
        this.send(envelope('heartbeat.ack', { server_time: new Date().toISOString() }, message.id));
        await this.deps.touch(this.agent);
        return;
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
