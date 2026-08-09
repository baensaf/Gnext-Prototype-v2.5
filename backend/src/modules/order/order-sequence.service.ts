import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { OrderSequence } from '../../entities/OrderSequence.entity';

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
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `ORD-${dateStr}`;

    const executeRepo = entityManager
      ? entityManager.getRepository(OrderSequence)
      : this.sequenceRepo;

    let nextValue = 1;
    const maxRetries = 5;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        let seqRecord = await executeRepo.findOne({
          where: { tenant_id: tenantId, prefix },
        });

        if (!seqRecord) {
          seqRecord = executeRepo.create({
            tenant_id: tenantId,
            prefix,
            last_value: 1,
          });
          const saved = await executeRepo.save(seqRecord);
          nextValue = saved.last_value;
        } else {
          seqRecord.last_value += 1;
          const saved = await executeRepo.save(seqRecord);
          nextValue = saved.last_value;
        }
        break;
      } catch (err) {
        if (attempt === maxRetries - 1) {
          nextValue = Math.floor(Math.random() * 9000) + 1000;
        }
      }
    }

    const paddedNum = String(nextValue).padStart(4, '0');
    return `${prefix}-${paddedNum}`;
  }
}
