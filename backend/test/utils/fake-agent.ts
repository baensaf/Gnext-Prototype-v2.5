import * as request from 'supertest';
import { TestAgent } from './agent-client';

export type PrintOutcome = { status: 'SUCCESS' } | { status: 'FAILED'; error: { code: string; message?: string } };
export type ChargeOutcome =
  | { status: 'APPROVED'; rrn?: string }
  | { status: 'DECLINED' | 'CANCELLED' | 'FAILED' | 'UNKNOWN'; error?: { code: string; message?: string } };

export interface FakeAgentOptions {
  version?: string;
  capabilities?: string[];
  /** How the fake printer answers each job. Defaults to success. */
  print?: (job: Record<string, any>) => PrintOutcome;
  /** How the fake terminal answers each charge. Defaults to approval. */
  charge?: (charge: Record<string, any>) => ChargeOutcome;
}

/**
 * A branch agent that follows the protocol the way the Go agent must
 * (docs/agent-gateway/agent-protocol.md): enrols over HTTPS, connects, says hello, sends
 * heartbeats, journals and acks every command once, runs it on fake hardware, and reports the
 * result. Use it to drive the cloud end to end in Jest.
 */
export class FakeAgent {
  deviceKey = '';
  agentId = '';
  wsUrl = '';
  connection: TestAgent | null = null;
  /** Commands in the order they were first received, as the agent's journal would hold them. */
  readonly journal = new Map<string, { command: any; resultId?: string }>();
  readonly updateChecks: string[] = [];
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly http: any,
    private readonly baseWs: string,
    private readonly options: FakeAgentOptions = {},
  ) {}

  get version() {
    return this.options.version ?? '1.0.0';
  }

  /** `POST /api/v1/agent/enrol` with a code as the installer would type it. */
  async enrol(code: string) {
    const res = await request(this.http)
      .post('/api/v1/agent/enrol')
      .send({
        code: code.toLowerCase(),
        agent_version: this.version,
        protocol_version: 1,
        machine: { hostname: 'FAKE-BRANCH-PC', os: 'Windows 11 Pro', machine_id: 'fake-machine' },
      });
    if (res.status !== 200) throw new Error(`enrol failed: ${res.status} ${JSON.stringify(res.body)}`);
    this.deviceKey = res.body.device_key;
    this.agentId = res.body.agent_id;
    this.wsUrl = res.body.ws_url;
    return res.body;
  }

  /** Opens the socket, says hello, and starts answering. Resolves with `welcome`. */
  async connect() {
    // The server told us where to connect; in tests its host is not the listening port.
    const path = new URL(this.wsUrl).pathname;
    const conn = new TestAgent(`${this.baseWs}${path}`, this.deviceKey);
    this.connection = conn;
    await conn.opened;
    conn.ws.on('message', (data) => void this.onMessage(JSON.parse(data.toString())));
    const hello = conn.send('hello', {
      agent_version: this.version,
      protocol_versions: [1],
      capabilities: this.options.capabilities ?? ['print.html', 'payment.charge', 'payment.query'],
      started_at: new Date().toISOString(),
      devices: [],
      unacked_results: 0,
    });
    const welcome = await conn.next((m) => m.type === 'welcome' && m.ref === hello);
    this.heartbeat = setInterval(() => conn.send('heartbeat', { in_flight: 0, unacked_results: 0 }), 1000);
    this.heartbeat.unref?.();
    return welcome;
  }

  async disconnect() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (!this.connection) return;
    this.connection.ws.terminate();
    await this.connection.closed;
    this.connection = null;
  }

  /** `GET /api/v1/agent/releases/latest`, as the hourly update check does. */
  async checkForUpdate() {
    const res = await request(this.http).get('/api/v1/agent/releases/latest').set('Authorization', `Bearer ${this.deviceKey}`);
    return res.status === 204 ? null : res.body;
  }

  private async onMessage(m: any) {
    const conn = this.connection;
    if (!conn || !m?.type) return;
    const isCommand = ['print.job', 'payment.charge', 'payment.query', 'config.updated', 'agent.check_update'].includes(m.type);
    if (!isCommand) return;

    // Journal first, then ack; a command seen before is acked again and its result resent.
    const seen = this.journal.get(m.id);
    if (seen) {
      conn.send('ack', { ok: true }, undefined, m.id);
      return;
    }
    if (Date.parse(m.payload?.expires_at) < Date.now()) {
      conn.send('ack', { ok: false, error: { code: 'EXPIRED', message: 'arrived after expires_at' } }, undefined, m.id);
      return;
    }
    const entry: { command: any; resultId?: string } = { command: m };
    this.journal.set(m.id, entry);
    conn.send('ack', { ok: true }, undefined, m.id);

    const now = () => new Date().toISOString();
    switch (m.type) {
      case 'print.job': {
        const outcome = this.options.print?.(m.payload) ?? { status: 'SUCCESS' };
        entry.resultId = conn.send(
          'print.result',
          {
            job_id: m.payload.job_id,
            attempt_no: m.payload.attempt_no,
            printer_id: m.payload.printer_id,
            status: outcome.status,
            copies_printed: outcome.status === 'SUCCESS' ? m.payload.copies : 0,
            started_at: now(),
            finished_at: now(),
            error: outcome.status === 'FAILED' ? outcome.error : null,
          },
          undefined,
          m.id,
        );
        return;
      }
      case 'payment.charge':
      case 'payment.query': {
        const outcome = this.options.charge?.(m.payload) ?? { status: 'APPROVED' };
        const approved = outcome.status === 'APPROVED';
        entry.resultId = conn.send(
          'payment.result',
          {
            payment_id: m.payload.payment_id,
            attempt_id: m.payload.attempt_id,
            terminal_id: m.payload.terminal_id,
            status: outcome.status,
            amount: approved ? m.payload.amount : undefined,
            rrn: approved ? (outcome as any).rrn ?? `RRN${Date.now()}` : undefined,
            stan: approved ? '000001' : undefined,
            card_pan_masked: approved ? '603799******0000' : undefined,
            started_at: now(),
            finished_at: now(),
            error: approved ? null : (outcome as any).error ?? null,
          },
          undefined,
          m.id,
        );
        return;
      }
      case 'agent.check_update':
        this.updateChecks.push(m.id);
        return;
      default:
        return;
    }
  }
}
