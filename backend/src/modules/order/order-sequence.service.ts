import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { OrderSequence } from '../../entities/OrderSequence.entity';
import { BusinessDateUtil } from '../../common/utils/business-date.util';
import { nextNumber } from '../../common/utils/sequence.util';

@Injectable()
export class OrderSequenceService {
  constructor(
    @InjectRepository(OrderSequence)
    private readonly sequenceRepo: Repository<OrderSequence>,
  ) {}

  async generateOrderNumber(
    tenantId: string,
    entityManager?: EntityManager,
  ): Promise<string> {
    // The day where the till stands, as shift numbers use: in Tehran an order rung up between
    // midnight and 03:30 was numbered with the day before.
    const dateStr = BusinessDateUtil.today(new Date()).replace(/-/g, '');
    const prefix = `ORD-${dateStr}`;

    // One upsert: the read-then-save this replaced let two orders placed at once take the same
    // number, and fell back to a random one after five tries.
    return await nextNumber(entityManager ?? this.sequenceRepo.manager, tenantId, prefix);
  }
}
