import { Test, TestingModule } from '@nestjs/testing';
import { OfflineSyncService } from '../src/modules/offline-sync/offline-sync.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OfflineQueueItem } from '../src/entities/OfflineQueueItem.entity';
import { SyncConflictRecord } from '../src/entities/SyncConflictRecord.entity';
import { BranchStatusSnapshot } from '../src/entities/BranchStatusSnapshot.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('OfflineSyncService (Unit & Integration)', () => {
  let service: OfflineSyncService;
  let queueRepo: any;
  let conflictRepo: any;
  let branchStatusRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    queueRepo = { count: jest.fn(), find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    conflictRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    branchStatusRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    auditWriter = { write: jest.fn() };

    let latestSnapshot: any = null;
    queueRepo.create.mockImplementation((dto: any) => dto);
    queueRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: dto.id || 'q-item-1' }));
    conflictRepo.create.mockImplementation((dto: any) => dto);
    conflictRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: dto.id || 'conf-1' }));
    branchStatusRepo.create.mockImplementation((dto: any) => dto);
    branchStatusRepo.save.mockImplementation((dto: any) => {
      latestSnapshot = { ...dto, id: dto.id || 'snap-1' };
      return Promise.resolve(latestSnapshot);
    });
    branchStatusRepo.findOne.mockImplementation(() => Promise.resolve(latestSnapshot));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfflineSyncService,
        { provide: getRepositoryToken(OfflineQueueItem), useValue: queueRepo },
        { provide: getRepositoryToken(SyncConflictRecord), useValue: conflictRepo },
        { provide: getRepositoryToken(BranchStatusSnapshot), useValue: branchStatusRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<OfflineSyncService>(OfflineSyncService);
  });

  it('should persist branch status in DB and return status on toggle', async () => {
    queueRepo.count.mockResolvedValue(0);

    const status = await service.toggleConnectivity('t-1', 'br-1', false);

    expect(status.is_online).toBe(false);
    expect(branchStatusRepo.save).toHaveBeenCalledWith(expect.objectContaining({ is_online: false }));
    expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'BRANCH_CONNECTIVITY_OFFLINE' }));
  });

  it('should return existing queue item when duplicate dedupe_key is enqueued', async () => {
    branchStatusRepo.findOne.mockResolvedValue({ is_online: false });
    queueRepo.findOne.mockResolvedValue({
      id: 'existing-item-1',
      tenant_id: 't-1',
      branch_id: 'br-1',
      dedupe_key: 'KEY-123',
      status: 'PENDING',
    });

    const res = await service.enqueueOfflineItem('t-1', {
      branch_id: 'br-1',
      entity_type: 'ORDER',
      payload: { total: '25.00' },
      dedupe_key: 'KEY-123',
    });

    expect((res as any).is_duplicate).toBe(true);
    expect(res.id).toBe('existing-item-1');
  });

  it('should reject arbitrary or corrupt financial JSON in enqueueOfflineItem', async () => {
    branchStatusRepo.findOne.mockResolvedValue({ is_online: false });

    await expect(
      service.enqueueOfflineItem('t-1', {
        branch_id: 'br-1',
        entity_type: 'ORDER',
        payload: { arbitrary_financial_json: true, total: '-50.00' },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should trigger sync worker, process queue items, and update DLQ state on retry limit', async () => {
    const pendingItems = [
      { id: 'q-1', tenant_id: 't-1', branch_id: 'br-1', entity_type: 'ORDER', payload: { total: '15.00' }, retry_count: 0, status: 'PENDING' },
      { id: 'q-2', tenant_id: 't-1', branch_id: 'br-1', entity_type: 'ORDER', payload: { total: '20.00', simulate_dlq: true }, retry_count: 0, status: 'PENDING' },
    ];

    queueRepo.find.mockResolvedValue(pendingItems);
    branchStatusRepo.findOne.mockResolvedValue({ tenant_id: 't-1', branch_id: 'br-1', is_online: true, last_sync_at: new Date('2026-08-01') });

    const res = await service.triggerSyncWorker('t-1', 'br-1');

    expect(res.processed_count).toBe(2);
    expect(res.synced_count).toBe(1);
    expect(res.dlq_count).toBe(1);
    expect(res.advanced_last_sync).toBe(false);
  });

  it('should advance last_sync_at only when all batch items succeed', async () => {
    const pendingItems = [
      { id: 'q-1', tenant_id: 't-1', branch_id: 'br-1', entity_type: 'ORDER', payload: { total: '15.00' }, retry_count: 0, status: 'PENDING' },
    ];

    queueRepo.find.mockResolvedValue(pendingItems);
    branchStatusRepo.findOne.mockResolvedValue({ tenant_id: 't-1', branch_id: 'br-1', is_online: true, last_sync_at: new Date('2026-08-01') });

    const res = await service.triggerSyncWorker('t-1', 'br-1');

    expect(res.processed_count).toBe(1);
    expect(res.synced_count).toBe(1);
    expect(res.advanced_last_sync).toBe(true);
  });

  it('should clone a DLQ_FAILED queue item as a new PENDING item for manual retry', async () => {
    queueRepo.findOne.mockResolvedValue({
      id: 'dlq-item-1',
      tenant_id: 't-1',
      branch_id: 'br-1',
      entity_type: 'ORDER',
      payload: { total: '30.00' },
      status: 'DLQ_FAILED',
      client_version: 1,
    });

    const cloned = await service.cloneDlqItem('t-1', 'dlq-item-1');

    expect(cloned.status).toBe('PENDING');
    expect(cloned.retry_count).toBe(0);
    expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'OFFLINE_ITEM_RETRY_CLONED' }));
  });

  it('should reject invalid merged financial payload during conflict resolution', async () => {
    conflictRepo.findOne.mockResolvedValue({
      id: 'conf-1',
      tenant_id: 't-1',
      queue_item_id: 'q-2',
      conflict_type: 'PRICE_MISMATCH',
      client_state: { total: '20.00' },
      server_state: { total: '25.00' },
    });

    queueRepo.findOne.mockResolvedValue({
      id: 'q-2',
      tenant_id: 't-1',
      entity_type: 'ORDER',
      status: 'CONFLICT',
      payload: { total: '20.00' },
    });

    await expect(
      service.resolveConflict('t-1', {
        conflict_id: 'conf-1',
        resolution_strategy: 'MANUAL_OVERRIDE',
        override_payload: { arbitrary_financial_json: true },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should resolve sync conflict using ACCEPT_CLIENT strategy', async () => {
    conflictRepo.findOne.mockResolvedValue({
      id: 'conf-1',
      tenant_id: 't-1',
      queue_item_id: 'q-2',
      conflict_type: 'PRICE_MISMATCH',
      client_state: { total: '20.00' },
      server_state: { total: '25.00' },
    });

    queueRepo.findOne.mockResolvedValue({
      id: 'q-2',
      tenant_id: 't-1',
      entity_type: 'ORDER',
      status: 'CONFLICT',
      payload: { total: '20.00' },
    });

    const res = await service.resolveConflict('t-1', {
      conflict_id: 'conf-1',
      resolution_strategy: 'ACCEPT_CLIENT',
    });

    expect(res.success).toBe(true);
    expect(res.conflict.resolution_strategy).toBe('ACCEPT_CLIENT');
    expect(res.queue_item.status).toBe('SYNCED');
  });
});
