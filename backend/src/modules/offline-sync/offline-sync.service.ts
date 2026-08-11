import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThanOrEqual, IsNull, Or } from 'typeorm';
import { OfflineQueueItem } from '../../entities/OfflineQueueItem.entity';
import { SyncConflictRecord } from '../../entities/SyncConflictRecord.entity';
import { BranchStatusSnapshot } from '../../entities/BranchStatusSnapshot.entity';
import { SyncCategoryLog } from '../../entities/SyncCategoryLog.entity';
import { AuditWriter } from '../audit/audit-writer.service';

const ALLOWED_ENTITY_TYPES = new Set([
  'ORDER',
  'PAYMENT',
  'REFUND',
  'CASH_SHIFT',
  'CUSTOMER',
  'CATALOG',
  'PRICE_UPDATE',
  'SETTING',
  'COURIER',
]);

const FINANCIAL_ENTITY_TYPES = new Set(['ORDER', 'PAYMENT', 'REFUND', 'CASH_SHIFT']);

const DISALLOWED_FINANCIAL_KEYS = [
  'total',
  'amount',
  'price',
  'unit_price',
  'balance',
  'opening_balance',
  'line_total',
  'tax_amount',
  'discount_amount',
  'grand_total',
  'paid_total',
];

@Injectable()
export class OfflineSyncService {
  constructor(
    @InjectRepository(OfflineQueueItem) private readonly queueRepo: Repository<OfflineQueueItem>,
    @InjectRepository(SyncConflictRecord) private readonly conflictRepo: Repository<SyncConflictRecord>,
    @InjectRepository(BranchStatusSnapshot) private readonly branchStatusRepo: Repository<BranchStatusSnapshot>,
    @InjectRepository(SyncCategoryLog) private readonly categoryLogRepo: Repository<SyncCategoryLog>,
    private readonly auditWriter: AuditWriter,
  ) {}

