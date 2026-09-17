import { randomUUID } from 'crypto';
import { WebSocket } from 'ws';

/** A minimal agent client: collects frames, and can wait for one or for the close. */
export class TestAgent {
  readonly frames: any[] = [];
  readonly ws: WebSocket;
  readonly opened: Promise<void>;
  readonly closed: Promise<{ code: number; reason: string }>;
  private waiters: Array<{ match: (m: any) => boolean; resolve: (m: any) => void }> = [];

  constructor(url: string, key?: string) {
    this.ws = new WebSocket(url, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
    this.ws.on('message', (data) => {
      const m = JSON.parse(data.toString());
      this.frames.push(m);
      this.waiters = this.waiters.filter((w) => (w.match(m) ? (w.resolve(m), false) : true));
    });
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      this.ws.once('error', reject);
    });
    this.closed = new Promise((resolve) => this.ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  }

  send(type: string, payload: Record<string, any> = {}, id: string = randomUUID(), ref?: string) {
    this.ws.send(JSON.stringify({ v: 1, id, type, ts: new Date().toISOString(), ref: ref ?? null, payload }));
    return id;
  }

  next(match: (m: any) => boolean, timeoutMs = 5000): Promise<any> {
    const seen = this.frames.find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a frame')), timeoutMs);
      this.waiters.push({ match, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  }

  async handshake() {
    await this.opened;
    const id = this.send('hello', { agent_version: '1.0.0', protocol_versions: [1], capabilities: ['print.html'], devices: [] });
    return this.next((m) => m.type === 'welcome' && m.ref === id);
  }
}

/** What the upgrade was refused with, as the agent would see it. */
export function upgradeStatus(url: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode || 0);
      ws.terminate();
    });
    ws.once('open', () => {
      ws.close();
      reject(new Error('upgrade was accepted'));
    });
    ws.once('error', () => undefined);
  });
}
