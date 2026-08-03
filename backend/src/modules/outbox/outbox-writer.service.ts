import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
}
