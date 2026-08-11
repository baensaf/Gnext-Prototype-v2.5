import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { AuditEvent } from '../../entities/AuditEvent.entity';

export interface AuditWriteOptions {
  tenantId: string;
  actorType: 'ADMIN' | 'APPROVER_PROFILE' | 'SYSTEM' | 'SIMULATOR' | 'WEBHOOK';
  actorId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  branchId?: string;
  correlationId?: string;
  ip?: string;
  beforeData?: Record<string, any>;
  afterData?: Record<string, any>;
  details?: Record<string, any>;
}

import { randomUUID } from 'crypto';

function sanitizeUuid(val?: string): string | null {
  if (!val) return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  return isUuid ? val : null;
}

function sanitizeUuidOrDefault(val?: string): string {
  const sanitized = sanitizeUuid(val);
  return sanitized || randomUUID();
}

@Injectable()
export class AuditWriter {
  constructor(
    @InjectRepository(AuditEvent)
    private readonly auditRepo: Repository<AuditEvent>,
  ) {}

  async write(options: AuditWriteOptions): Promise<AuditEvent> {
    const event = this.auditRepo.create({
      tenant_id: options.tenantId,
      event_type: options.action,
      actor_type: options.actorType,
      actor_id: sanitizeUuid(options.actorId),
      action: options.action,
      entity_type: options.entityType || null,
      entity_id: sanitizeUuid(options.entityId),
      branch_id: sanitizeUuid(options.branchId),
      correlation_id: sanitizeUuidOrDefault(options.correlationId),
      ip: options.ip || null,
      before_data: options.beforeData || null,
      after_data: options.afterData || null,
      details: options.details || null,
    });
    return await this.auditRepo.save(event);
  }

  async writeInTransaction(manager: EntityManager, options: AuditWriteOptions): Promise<AuditEvent> {
    const event = manager.create(AuditEvent, {
      tenant_id: options.tenantId,
      event_type: options.action,
      actor_type: options.actorType,
      actor_id: sanitizeUuid(options.actorId),
      action: options.action,
      entity_type: options.entityType || null,
      entity_id: sanitizeUuid(options.entityId),
      branch_id: sanitizeUuid(options.branchId),
      correlation_id: sanitizeUuidOrDefault(options.correlationId),
      ip: options.ip || null,
      before_data: options.beforeData || null,
      after_data: options.afterData || null,
      details: options.details || null,
    });
    return await manager.save(event);
  }
}
