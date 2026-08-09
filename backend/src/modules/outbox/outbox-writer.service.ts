import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { OutboxEvent } from '../../entities/OutboxEvent.entity';

export interface OutboxWriteOptions {
  tenantId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, any>;
}

@Injectable()
export class OutboxWriter {
  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
  ) {}

  async enqueue(options: OutboxWriteOptions): Promise<OutboxEvent> {
    const event = this.outboxRepo.create({
      tenant_id: options.tenantId,
      event_type: options.eventType,
      aggregate_type: options.aggregateType,
      aggregate_id: options.aggregateId,
      payload: options.payload,
      state: 'PENDING',
      attempts: 0,
    });
    return await this.outboxRepo.save(event);
  }

  async enqueueInTransaction(manager: EntityManager, options: OutboxWriteOptions): Promise<OutboxEvent> {
    const event = manager.create(OutboxEvent, {
      tenant_id: options.tenantId,
      event_type: options.eventType,
      aggregate_type: options.aggregateType,
      aggregate_id: options.aggregateId,
      payload: options.payload,
      state: 'PENDING',
      attempts: 0,
    });
    return await manager.save(event);
  }

  /**
   * Claims up to `limit` pending outbox events using PostgreSQL FOR UPDATE SKIP LOCKED
   * to guarantee safe concurrent processing across multi-pod workers.
   */
  async claimEvents(manager: EntityManager, limit: number = 10): Promise<OutboxEvent[]> {
    const events = await manager
      .createQueryBuilder(OutboxEvent, 'e')
      .setLock('pessimistic_write_or_fail')
      .where('e.state = :pending', { pending: 'PENDING' })
      .andWhere('e.available_at <= :now', { now: new Date() })
      .orderBy('e.created_at', 'ASC')
      .limit(limit)
      .getMany();

    const claimed: OutboxEvent[] = [];
    for (const event of events) {
      event.state = 'PROCESSING';
      event.locked_at = new Date();
      event.attempts += 1;
      claimed.push(await manager.save(event));
    }
    return claimed;
  }

  async markSucceeded(manager: EntityManager, eventId: string): Promise<OutboxEvent | null> {
    const event = await manager.findOne(OutboxEvent, { where: { id: eventId } });
    if (!event) return null;
    event.state = 'SUCCEEDED';
    event.processed_at = new Date();
    event.error = null as any;
    return await manager.save(event);
  }

  async markFailed(manager: EntityManager, eventId: string, errorMsg: string, maxAttempts: number = 5): Promise<OutboxEvent | null> {
    const event = await manager.findOne(OutboxEvent, { where: { id: eventId } });
    if (!event) return null;
    event.error = errorMsg;
    if (event.attempts >= maxAttempts) {
      event.state = 'FAILED';
    } else {
      event.state = 'PENDING';
      const backoffSeconds = Math.pow(2, event.attempts) * 5;
      event.available_at = new Date(Date.now() + backoffSeconds * 1000);
    }
    return await manager.save(event);
  }
}
