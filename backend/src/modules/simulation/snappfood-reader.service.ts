import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SnappfoodConnection } from '../../entities/SnappfoodConnection.entity';
import { ChannelRefusal } from '../order/channels/channel-adapter';
import { SnappfoodLiveService, isLive } from '../snappfood/snappfood-live.service';
import { SimulationService } from './simulation.service';

/** How often a branch that only reads its orders asks Snappfood for them. */
const READ_EVERY_MS = 30_000;

/**
 * How far back each read reaches. An order is accepted within minutes and may be handed back
 * to support for up to an hour after; three hours covers both with room to spare.
 */
const READ_BACK_MS = 3 * 60 * 60 * 1000;

/**
 * Reads the recent orders of every branch whose Snappfood orders another system answers, and
 * records what that system did with them. The webhook belongs to the other system, so this
 * list is the only way the orders reach Gnext. Only branches on Snappfood's staging or
 * production servers are read; a simulated one has nothing to read.
 */
@Injectable()
export class SnappfoodReaderService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SnappfoodReaderService.name);
  private timer?: NodeJS.Timeout;
  private reading = false;

  constructor(
    @InjectRepository(SnappfoodConnection) private readonly connections: Repository<SnappfoodConnection>,
    private readonly live: SnappfoodLiveService,
    private readonly simulation: SimulationService,
  ) {}

  /** Reads every read-only branch once. */
  async readAll(now: Date = new Date()): Promise<void> {
    const conns = await this.connections.find({ where: { read_only: true } });
    for (const conn of conns) {
      if (isLive(conn)) await this.readBranch(conn, now);
    }
  }

  /** One branch's orders from the last few hours. A failed read is kept for the settings page. */
  async readBranch(conn: SnappfoodConnection, now: Date = new Date()): Promise<void> {
    try {
      const orders = await this.live.latestOrders(conn, new Date(now.getTime() - READ_BACK_MS), now);
      for (const order of orders) {
        await this.simulation.mirrorSnappfoodOrder(conn.tenant_id, conn.branch_id, {
          ...order,
          code: order.code ?? order.orderCode ?? order.order_code,
          statusCode: order.statusCode ?? order.status_code,
          vendorCode: order.vendorCode ?? conn.vendor_code,
        });
      }
      await this.connections.update({ branch_id: conn.branch_id }, { last_read_at: now, last_read_error: null });
    } catch (err) {
      const message = err instanceof ChannelRefusal ? err.message : (err as Error)?.message || String(err);
      this.logger.warn(`Could not read Snappfood orders for branch ${conn.branch_id}: ${message}`);
      await this.connections.update({ branch_id: conn.branch_id }, { last_read_error: message });
    }
  }

  onApplicationBootstrap() {
    // Tests call readAll themselves, and a live timer would keep Jest from exiting.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), READ_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.reading) return;
    this.reading = true;
    try {
      await this.readAll();
    } catch (err) {
      this.logger.error(`Snappfood read failed: ${(err as Error)?.message}`);
    } finally {
      this.reading = false;
    }
  }
}