  private validateDomainPayload(entityType: string, payload: any) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException('Invalid payload for domain operation: payload must be an object');
    }

    const typeUpper = (entityType || '').toUpperCase().trim();

    if (!ALLOWED_ENTITY_TYPES.has(typeUpper)) {
      throw new BadRequestException(
        `Invalid entity_type: '${entityType}'. Must be a closed domain-specific offline operation.`,
      );
    }

    if (payload.arbitrary_financial_json === true || payload.is_corrupt === true) {
      throw new BadRequestException('Invalid payload for domain operation: arbitrary or corrupt financial JSON rejected');
    }

    if (FINANCIAL_ENTITY_TYPES.has(typeUpper)) {
      for (const key of DISALLOWED_FINANCIAL_KEYS) {
        if (payload[key] !== undefined) {
          throw new BadRequestException(
            `Financial operations (${typeUpper}) must be references to valid domain commands/records and must not accept client-authoritative amounts, prices, totals, or balances (field '${key}' rejected).`,
          );
        }
      }

      if (Array.isArray(payload.items)) {
        for (const item of payload.items) {
          if (item && typeof item === 'object') {
            for (const key of DISALLOWED_FINANCIAL_KEYS) {
              if (item[key] !== undefined) {
                throw new BadRequestException(
                  `Financial operations (${typeUpper}) line items must not accept client-authoritative amounts or prices (field '${key}' rejected).`,
                );
              }
            }
          }
        }
      }
    }
  }

  private resolveBranchId(branchId?: string): string {
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (branchId && uuidRegex.test(branchId)) {
      return branchId;
    }
    throw new BadRequestException('Valid branch context (UUID) is required for offline sync operations');
  }

  private async getLatestBranchSnapshot(tenantId: string, branchId?: string): Promise<BranchStatusSnapshot> {
    const targetBranchId = this.resolveBranchId(branchId);
    let snapshot = await this.branchStatusRepo.findOne({
      where: { tenant_id: tenantId, branch_id: targetBranchId },
      order: { recorded_at: 'DESC' },
    });

    if (!snapshot) {
      snapshot = this.branchStatusRepo.create({
        tenant_id: tenantId,
        branch_id: targetBranchId,
        is_online: true,
        agent_version: 'v1.5.0-sim',
        agent_health: 'HEALTHY',
        last_heartbeat_at: new Date(),
        last_sync_at: null,
        offline_since: null,
        details: { initialized: true },
      });
      snapshot = await this.branchStatusRepo.save(snapshot);
    }

    return snapshot;
  }

  async getStatus(tenantId: string, branchId?: string) {
    const targetBranchId = this.resolveBranchId(branchId);
    const snapshot = await this.getLatestBranchSnapshot(tenantId, targetBranchId);

    const pendingCount = await this.queueRepo.count({
      where: { tenant_id: tenantId, branch_id: targetBranchId, status: 'PENDING' },
    });

    const conflictCount = await this.queueRepo.count({
      where: { tenant_id: tenantId, branch_id: targetBranchId, status: 'CONFLICT' },
    });

    const dlqCount = await this.queueRepo.count({
      where: { tenant_id: tenantId, branch_id: targetBranchId, status: 'DLQ_FAILED' },
    });

    const syncingCount = await this.queueRepo.count({
      where: { tenant_id: tenantId, branch_id: targetBranchId, status: 'SYNCING' },
    });

    return {
      tenant_id: tenantId,
      branch_id: targetBranchId,
      is_online: snapshot.is_online,
      agent_version: snapshot.agent_version || 'v1.5.0-sim',
      agent_health: snapshot.agent_health || 'HEALTHY',
      last_heartbeat_at: snapshot.last_heartbeat_at,
      last_synced_at: snapshot.last_sync_at,
      offline_since: snapshot.offline_since,
      details: snapshot.details,
      pending_queue_count: pendingCount,
      syncing_queue_count: syncingCount,
      conflict_count: conflictCount,
      dlq_count: dlqCount,
    };
  }

  async toggleConnectivity(
    tenantId: string,
    branchId?: string,
    isOnline: boolean = true,
    agentVersion?: string,
    agentHealth?: string,
  ) {
    const targetBranchId = this.resolveBranchId(branchId);
    const latest = await this.getLatestBranchSnapshot(tenantId, targetBranchId);

    let offlineSince: Date | null = latest.offline_since;
    if (latest.is_online && !isOnline) {
      offlineSince = new Date();
    } else if (isOnline) {
      offlineSince = null;
    }

    const newSnapshot = this.branchStatusRepo.create({
      tenant_id: tenantId,
      branch_id: targetBranchId,
      is_online: isOnline,
      agent_version: agentVersion || latest.agent_version || 'v1.5.0-sim',
      agent_health: agentHealth || latest.agent_health || 'HEALTHY',
      last_heartbeat_at: new Date(),
      last_sync_at: latest.last_sync_at,
      offline_since: offlineSince,
      details: {
        previous_online: latest.is_online,
        toggled_at: new Date().toISOString(),
      },
    });

    await this.branchStatusRepo.save(newSnapshot);

    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: isOnline ? 'BRANCH_CONNECTIVITY_ONLINE' : 'BRANCH_CONNECTIVITY_OFFLINE',
      correlationId: 'corr-offline-toggle',
      afterData: {
        branch_id: targetBranchId,
        is_online: isOnline,
        offline_since: offlineSince,
        agent_version: newSnapshot.agent_version,
      },
    });

    return this.getStatus(tenantId, targetBranchId);
  }

  async enqueueOfflineItem(
    tenantId: string,
    data: {
      branch_id: string;
      terminal_id?: string;
      entity_type: string;
      payload: any;
      client_version?: number;
      dedupe_key?: string;
    },
    correlationId?: string,
  ) {
    const targetBranchId = this.resolveBranchId(data?.branch_id);
    const entityType = (data.entity_type || 'ORDER').toUpperCase().trim();
    this.validateDomainPayload(entityType, data.payload);

    if (data.dedupe_key) {
      const existing = await this.queueRepo.findOne({
        where: {
          tenant_id: tenantId,
          branch_id: targetBranchId,
          dedupe_key: data.dedupe_key,
          status: In(['PENDING', 'SYNCING', 'CONFLICT']),
        },
      });

      if (existing) {
        return {
          ...existing,
          is_duplicate: true,
        };
      }
    }

    const snapshot = await this.getLatestBranchSnapshot(tenantId, targetBranchId);
    const initialStatus = snapshot.is_online ? 'SYNCED' : 'PENDING';

    const item = this.queueRepo.create({
      tenant_id: tenantId,
      branch_id: targetBranchId,
      terminal_id: data.terminal_id || null,
      entity_type: entityType,
      payload: data.payload,
      status: initialStatus,
      client_version: data.client_version || 1,
      dedupe_key: data.dedupe_key || null,
      synced_at: snapshot.is_online ? new Date() : null,
      attempt_count: 0,
      retry_count: 0,
    });

    try {
      const saved = await this.queueRepo.save(item);

      await this.auditWriter.write({
        tenantId,
        actorType: 'SYSTEM',
        action: 'OFFLINE_ITEM_ENQUEUED',
        correlationId: correlationId || 'corr-queue-enqueue',
        afterData: {
          item_id: saved.id,
          status: saved.status,
          entity_type: saved.entity_type,
          dedupe_key: saved.dedupe_key,
        },
      });

      return saved;
    } catch (err: any) {
      // Handle PostgreSQL duplicate-key race condition on active dedupe index (code 23505)
      if (err?.code === '23505' && data.dedupe_key) {
        const existing = await this.queueRepo.findOne({
          where: {
            tenant_id: tenantId,
            branch_id: targetBranchId,
            dedupe_key: data.dedupe_key,
            status: In(['PENDING', 'SYNCING', 'CONFLICT']),
          },
        });
        if (existing) {
          return {
            ...existing,
            is_duplicate: true,
          };
        }
      }
      throw err;
    }
  }

  async triggerSyncWorker(tenantId: string, branchId?: string, correlationId?: string) {
    const targetBranchId = this.resolveBranchId(branchId);
    const workerId = `worker-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date();

    // Claim pending rows transactionally with FOR UPDATE SKIP LOCKED
    // also recovering expired claims safely (claim_expires_at < NOW)
    let claimedItems: OfflineQueueItem[] = [];

    const queryRunner = this.queueRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const isPostgres = queryRunner.connection?.driver?.options?.type === 'postgres';
      if (isPostgres) {
        const rows = await queryRunner.query(
          `SELECT id FROM "offline_queue_item"
           WHERE "tenant_id" = $1 AND "branch_id" = $2
             AND "status" IN ('PENDING', 'SYNCING')
             AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= $3)
             AND ("claim_expires_at" IS NULL OR "claim_expires_at" < $3 OR "status" = 'PENDING')
           ORDER BY "created_at" ASC
           LIMIT 50
           FOR UPDATE SKIP LOCKED`,
          [tenantId, targetBranchId, now],
        );

        const ids = rows.map((r: any) => r.id);
        if (ids.length > 0) {
          const claimExpiresAt = new Date(now.getTime() + 30000); // 30 second claim window
          await queryRunner.query(
            `UPDATE "offline_queue_item"
             SET "status" = 'SYNCING',
                 "claimed_by" = $1,
                 "claimed_at" = $2,
                 "claim_expires_at" = $3
             WHERE id = ANY($4)`,
            [workerId, now, claimExpiresAt, ids],
          );

          claimedItems = await queryRunner.manager.find(OfflineQueueItem, {
            where: { id: In(ids) },
            order: { created_at: 'ASC' },
          });
        }
      } else {
        // Fallback for non-PostgreSQL / unit tests
        claimedItems = await this.queueRepo.find({
          where: {
            tenant_id: tenantId,
            branch_id: targetBranchId,
            status: In(['PENDING', 'SYNCING']),
          },
          order: { created_at: 'ASC' },
        });

        for (const item of claimedItems) {
          item.status = 'SYNCING';
          item.claimed_by = workerId;
          item.claimed_at = now;
          item.claim_expires_at = new Date(now.getTime() + 30000);
          await this.queueRepo.save(item);
        }
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    let syncedCount = 0;
    let conflictCount = 0;
    let dlqCount = 0;

    const categoryCounts: Record<string, { processed: number; synced: number; conflict: number; dlq: number }> = {};

    const batchId = randomUUID();

    for (const item of claimedItems) {
      const typeUpper = (item.entity_type || 'ORDER').toUpperCase().trim();
      let catKey = typeUpper;
      if (typeUpper.includes('PRICE')) catKey = 'PRICE';
      else if (typeUpper.includes('MENU') || typeUpper.includes('CATALOG')) catKey = 'CATALOG';
      else if (typeUpper.includes('CONFIG') || typeUpper.includes('SETTING')) catKey = 'SETTING';

      if (!categoryCounts[catKey]) {
        categoryCounts[catKey] = { processed: 0, synced: 0, conflict: 0, dlq: 0 };
      }
      categoryCounts[catKey].processed += 1;

      item.attempt_count = (item.attempt_count || item.retry_count || 0) + 1;
      item.retry_count = item.attempt_count;

      const isConflict =
        item.payload?.simulate_conflict ||
        (item.payload?.cloud_version && (item.client_version || 1) < item.payload.cloud_version);

      if (item.payload?.simulate_dlq || item.payload?.simulate_failure || item.attempt_count > 3) {
        item.status = 'DLQ_FAILED';
        item.failure_reason = item.payload?.simulate_failure
          ? `Simulated worker failure: ${item.payload.simulate_failure}`
          : 'Attempt count exceeded maximum limit (DLQ)';
        item.conflict_reason = item.failure_reason;
        item.claimed_by = null;
        item.claimed_at = null;
        item.claim_expires_at = null;
        await this.queueRepo.save(item);

        dlqCount += 1;
        categoryCounts[catKey].dlq += 1;
      } else if (isConflict) {
        const conflictType = item.payload?.simulate_conflict || 'VERSION_MISMATCH';
        item.status = 'CONFLICT';
        item.conflict_reason = `Sync conflict detected: ${conflictType}`;
        item.claimed_by = null;
        item.claimed_at = null;
        item.claim_expires_at = null;
        const savedItem = await this.queueRepo.save(item);

        const cloudVersion = item.payload?.cloud_version || (item.client_version || 1) + 1;
        const serverState = item.payload?.cloud_original || {
          server_price: '25.00',
          available_stock: 0,
          server_version: cloudVersion,
          server_timestamp: new Date().toISOString(),
        };

        const conflictRecord = this.conflictRepo.create({
          tenant_id: tenantId,
          queue_item_id: savedItem.id,
          conflict_type: conflictType,
          client_state: item.payload,
          server_state: serverState,
          local_original: item.payload,
          cloud_original: serverState,
          local_version: item.client_version || 1,
          cloud_version: cloudVersion,
          resolution_strategy: 'UNRESOLVED',
          resolution_result: null,
        });
        await this.conflictRepo.save(conflictRecord);

        conflictCount += 1;
        categoryCounts[catKey].conflict += 1;
      } else if (item.payload?.simulate_retry_error) {
        // Schedule retry with backoff
        item.status = 'PENDING';
        item.next_attempt_at = new Date(Date.now() + 5000 * item.attempt_count);
        item.failure_reason = 'Simulated transient network error; retry scheduled';
        item.claimed_by = null;
        item.claimed_at = null;
        item.claim_expires_at = null;
        await this.queueRepo.save(item);
      } else {
        item.status = 'SYNCED';
        item.synced_at = new Date();
        item.claimed_by = null;
        item.claimed_at = null;
        item.claim_expires_at = null;
        item.failure_reason = null;
        await this.queueRepo.save(item);

        syncedCount += 1;
        categoryCounts[catKey].synced += 1;
      }
    }

    // Persist incremental category logs/metrics in sync_category_log table
    for (const [catName, counts] of Object.entries(categoryCounts)) {
      const catLog = this.categoryLogRepo.create({
        tenant_id: tenantId,
        branch_id: targetBranchId,
        batch_id: batchId,
        category: catName,
        processed_count: counts.processed,
        synced_count: counts.synced,
        conflict_count: counts.conflict,
        dlq_count: counts.dlq,
      });
      await this.categoryLogRepo.save(catLog);
    }

    const latestSnapshot = await this.getLatestBranchSnapshot(tenantId, targetBranchId);
    let updatedLastSyncAt = latestSnapshot.last_sync_at;

    // Advance last_sync_at ONLY if every selected item in the batch succeeded without conflict or DLQ
    const allSucceeded = claimedItems.length > 0 && syncedCount === claimedItems.length && conflictCount === 0 && dlqCount === 0;

    if (allSucceeded) {
      updatedLastSyncAt = new Date();
      const syncSnapshot = this.branchStatusRepo.create({
        tenant_id: tenantId,
        branch_id: targetBranchId,
        is_online: true,
        agent_version: latestSnapshot.agent_version,
        agent_health: latestSnapshot.agent_health,
        last_heartbeat_at: new Date(),
        last_sync_at: updatedLastSyncAt,
        offline_since: null,
        details: {
          last_batch_synced_count: syncedCount,
          last_batch_id: batchId,
          last_batch_categories: categoryCounts,
        },
      });
      await this.branchStatusRepo.save(syncSnapshot);
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: 'OFFLINE_SYNC_WORKER_EXECUTED',
      correlationId: correlationId || 'corr-sync-worker',
      afterData: {
        batch_id: batchId,
        processed_count: claimedItems.length,
        synced_count: syncedCount,
        conflict_count: conflictCount,
        dlq_count: dlqCount,
        category_counts: categoryCounts,
        advanced_last_sync: allSucceeded,
      },
    });

    return {
      success: true,
      batch_id: batchId,
      processed_count: claimedItems.length,
      synced_count: syncedCount,
      conflict_count: conflictCount,
      dlq_count: dlqCount,
      category_counts: categoryCounts,
      advanced_last_sync: allSucceeded,
      last_synced_at: updatedLastSyncAt,
    };
  }

  async cloneDlqItem(tenantId: string, queueItemId: string, correlationId?: string) {
    const item = await this.queueRepo.findOne({ where: { id: queueItemId, tenant_id: tenantId } });
    if (!item) throw new NotFoundException(`Queue item ${queueItemId} not found`);

    if (item.status !== 'DLQ_FAILED') {
      throw new BadRequestException('Only items in DLQ_FAILED state can be cloned for retry');
    }

    const cleanPayload = { ...item.payload };
    delete cleanPayload.simulate_dlq;
    delete cleanPayload.simulate_failure;

    const cloned = this.queueRepo.create({
      tenant_id: tenantId,
      branch_id: item.branch_id,
      terminal_id: item.terminal_id,
      entity_type: item.entity_type,
      payload: cleanPayload,
      status: 'PENDING',
      attempt_count: 0,
      retry_count: 0,
      next_attempt_at: null,
      claimed_by: null,
      claimed_at: null,
      claim_expires_at: null,
      failure_reason: null,
      conflict_reason: null,
      client_version: item.client_version,
      dedupe_key: item.dedupe_key ? `${item.dedupe_key}-retry-${Date.now()}` : null,
      synced_at: null,
    });

    const saved = await this.queueRepo.save(cloned);

    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: 'OFFLINE_ITEM_RETRY_CLONED',
      correlationId: correlationId || 'corr-retry-clone',
      afterData: {
        original_item_id: item.id,
        cloned_item_id: saved.id,
      },
    });

    return saved;
  }

  async getQueue(tenantId: string, branchId?: string, status?: string) {
    const targetBranchId = this.resolveBranchId(branchId);
    const where: any = { tenant_id: tenantId, branch_id: targetBranchId };
    if (status) where.status = status;

    return await this.queueRepo.find({ where, order: { created_at: 'DESC' }, take: 100 });
  }

  async getConflicts(tenantId: string) {
    return await this.conflictRepo.find({ where: { tenant_id: tenantId }, order: { created_at: 'DESC' } });
  }

  async resolveConflict(
    tenantId: string,
    data: {
      conflict_id: string;
      resolution_strategy: 'ACCEPT_CLIENT' | 'ACCEPT_SERVER' | 'MANUAL_OVERRIDE' | 'LOCAL' | 'CLOUD' | 'MERGED';
      override_payload?: any;
    },
    userId?: string,
    correlationId?: string,
  ) {
    const conflict = await this.conflictRepo.findOne({ where: { id: data.conflict_id, tenant_id: tenantId } });
    if (!conflict) throw new NotFoundException('Conflict record not found');

    const queueItem = await this.queueRepo.findOne({ where: { id: conflict.queue_item_id } });
    if (!queueItem) throw new NotFoundException('Associated queue item not found');

    const strategyUpper = (data.resolution_strategy || 'LOCAL').toUpperCase().trim();
    const entityTypeUpper = (queueItem.entity_type || 'ORDER').toUpperCase().trim();

    // REJECT MERGED FINANCIAL RESOLUTION
    if ((strategyUpper === 'MANUAL_OVERRIDE' || strategyUpper === 'MERGED') && FINANCIAL_ENTITY_TYPES.has(entityTypeUpper)) {
      throw new BadRequestException(
        `Merged resolution for financial operations (${entityTypeUpper}) is rejected and must be routed only through domain correction commands.`,
      );
    }

    let resolvedPayload: any;

    if (strategyUpper === 'MANUAL_OVERRIDE' || strategyUpper === 'MERGED') {
      const override = data.override_payload || conflict.local_original || conflict.client_state;
      this.validateDomainPayload(queueItem.entity_type, override);
      resolvedPayload = override;
    } else if (strategyUpper === 'ACCEPT_SERVER' || strategyUpper === 'CLOUD') {
      resolvedPayload = conflict.cloud_original || conflict.server_state;
    } else if (strategyUpper === 'ACCEPT_CLIENT' || strategyUpper === 'LOCAL') {
      resolvedPayload = conflict.local_original || conflict.client_state;
    } else {
      throw new BadRequestException(`Unsupported resolution strategy: ${data.resolution_strategy}`);
    }

    conflict.resolution_strategy = data.resolution_strategy;
    conflict.resolution_result = resolvedPayload;
    conflict.resolved_at = new Date();
    conflict.resolved_by = userId || null;
    await this.conflictRepo.save(conflict);

    queueItem.payload = resolvedPayload;
    queueItem.status = 'SYNCED';
    queueItem.synced_at = new Date();
    queueItem.conflict_reason = null;
    const updatedQueueItem = await this.queueRepo.save(queueItem);

    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: 'SYNC_CONFLICT_RESOLVED',
      correlationId: correlationId || 'corr-resolve-conflict',
      afterData: { conflict_id: conflict.id, strategy: data.resolution_strategy },
    });

    return { success: true, conflict, queue_item: updatedQueueItem };
  }
}
