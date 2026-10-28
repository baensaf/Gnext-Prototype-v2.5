import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { SnappfoodConnection, SnappfoodMode } from '../../entities/SnappfoodConnection.entity';
import { ChannelRefusal } from '../order/channels/channel-adapter';

/** Snappfood's servers (annex 4.3.0, sections 1 and 2). */
const SERVERS: Record<Exclude<SnappfoodMode, 'SIMULATED'>, { auth: string; api: string }> = {
  STAGING: { auth: 'https://staging-auth.snappfood.dev/token', api: 'https://staging-api.snappfood.ir' },
  PRODUCTION: { auth: 'https://auth.snappfood.ir/token', api: 'https://api.snappfood.ir' },
};

const TIMEOUT_MS = 10_000;

/** A token is renewed this long before Snappfood says it runs out. */
const TOKEN_MARGIN_MS = 60_000;

export type SnappfoodDeclineReason = { id: number; title: string; level: number };

/**
 * The calls a store makes to the real Snappfood for one of its orders: ack, pick, accept,
 * reject and the list of decline reasons. A branch in SIMULATED mode, or one without a full
 * account, has no live connection and its calls go to the simulator instead. Every call is
 * written to the integration log, beside the simulator's, so the two read the same way.
 */
@Injectable()
export class SnappfoodLiveService {
  constructor(
    @InjectRepository(SnappfoodConnection) private readonly connections: Repository<SnappfoodConnection>,
    @InjectRepository(IntegrationLog) private readonly logs: Repository<IntegrationLog>,
  ) {}

  /** The branch's live account, or null while it talks to the simulator. */
  async connectionFor(tenantId: string, branchId: string | null | undefined): Promise<SnappfoodConnection | null> {
    if (!branchId) return null;
    const conn = await this.connections.findOne({ where: { tenant_id: tenantId, branch_id: branchId } });
    return conn && isLive(conn) ? conn : null;
  }

  async ack(conn: SnappfoodConnection, orderCode: string) {
    await this.call(conn, 'ORDER_ACK', 'POST', `/va/v1/order/${encodeURIComponent(orderCode)}/ack`);
  }

  async pick(conn: SnappfoodConnection, orderCode: string) {
    await this.call(conn, 'ORDER_PICK', 'POST', `/va/v1/order/${encodeURIComponent(orderCode)}/pick`);
  }

  /** body: deliveryTime for own delivery, riderPickupTime for a Snappfood rider (see acceptNotice). */
  async accept(conn: SnappfoodConnection, orderCode: string, body: Record<string, number>) {
    await this.call(conn, 'ORDER_ACCEPT', 'POST', `/va/v1/order/${encodeURIComponent(orderCode)}/accept`, body);
  }

  async reject(conn: SnappfoodConnection, orderCode: string, body: { reasonId?: number; comment?: string }) {
    await this.call(conn, 'ORDER_REJECT', 'POST', `/va/v1/order/${encodeURIComponent(orderCode)}/reject`, body);
  }

  /** Snappfood answers a list of lists; the reasons for this vendor's kind are flattened. */
  async declineReasons(conn: SnappfoodConnection): Promise<SnappfoodDeclineReason[]> {
    const data = await this.call(conn, 'DECLINE_REASONS', 'GET', '/va/v1/order/decline-reason/');
    const flat: any[] = Array.isArray(data) ? data.flat() : [];
    return flat.map((r) => ({ id: Number(r.id), title: String(r.title ?? r.name ?? ''), level: Number(r.level ?? 1) }));
  }

  /** The vendor as Snappfood sees it; the settings page uses it to check an account works. */
  async vendorStatus(conn: SnappfoodConnection): Promise<{ status?: string; vendorTitle?: string; vendorCode?: string }> {
    const data = await this.call(conn, 'VENDOR_STATUS', 'GET', '/va/v1/vendor/status');
    return data?.data ?? data ?? {};
  }

