import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OfflineQueueItem } from '../../entities/OfflineQueueItem.entity';
import { SyncConflictRecord } from '../../entities/SyncConflictRecord.entity';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class OfflineSyncService {
  private connectivityStateMap: Record<string, { is_online: boolean; last_synced_at: Date }> = {};

  constructor(
    @InjectRepository(OfflineQueueItem) private readonly queueRepo: Repository<OfflineQueueItem>,
    @InjectRepository(SyncConflictRecord) private readonly conflictRepo: Repository<SyncConflictRecord>,
    private readonly auditWriter: AuditWriter,
  ) {}

  private getBranchKey(tenantId: string, branchId: string): string {
    return `${tenantId}:${branchId}`;
  }

  async getStatus(tenantId: string, branchId: string = 'default-branch') {
    const key = this.getBranchKey(tenantId, branchId);
    const connState = this.connectivityStateMap[key] || { is_online: true, last_synced_at: new Date() };

    const pendingCount = await this.queueRepo.count({
      where: { tenant_id: tenantId, branch_id: branchId, status: 'PENDING' },
    });

    const conflictCount = await this.queueRepo.count({
      where: { tenant_id: tenantId, branch_id: branchId, status: 'CONFLICT' },
    });

    const dlqCount = await this.queueRepo.count({
      where: { tenant_id: tenantId, branch_id: branchId, status: 'DLQ_FAILED' },
    });

    return {
      tenant_id: tenantId,
      branch_id: branchId,
      is_online: connState.is_online,
      last_synced_at: connState.last_synced_at,
      pending_queue_count: pendingCount,
      conflict_count: conflictCount,
      dlq_count: dlqCount,
    };
  }

  async toggleConnectivity(tenantId: string, branchId: string = 'default-branch', isOnline: boolean = true) {
    const key = this.getBranchKey(tenantId, branchId);
    const current = this.connectivityStateMap[key] || { is_online: true, last_synced_at: new Date() };

    this.connectivityStateMap[key] = {
      is_online: isOnline,
      last_synced_at: isOnline ? new Date() : current.last_synced_at,
    };

    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: isOnline ? 'BRANCH_CONNECTIVITY_ONLINE' : 'BRANCH_CONNECTIVITY_OFFLINE',
      correlationId: 'corr-offline-toggle',
      afterData: { branch_id: branchId, is_online: isOnline },
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
    },
    correlationId?: string,
  ) {
    const key = this.getBranchKey(tenantId, data.branch_id);
    const connState = this.connectivityStateMap[key] || { is_online: true, last_synced_at: new Date() };

    const initialStatus = connState.is_online ? 'SYNCED' : 'PENDING';

    const item = this.queueRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id,
      terminal_id: data.terminal_id || null,
      entity_type: data.entity_type || 'ORDER',
      payload: data.payload,
      status: initialStatus,
      client_version: data.client_version || 1,
      synced_at: connState.is_online ? new Date() : null,
    });

    const saved = await this.queueRepo.save(item);

    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: 'OFFLINE_ITEM_ENQUEUED',
      correlationId: correlationId || 'corr-queue-enqueue',
      afterData: { item_id: saved.id, status: saved.status, entity_type: saved.entity_type },
    });

    return saved;
  }

  async triggerSyncWorker(tenantId: string, branchId: string = 'default-branch', correlationId?: string) {
    const pendingItems = await this.queueRepo.find({
      where: { tenant_id: tenantId, branch_id: branchId, status: 'PENDING' },
      order: { created_at: 'ASC' },
    });

    let syncedCount = 0;
    let conflictCount = 0;

    for (const item of pendingItems) {
      item.status = 'SYNCING';
      item.retry_count += 1;
      await this.queueRepo.save(item);

      // Check if simulated payload specifies a conflict scenario
      if (item.payload?.simulate_conflict) {
        const conflictType = item.payload.simulate_conflict; // e.g. PRICE_MISMATCH or OUT_OF_STOCK
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
      }
    }

    const key = this.getBranchKey(tenantId, branchId);
    this.connectivityStateMap[key] = {
      is_online: true,
      last_synced_at: new Date(),
    };

    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: 'OFFLINE_SYNC_WORKER_EXECUTED',
      correlationId: correlationId || 'corr-sync-worker',
      afterData: { synced_count: syncedCount, conflict_count: conflictCount },
    });

    return {
      success: true,
      processed_count: pendingItems.length,
      synced_count: syncedCount,
      conflict_count: conflictCount,
    };
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

    conflict.resolution_strategy = data.resolution_strategy;
    conflict.resolved_at = new Date();
    conflict.resolved_by = userId || null;
    await this.conflictRepo.save(conflict);

    if (data.resolution_strategy === 'ACCEPT_CLIENT') {
      queueItem.status = 'SYNCED';
      queueItem.synced_at = new Date();
    } else if (data.resolution_strategy === 'ACCEPT_SERVER') {
      queueItem.status = 'SYNCED';
      queueItem.payload = conflict.server_state;
      queueItem.synced_at = new Date();
    } else {
      queueItem.status = 'SYNCED';
      queueItem.payload = data.override_payload || conflict.client_state;
      queueItem.synced_at = new Date();
    }

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
