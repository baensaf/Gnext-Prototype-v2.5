import { Test, TestingModule } from '@nestjs/testing';
import { OfflineSyncService } from '../src/modules/offline-sync/offline-sync.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OfflineQueueItem } from '../src/entities/OfflineQueueItem.entity';
import { SyncConflictRecord } from '../src/entities/SyncConflictRecord.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { NotFoundException } from '@nestjs/common';

describe('OfflineSyncService (Unit)', () => {
  let service: OfflineSyncService;
  let queueRepo: any;
  let conflictRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    queueRepo = { count: jest.fn(), find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    conflictRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    auditWriter = { write: jest.fn() };

    queueRepo.create.mockImplementation((dto: any) => dto);
    queueRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'q-item-1' }));
    conflictRepo.create.mockImplementation((dto: any) => dto);
    conflictRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'conf-1' }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfflineSyncService,
        { provide: getRepositoryToken(OfflineQueueItem), useValue: queueRepo },
        { provide: getRepositoryToken(SyncConflictRecord), useValue: conflictRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<OfflineSyncService>(OfflineSyncService);
  });

  it('should toggle connectivity and return branch status', async () => {
    queueRepo.count.mockResolvedValue(0);

    const status = await service.toggleConnectivity('t-1', 'br-1', false);

    expect(status.is_online).toBe(false);
    expect(status.pending_queue_count).toBe(0);
    expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'BRANCH_CONNECTIVITY_OFFLINE' }));
  });

  it('should enqueue item as PENDING when offline, and SYNCED when online', async () => {
    await service.toggleConnectivity('t-1', 'br-1', false);

    const item = await service.enqueueOfflineItem('t-1', {
      branch_id: 'br-1',
      entity_type: 'ORDER',
      payload: { order_num: 'OFF-101', amount: 50.0 },
    });

    expect(item.status).toBe('PENDING');

    await service.toggleConnectivity('t-1', 'br-1', true);
    const itemOnline = await service.enqueueOfflineItem('t-1', {
      branch_id: 'br-1',
      entity_type: 'ORDER',
      payload: { order_num: 'ONL-101', amount: 50.0 },
    });

    expect(itemOnline.status).toBe('SYNCED');
  });

  it('should trigger sync worker and process pending queue items with conflict detection', async () => {
    const pendingItems = [
      { id: 'q-1', tenant_id: 't-1', branch_id: 'br-1', payload: { order_num: 'O-1' }, retry_count: 0, status: 'PENDING' },
      { id: 'q-2', tenant_id: 't-1', branch_id: 'br-1', payload: { order_num: 'O-2', simulate_conflict: 'PRICE_MISMATCH' }, retry_count: 0, status: 'PENDING' },
    ];

    queueRepo.find.mockResolvedValue(pendingItems);

    const res = await service.triggerSyncWorker('t-1', 'br-1');

    expect(res.processed_count).toBe(2);
    expect(res.synced_count).toBe(1);
    expect(res.conflict_count).toBe(1);
    expect(conflictRepo.save).toHaveBeenCalledWith(expect.objectContaining({ conflict_type: 'PRICE_MISMATCH' }));
  });

  it('should resolve sync conflicts using ACCEPT_CLIENT strategy', async () => {
    conflictRepo.findOne.mockResolvedValue({
      id: 'conf-1',
      tenant_id: 't-1',
      queue_item_id: 'q-2',
      conflict_type: 'PRICE_MISMATCH',
      client_state: { price: '20.00' },
      server_state: { price: '25.00' },
    });

    queueRepo.findOne.mockResolvedValue({
      id: 'q-2',
      tenant_id: 't-1',
      status: 'CONFLICT',
      payload: { price: '20.00' },
    });

    const res = await service.resolveConflict('t-1', {
      conflict_id: 'conf-1',
      resolution_strategy: 'ACCEPT_CLIENT',
    });

    expect(res.success).toBe(true);
    expect(res.conflict.resolution_strategy).toBe('ACCEPT_CLIENT');
    expect(res.queue_item.status).toBe('SYNCED');
    expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'SYNC_CONFLICT_RESOLVED' }));
  });
});
