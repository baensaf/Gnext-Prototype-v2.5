import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { OrderSequence } from '../../entities/OrderSequence.entity';
import { nextBranchNumber } from '../../common/utils/sequence.util';

@Injectable()
export class OrderSequenceService {
  constructor(
    @InjectRepository(OrderSequence)
    private readonly sequenceRepo: Repository<OrderSequence>,
  ) {}

  async generateOrderNumber(
    tenantId: string,
    entityManager?: EntityManager,
    branchId?: string | null,
  ): Promise<string> {
    // Dated by the branch's business day. One upsert: the read-then-save this replaced let two
    // orders placed at once take the same number. The count runs across the chain, so an order
    // number names one order; the call number is the branch's own count for the day.
    return await nextBranchNumber(entityManager ?? this.sequenceRepo.manager, tenantId, branchId, 'ORD');
  }
}