  /**
   * One authorised call. A 401 means the token went stale early, so it is renewed once and the
   * call made again. Snappfood's refusals come back as [{ status, title, detail }] and reach
   * staff as a ChannelRefusal with Snappfood's code.
   */
  private async call(conn: SnappfoodConnection, event: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    const server = SERVERS[conn.mode as keyof typeof SERVERS];
    const send = async (token: string) =>
      fetch(server.api + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

    let res: Response;
    let data: any;
    try {
      res = await send(await this.token(conn));
      if (res.status === 401) res = await send(await this.token(conn, true));
      data = await readBody(res);
    } catch (err) {
      const message = err instanceof ChannelRefusal ? err.message : `Snappfood did not answer: ${(err as Error).message}`;
      await this.log(conn, event, { method, path, body }, null, 'FAILED', message);
      if (err instanceof ChannelRefusal) throw err;
      throw new ChannelRefusal('SNAPPFOOD_UNREACHABLE', message);
    }

    if (!res.ok) {
      const first = Array.isArray(data) ? data[0] : data;
      const code = String(first?.status ?? res.status);
      const message = String(first?.detail || first?.title || first?.message || `Snappfood answered ${res.status}`);
      await this.log(conn, event, { method, path, body }, { status: res.status, body: data }, 'FAILED', message);
      throw new ChannelRefusal(code, message);
    }
    await this.log(conn, event, { method, path, body }, { status: res.status, body: data }, 'SUCCESS');
    return data;
  }

  /** The vendor's OAuth2 token (password grant, scope automation), kept until shortly before it runs out. */
  private async token(conn: SnappfoodConnection, renew = false): Promise<string> {
    if (!renew && conn.access_token && conn.token_expires_at && conn.token_expires_at.getTime() - TOKEN_MARGIN_MS > Date.now()) {
      return conn.access_token;
    }
    const server = SERVERS[conn.mode as keyof typeof SERVERS];
    const form = new URLSearchParams({
      grant_type: 'password',
      scope: 'automation',
      client_id: conn.client_id ?? '',
      client_secret: conn.client_secret ?? '',
      username: conn.username ?? '',
      password: conn.password ?? '',
    });
    const res = await fetch(server.auth, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await readBody(res);
    if (!res.ok || !data?.access_token) {
      const detail = data?.error_description || data?.error || data?.message || `status ${res.status}`;
      await this.log(conn, 'OAUTH_TOKEN', { url: server.auth, client_id: conn.client_id, username: conn.username }, { status: res.status }, 'FAILED', String(detail));
      throw new ChannelRefusal('SNAPPFOOD_AUTH_FAILED', `Snappfood refused the API account: ${detail}`);
    }
    conn.access_token = String(data.access_token);
    conn.token_expires_at = new Date(Date.now() + Number(data.expires_in || 3600) * 1000);
    await this.connections.update({ branch_id: conn.branch_id }, { access_token: conn.access_token, token_expires_at: conn.token_expires_at });
    return conn.access_token;
  }

  private async log(conn: SnappfoodConnection, event: string, request: any, response: any, status: 'SUCCESS' | 'FAILED', error?: string) {
    await this.logs.save(
      this.logs.create({
        tenant_id: conn.tenant_id,
        provider: 'SNAPPFOOD',
        event_type: `LIVE_${event}`,
        is_duplicate: false,
        status,
        request_payload: { mode: conn.mode, vendor_code: conn.vendor_code, ...request },
        response_payload: response,
        error_message: error,
      }),
    );
  }
}

/** A branch talks to the real Snappfood once it is switched to a server and has a whole account. */
export function isLive(conn: Pick<SnappfoodConnection, 'mode' | 'vendor_code' | 'client_id' | 'client_secret' | 'username' | 'password'>): boolean {
  return conn.mode !== 'SIMULATED' && !!(conn.vendor_code && conn.client_id && conn.client_secret && conn.username && conn.password);
}

async function readBody(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
