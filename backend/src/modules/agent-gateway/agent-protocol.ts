import { randomUUID } from 'crypto';

/** Wire types from docs/agent-gateway/agent-protocol.md. */

export const PROTOCOL_VERSION = 1;
export const SUPPORTED_PROTOCOL_VERSIONS = [PROTOCOL_VERSION];
export const HEARTBEAT_INTERVAL_S = 20;
export const HANDSHAKE_TIMEOUT_MS = 10_000;
export const MAX_FRAME_BYTES = 1024 * 1024;

/** WebSocket close codes (§4.9). */
export const AGENT_CLOSE = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  SERVICE_RESTART: 1012,
  HANDSHAKE_TIMEOUT: 4000,
  KEY_INVALID: 4001,
  REVOKED: 4003,
  REPLACED: 4008,
  PROTOCOL_UNSUPPORTED: 4010,
  UPGRADE_REQUIRED: 4011,
  RATE_LIMITED: 4029,
} as const;

/** Envelope and ack error codes (§8.1). */
export type EnvelopeErrorCode =
  | 'BAD_MESSAGE'
  | 'NOT_READY'
  | 'UNKNOWN_TYPE'
  | 'INVALID_PAYLOAD'
  | 'UNSUPPORTED'
  | 'DEVICE_NOT_CONFIGURED'
  | 'EXPIRED'
  | 'INTERNAL';

export interface AgentError {
  code: string;
  message?: string;
  detail?: unknown;
}

export interface Envelope<P = Record<string, any>> {
  v: number;
  id: string;
  type: string;
  ts: string;
  ref?: string | null;
  payload: P;
}

export function envelope<P extends Record<string, any>>(type: string, payload: P, ref?: string | null, id = randomUUID()): Envelope<P> {
  return { v: PROTOCOL_VERSION, id, type, ts: new Date().toISOString(), ref: ref ?? null, payload };
}

export type ParsedFrame = { ok: true; message: Envelope } | { ok: false; error: string; ref: string | null };

/** Reads one text frame. Anything that is not a well-formed envelope is reported, never thrown. */
export function parseFrame(raw: string): ParsedFrame {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'not valid JSON', ref: null };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'not a JSON object', ref: null };
  const ref = typeof data.id === 'string' ? data.id : null;
  if (!Number.isInteger(data.v)) return { ok: false, error: 'missing field: v', ref };
  if (typeof data.id !== 'string' || !data.id) return { ok: false, error: 'missing field: id', ref };
  if (typeof data.type !== 'string' || !data.type) return { ok: false, error: 'missing field: type', ref };
  const payload = data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload) ? data.payload : {};
  return {
    ok: true,
    message: {
      v: data.v,
      id: data.id,
      type: data.type,
      ts: typeof data.ts === 'string' ? data.ts : '',
      ref: typeof data.ref === 'string' ? data.ref : null,
      payload,
    },
  };
}

/** `1.2.3` against `1.10.0`, numerically. Pre-release and build suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    String(v || '0')
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The highest version both sides speak, or null. */
export function negotiateVersion(offered: unknown, supported = SUPPORTED_PROTOCOL_VERSIONS): number | null {
  if (!Array.isArray(offered)) return null;
  const common = offered.filter((v) => Number.isInteger(v) && supported.includes(v));
  return common.length ? Math.max(...common) : null;
}
