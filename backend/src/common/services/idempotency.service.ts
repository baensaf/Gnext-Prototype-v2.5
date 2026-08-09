import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { IdempotencyRecord } from '../../entities/IdempotencyRecord.entity';
import { createHash } from 'crypto';

export interface IdempotencyReservationResult {
  isReplay: boolean;
  recordId?: string;
  responseStatus?: number;
  responseBody?: any;
}

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyRecord)
    private readonly idempotencyRepo: Repository<IdempotencyRecord>,
  ) {}

  computeHash(scope: string, path: string, body: any): string {
    const raw = `${scope}:${path}:${JSON.stringify(body || {})}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  async reserveOrReplay(
    tenantId: string,
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<IdempotencyReservationResult> {
    if (!key) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        title: 'Idempotency Key Required',
        detail: 'An Idempotency-Key header is required for this operation.',
      });
    }

    const existing = await this.idempotencyRepo.findOne({
      where: {
        tenant_id: tenantId,
        scope,
        key,
        expires_at: MoreThan(new Date()),
      },
    });

    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_CONFLICT',
          title: 'Idempotency Key Conflict',
          detail: 'Idempotency key has already been used with a different request payload.',
        });
      }

      if (existing.status === 'SUCCEEDED') {
        return {
          isReplay: true,
          responseStatus: existing.response_status,
          responseBody: existing.response_body,
        };
      }

      if (existing.status === 'PENDING') {
        throw new ConflictException({
          code: 'IDEMPOTENCY_IN_PROGRESS',
          title: 'Operation In Progress',
          detail: 'A request with this Idempotency-Key is currently being processed.',
        });
      }
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24-hour expiry

    const record = this.idempotencyRepo.create({
      tenant_id: tenantId,
      scope,
      key,
      request_hash: requestHash,
      status: 'PENDING',
      expires_at: expiresAt,
    });

    const saved = await this.idempotencyRepo.save(record);
    return {
      isReplay: false,
      recordId: saved.id,
    };
  }

  async saveResult(recordId: string, responseStatus: number, responseBody: any): Promise<void> {
    if (!recordId) return;
    const record = await this.idempotencyRepo.findOne({ where: { id: recordId } });
    if (record) {
      record.status = 'SUCCEEDED';
      record.response_status = responseStatus;
      record.response_body = responseBody;
      await this.idempotencyRepo.save(record);
    }
  }
}
