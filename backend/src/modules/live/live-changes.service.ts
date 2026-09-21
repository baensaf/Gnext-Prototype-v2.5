import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { Subject } from 'rxjs';

/** One notice from the `gnext_live` trigger (migration 068): which board, whose rows. */
export interface LiveChange {
  topic: string;
  tenant_id: string | null;
  branch_id: string | null;
}

export const LIVE_CHANNEL = 'gnext_live';
/** Sent to every stream when the listener reconnects, since notices in the gap were lost. */
export const RESYNC_TOPIC = '*';
const RECONNECT_MS = 5000;

/**
 * Holds one connection that LISTENs for the boards' change notices and republishes them
 * to every open stream.
 *
 * It is a connection of its own, outside TypeORM's pool: a LISTEN only hears notices on
 * the connection that issued it, and the pool hands connections back and forth.
 */
@Injectable()
export class LiveChangesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveChangesService.name);
  readonly changes = new Subject<LiveChange>();
  private client: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private hasListened = false;
  private markListening: () => void;
  /** Settles once the first LISTEN is in place; tests wait on it before writing rows. */
  readonly listening = new Promise<void>((resolve) => (this.markListening = resolve));

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    void this.connect();
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => undefined);
    this.changes.complete();
  }

  private async connect() {
    if (this.stopped) return;
    const client = new Client({
      host: this.config.get<string>('DB_HOST', 'localhost'),
      port: Number(this.config.get<number>('DB_PORT', 5432)),
      user: this.config.get<string>('DB_USERNAME') || this.config.get<string>('DB_USER') || 'admin',
      password: this.config.get<string>('DB_PASSWORD', 'admin'),
      database: this.config.get<string>('DB_NAME', 'appdb'),
    });
    client.on('notification', (msg) => {
      if (msg.channel !== LIVE_CHANNEL || !msg.payload) return;
      try {
        this.changes.next(JSON.parse(msg.payload));
      } catch {
        // A payload the trigger did not write; nothing to pass on.
      }
    });
    client.on('error', (err) => {
      this.logger.warn(`Live change connection failed: ${err.message}`);
      this.retry(client);
    });
    client.on('end', () => this.retry(client));

    try {
      await client.connect();
      await client.query(`LISTEN ${LIVE_CHANNEL}`);
      // The app may have shut down while this was connecting.
      if (this.stopped) {
        client.removeAllListeners();
        await client.end().catch(() => undefined);
        return;
      }
      this.client = client;
      // Anything written while the connection was down went unheard: have every page re-read.
      if (this.hasListened) this.changes.next({ topic: RESYNC_TOPIC, tenant_id: null, branch_id: null });
      this.hasListened = true;
      this.markListening();
    } catch (err: any) {
      this.logger.warn(`Could not listen for live changes: ${err.message}`);
      this.retry(client);
    }
  }

  private retry(failed: Client) {
    if (this.stopped || this.reconnectTimer) return;
    if (this.client === failed) this.client = null;
    failed.removeAllListeners();
    failed.on('error', () => undefined);
    void failed.end().catch(() => undefined);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, RECONNECT_MS);
  }
}
