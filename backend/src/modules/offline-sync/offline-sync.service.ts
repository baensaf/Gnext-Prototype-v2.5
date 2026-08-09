import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { OfflineQueueItem } from '../../entities/OfflineQueueItem.entity';
import { SyncConflictRecord } from '../../entities/SyncConflictRecord.entity';
import { BranchStatusSnapshot } from '../../entities/BranchStatusSnapshot.entity';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class OfflineSyncService {
  constructor(
    @InjectRepository(OfflineQueueItem) private readonly queueRepo: Repository<OfflineQueueItem>,
    @InjectRepository(SyncConflictRecord) private readonly conflictRepo: Repository<SyncConflictRecord>,
    @InjectRepository(BranchStatusSnapshot) private readonly branchStatusRepo: Repository<BranchStatusSnapshot>,
    private readonly auditWriter: AuditWriter,
  ) {}

  private validateDomainPayload(entityType: string, payload: any) {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException(`Invalid payload for domain operation: payload must be an object`);
    }

    if (payload.arbitrary_financial_json === true || payload.is_corrupt === true) {
      throw new BadRequestException(`Invalid payload for domain operation: arbitrary or corrupt financial JSON rejected`);
    }

    const typeUpper = (entityType || 'ORDER').toUpperCase();

    if (typeUpper === 'ORDER') {
      if (payload.total !== undefined) {
        const val = Number(payload.total);
        if (isNaN(val) || val < 0) {
          throw new BadRequestException(`Invalid payload for ORDER: total must be non-negative numeric value`);
        }
      }
      if (payload.amount !== undefined) {
        const val = Number(payload.amount);
        if (isNaN(val) || val < 0) {
          throw new BadRequestException(`Invalid payload for ORDER: amount must be non-negative numeric value`);
        }
      }
      if (Array.isArray(payload.items)) {
        for (const item of payload.items) {
          if (item.price !== undefined) {
            const p = Number(item.price);
            if (isNaN(p) || p < 0) {
              throw new BadRequestException(`Invalid payload for ORDER: item price must be non-negative numeric value`);
            }
          }
        }
      }
    } else if (typeUpper === 'PAYMENT') {
      if (payload.amount !== undefined) {
        const val = Number(payload.amount);
        if (isNaN(val) || val <= 0) {
          throw new BadRequestException(`Invalid payload for PAYMENT: amount must be positive numeric value`);
        }
      }
    } else if (typeUpper === 'REFUND') {
      if (payload.amount !== undefined) {
        const val = Number(payload.amount);
        if (isNaN(val) || val <= 0) {
          throw new BadRequestException(`Invalid payload for REFUND: amount must be positive numeric value`);
        }
      }
    } else if (typeUpper === 'CASH_SHIFT') {
      if (payload.opening_balance !== undefined) {
        const val = Number(payload.opening_balance);
        if (isNaN(val) || val < 0) {
          throw new BadRequestException(`Invalid payload for CASH_SHIFT: balance must be valid numeric value`);
        }
      }
    }
  }

  private async getLatestBranchSnapshot(tenantId: string, branchId: string): Promise<BranchStatusSnapshot> {
    let snapshot = await this.branchStatusRepo.findOne({
      where: { tenant_id: tenantId, branch_id: branchId },
      order: { recorded_at: 'DESC' },
    });

    if (!snapshot) {
      snapshot = this.branchStatusRepo.create({
        tenant_id: tenantId,
        branch_id: branchId,
        is_online: true,
        agent_version: 'v1.5.0-sim',
        agent_health: 'HEALTHY',
        last_heartbeat_at: new Date(),
        last_sync_at: new Date(),
        offline_since: null,
        details: { initialized: true },
      });
      snapshot = await this.branchStatusRepo.save(snapshot);
    }

    return snapshot;
  }

  async getStatus(tenantId: string, branchId: string = 'default-branch') {
    const snapshot = await this.getLatestBranchSnapshot(tenantId, branchId);

    const pendingCount = await this.queueRepo.count({
      where: { tenant_id: tenantId, branch_id: branchId, status: 'PENDING' },
    });

    const conflictCount = await this.queueRepo.count({
      where: { tenant_id: tenantId, branch_id: branchId, status: 'CONFLICT' },
    });

    const dlqCount = await this.queueRepo.count({
      where: { tenant_id: tenantId, branch_id: branchId, status: 'DLQ_FAILED' },
    });

    const syncingCount = await this.queueRepo.count({
      where: { tenant_id: tenantId, branch_id: branchId, status: 'SYNCING' },
    });

    return {
      tenant_id: tenantId,
      branch_id: branchId,
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
    branchId: string = 'default-branch',
    isOnline: boolean = true,
    agentVersion?: string,
    agentHealth?: string,
  ) {
    const latest = await this.getLatestBranchSnapshot(tenantId, branchId);

    let offlineSince: Date | null = latest.offline_since;
    if (latest.is_online && !isOnline) {
      offlineSince = new Date();
    } else if (isOnline) {
      offlineSince = null;
    }

    const newSnapshot = this.branchStatusRepo.create({
      tenant_id: tenantId,
      branch_id: branchId,
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
        branch_id: branchId,
        is_online: isOnline,
        offline_since: offlineSince,
        agent_version: newSnapshot.agent_version,
      },
    });

    return this.getStatus(tenantId, branchId);
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
    const entityType = data.entity_type || 'ORDER';
    this.validateDomainPayload(entityType, data.payload);

    if (data.dedupe_key) {
      const existing = await this.queueRepo.findOne({
        where: {
          tenant_id: tenantId,
          branch_id: data.branch_id,
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

    const snapshot = await this.getLatestBranchSnapshot(tenantId, data.branch_id);
    const initialStatus = snapshot.is_online ? 'SYNCED' : 'PENDING';

    const item = this.queueRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id,
      terminal_id: data.terminal_id || null,
      entity_type: entityType,
      payload: data.payload,
      status: initialStatus,
      client_version: data.client_version || 1,
      dedupe_key: data.dedupe_key || null,
      synced_at: snapshot.is_online ? new Date() : null,
    });

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
  }

  async triggerSyncWorker(tenantId: string, branchId: string = 'default-branch', correlationId?: string) {
    const pendingItems = await this.queueRepo.find({
      where: {
        tenant_id: tenantId,
        branch_id: branchId,
        status: In(['PENDING', 'SYNCING']),
      },
      order: { created_at: 'ASC' },
    });

    let syncedCount = 0;
    let conflictCount = 0;
    let dlqCount = 0;

    const categoryCounts: Record<string, number> = {
      menus: 0,
      prices: 0,
      customers: 0,
      orders: 0,
      payments: 0,
      refunds: 0,
      approvals: 0,
      settings: 0,
      courier: 0,
    };

    for (const item of pendingItems) {
      item.status = 'SYNCING';
      item.retry_count += 1;
      await this.queueRepo.save(item);

      const typeUpper = (item.entity_type || 'ORDER').toUpperCase();

      if (item.payload?.simulate_dlq || item.payload?.simulate_failure || item.retry_count > 3) {
        item.status = 'DLQ_FAILED';
        item.conflict_reason = item.payload?.simulate_failure
          ? `Simulated worker failure: ${item.payload.simulate_failure}`
          : `Retry count exceeded maximum limit (DLQ)`;
        await this.queueRepo.save(item);
        dlqCount += 1;
      } else if (item.payload?.simulate_conflict) {
        const conflictType = item.payload.simulate_conflict;
        item.status = 'CONFLICT';
        item.conflict_reason = `Sync conflict detected: ${conflictType}`;
        const savedItem = await this.queueRepo.save(item);

        const conflictRecord = this.conflictRepo.create({
          tenant_id: tenantId,
          queue_item_id: savedItem.id,
          conflict_type: conflictType,
          client_state: item.payload,
          server_state: {
            server_price: '25.00',
            available_stock: 0,
            server_version: (item.client_version || 1) + 1,
            server_timestamp: new Date().toISOString(),
          },
          resolution_strategy: 'UNRESOLVED',
        });
        await this.conflictRepo.save(conflictRecord);
        conflictCount += 1;
      } else {
        item.status = 'SYNCED';
        item.synced_at = new Date();
        await this.queueRepo.save(item);
        syncedCount += 1;

        if (typeUpper === 'ORDER') categoryCounts.orders += 1;
        else if (typeUpper === 'PAYMENT') categoryCounts.payments += 1;
        else if (typeUpper === 'REFUND') categoryCounts.refunds += 1;
        else if (typeUpper === 'CUSTOMER') categoryCounts.customers += 1;
        else if (typeUpper.includes('PRICE')) categoryCounts.prices += 1;
        else if (typeUpper.includes('MENU') || typeUpper.includes('CATALOG')) categoryCounts.menus += 1;
        else if (typeUpper.includes('APPROVAL')) categoryCounts.approvals += 1;
        else if (typeUpper.includes('CONFIG') || typeUpper.includes('SETTING')) categoryCounts.settings += 1;
        else if (typeUpper.includes('COURIER')) categoryCounts.courier += 1;
        else categoryCounts.orders += 1;
      }
    }

    const latestSnapshot = await this.getLatestBranchSnapshot(tenantId, branchId);
    let updatedLastSyncAt = latestSnapshot.last_sync_at;

    const allSucceeded = pendingItems.length > 0 && syncedCount === pendingItems.length && conflictCount === 0 && dlqCount === 0;
    if (allSucceeded) {
      updatedLastSyncAt = new Date();
      const syncSnapshot = this.branchStatusRepo.create({
        tenant_id: tenantId,
        branch_id: branchId,
        is_online: true,
        agent_version: latestSnapshot.agent_version,
        agent_health: latestSnapshot.agent_health,
        last_heartbeat_at: new Date(),
        last_sync_at: updatedLastSyncAt,
        offline_since: null,
        details: {
          last_batch_synced_count: syncedCount,
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
        processed_count: pendingItems.length,
        synced_count: syncedCount,
        conflict_count: conflictCount,
        dlq_count: dlqCount,
        category_counts: categoryCounts,
        advanced_last_sync: allSucceeded,
      },
    });

    return {
      success: true,
      processed_count: pendingItems.length,
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
      throw new BadRequestException(`Only items in DLQ_FAILED state can be cloned for retry`);
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
      retry_count: 0,
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
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
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
      resolution_strategy: 'ACCEPT_CLIENT' | 'ACCEPT_SERVER' | 'MANUAL_OVERRIDE';
      override_payload?: any;
    },
    userId?: string,
    correlationId?: string,
  ) {
    const conflict = await this.conflictRepo.findOne({ where: { id: data.conflict_id, tenant_id: tenantId } });
    if (!conflict) throw new NotFoundException('Conflict record not found');

    const queueItem = await this.queueRepo.findOne({ where: { id: conflict.queue_item_id } });
    if (!queueItem) throw new NotFoundException('Associated queue item not found');

    const strategyUpper = (data.resolution_strategy || 'LOCAL').toUpperCase();

    if (strategyUpper === 'MANUAL_OVERRIDE' || strategyUpper === 'MERGED') {
      const override = data.override_payload || conflict.client_state;
      this.validateDomainPayload(queueItem.entity_type, override);
      queueItem.payload = override;
    } else if (strategyUpper === 'ACCEPT_SERVER' || strategyUpper === 'CLOUD') {
      queueItem.payload = conflict.server_state;
    } else if (strategyUpper === 'ACCEPT_CLIENT' || strategyUpper === 'LOCAL') {
      queueItem.payload = conflict.client_state;
    } else {
      throw new BadRequestException(`Unsupported resolution strategy: ${data.resolution_strategy}`);
    }

    conflict.resolution_strategy = data.resolution_strategy;
    conflict.resolved_at = new Date();
    conflict.resolved_by = userId || null;
    await this.conflictRepo.save(conflict);

    queueItem.status = 'SYNCED';
    queueItem.synced_at = new Date();
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
