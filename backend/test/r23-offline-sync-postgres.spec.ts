import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { OfflineSyncService } from '../src/modules/offline-sync/offline-sync.service';
import { OfflineQueueItem } from '../src/entities/OfflineQueueItem.entity';
import { SyncConflictRecord } from '../src/entities/SyncConflictRecord.entity';
import { BranchStatusSnapshot } from '../src/entities/BranchStatusSnapshot.entity';
import { SyncCategoryLog } from '../src/entities/SyncCategoryLog.entity';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';

const generateUuid = () =>
  '00000000-0000-4000-8000-' + Math.random().toString(16).substring(2, 14).padStart(12, '0');

describe('R23 Real PostgreSQL Integration Suite (Port 5433)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let service: OfflineSyncService;
  let dataSource: DataSource;
  let testTenantId: string;
  let testBranchId: string;

  beforeAll(async () => {
    process.env.DB_PORT = process.env.DB_PORT || '5433';
    process.env.DB_NAME = process.env.DB_NAME || 'appdb_test';
    process.env.DB_USER = process.env.DB_USER || 'postgres';
    process.env.DB_USERNAME = process.env.DB_USERNAME || 'postgres';
    process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = moduleRef.get<DataSource>(DataSource);
    service = moduleRef.get<OfflineSyncService>(OfflineSyncService);

    // Run forward migrations / table creation query runner for R23
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS "offline_queue_item" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "terminal_id" uuid NULL,
        "entity_type" varchar(64) NOT NULL,
        "payload" jsonb NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'PENDING',
        "retry_count" integer NOT NULL DEFAULT 0,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMP WITH TIME ZONE NULL,
        "claimed_by" varchar(128) NULL,
        "claimed_at" TIMESTAMP WITH TIME ZONE NULL,
        "claim_expires_at" TIMESTAMP WITH TIME ZONE NULL,
        "failure_reason" text NULL,
        "conflict_reason" text NULL,
        "client_version" integer NOT NULL DEFAULT 1,
        "server_version" integer NULL,
        "dedupe_key" varchar(128) NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "synced_at" TIMESTAMP WITH TIME ZONE NULL,
        CONSTRAINT "PK_offline_queue_item" PRIMARY KEY ("id")
      );

      ALTER TABLE "offline_queue_item"
        ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "claimed_by" varchar(128) NULL,
        ADD COLUMN IF NOT EXISTS "claimed_at" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "claim_expires_at" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "failure_reason" text NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_offline_queue_active_dedupe"
      ON "offline_queue_item" ("tenant_id", "branch_id", "dedupe_key")
      WHERE dedupe_key IS NOT NULL AND status IN ('PENDING', 'SYNCING', 'CONFLICT');

      CREATE TABLE IF NOT EXISTS "sync_conflict_record" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "queue_item_id" uuid NOT NULL,
        "conflict_type" varchar(64) NOT NULL,
        "client_state" jsonb NOT NULL,
        "server_state" jsonb NOT NULL,
        "local_original" jsonb NULL,
        "cloud_original" jsonb NULL,
        "local_version" integer NULL,
        "cloud_version" integer NULL,
        "resolution_strategy" varchar(32) NOT NULL DEFAULT 'UNRESOLVED',
        "resolution_result" jsonb NULL,
        "resolved_by" uuid NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "resolved_at" TIMESTAMP WITH TIME ZONE NULL,
        CONSTRAINT "PK_sync_conflict_record" PRIMARY KEY ("id")
      );

      ALTER TABLE "sync_conflict_record"
        ADD COLUMN IF NOT EXISTS "local_original" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "cloud_original" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "local_version" integer NULL,
        ADD COLUMN IF NOT EXISTS "cloud_version" integer NULL,
        ADD COLUMN IF NOT EXISTS "resolution_result" jsonb NULL;

      CREATE TABLE IF NOT EXISTS "branch_status_snapshot" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "is_online" boolean NOT NULL DEFAULT true,
        "agent_version" varchar(40) NULL,
        "agent_health" varchar(20) NOT NULL DEFAULT 'HEALTHY',
        "last_heartbeat_at" TIMESTAMP WITH TIME ZONE NULL,
        "last_sync_at" TIMESTAMP WITH TIME ZONE NULL,
        "offline_since" TIMESTAMP WITH TIME ZONE NULL,
        "details" jsonb NULL,
        "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_branch_status_snapshot" PRIMARY KEY ("id")
      );

      CREATE TABLE IF NOT EXISTS "sync_category_log" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "batch_id" uuid NOT NULL,
        "category" varchar(64) NOT NULL,
        "processed_count" integer NOT NULL DEFAULT 0,
        "synced_count" integer NOT NULL DEFAULT 0,
        "conflict_count" integer NOT NULL DEFAULT 0,
        "dlq_count" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_sync_category_log" PRIMARY KEY ("id")
      );
    `);

    // Create test tenant and branch
    const tenantRepo = dataSource.getRepository(Tenant);
    let tenant = await tenantRepo.findOne({ where: { code: 'R23-PG-TEST' } });
    if (!tenant) {
      tenant = tenantRepo.create({
        code: 'R23-PG-TEST',
        name: 'R23 Offline Sync Test Tenant',
        base_currency: 'IRR',
        default_locale: 'fa',
        time_zone: 'Asia/Tehran',
      });
      tenant = await tenantRepo.save(tenant);
    }
    testTenantId = tenant.id;

    const branchRepo = dataSource.getRepository(Branch);
    let branch = await branchRepo.findOne({ where: { tenant_id: testTenantId, code: 'BR-R23-TEST' } });
    if (!branch) {
      branch = branchRepo.create({
        tenant_id: testTenantId,
        code: 'BR-R23-TEST',
        name: 'R23 Test Branch',
        is_active: true,
        time_zone: 'Asia/Tehran',
      });
      branch = await branchRepo.save(branch);
    }
    testBranchId = branch.id;
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('1. Atomic Dedupe Race in PostgreSQL: unique scoped index catches concurrent enqueues', async () => {
    const dedupeKey = `RACE-KEY-${Date.now()}`;

    // Ensure branch status is offline so items stay PENDING
    await service.toggleConnectivity(testTenantId, testBranchId, false);

    const enqueuePromises = Array.from({ length: 5 }).map(() =>
      service.enqueueOfflineItem(testTenantId, {
        branch_id: testBranchId,
        entity_type: 'ORDER',
        payload: { order_id: 'ord-race-1', product_id: 'p-1', quantity: 1 },
        dedupe_key: dedupeKey,
      }),
    );

    const results = await Promise.all(enqueuePromises);

    // All return an item with the exact same ID
    const firstId = results[0].id;
    expect(firstId).toBeDefined();

    for (const res of results) {
      expect(res.id).toBe(firstId);
    }

    const duplicates = results.filter((r: any) => r.is_duplicate === true);
    expect(duplicates.length).toBe(4);

    // Verify in PostgreSQL table that exactly ONE row exists with this dedupe_key
    const queueRepo = dataSource.getRepository(OfflineQueueItem);
    const dbItems = await queueRepo.find({
      where: { tenant_id: testTenantId, branch_id: testBranchId, dedupe_key: dedupeKey },
    });
    expect(dbItems.length).toBe(1);
  });

  it('2. Concurrent Worker Claims in PostgreSQL: FOR UPDATE SKIP LOCKED prevents double processing', async () => {
    const queueRepo = dataSource.getRepository(OfflineQueueItem);
    const branchConc = generateUuid();

    // Create 4 pending items
    for (let i = 1; i <= 4; i++) {
      const item = queueRepo.create({
        tenant_id: testTenantId,
        branch_id: branchConc,
        entity_type: 'CUSTOMER',
        payload: { customer_id: `cust-conc-${i}`, name: `Customer ${i}` },
        status: 'PENDING',
        client_version: 1,
      });
      await queueRepo.save(item);
    }

    // Run 2 workers concurrently in parallel promises
    const [w1Res, w2Res] = await Promise.all([
      service.triggerSyncWorker(testTenantId, branchConc),
      service.triggerSyncWorker(testTenantId, branchConc),
    ]);

    expect(w1Res.processed_count + w2Res.processed_count).toBe(4);
  });

  it('3. Process Restart Durability: queue items, conflicts, and snapshot persist across service lifecycle', async () => {
    const queueRepo = dataSource.getRepository(OfflineQueueItem);
    const conflictRepo = dataSource.getRepository(SyncConflictRecord);

    const restartKey = `RESTART-${Date.now()}`;
    const item = queueRepo.create({
      tenant_id: testTenantId,
      branch_id: testBranchId,
      entity_type: 'SETTING',
      payload: { setting_key: 'tax_rate', setting_value: '0.09' },
      status: 'PENDING',
      dedupe_key: restartKey,
      client_version: 1,
    });
    const savedItem = await queueRepo.save(item);

    const conflict = conflictRepo.create({
      tenant_id: testTenantId,
      queue_item_id: savedItem.id,
      conflict_type: 'VERSION_MISMATCH',
      client_state: { setting_value: '0.09' },
      server_state: { setting_value: '0.10' },
      local_original: { setting_value: '0.09' },
      cloud_original: { setting_value: '0.10' },
      local_version: 1,
      cloud_version: 2,
      resolution_strategy: 'UNRESOLVED',
    });
    await conflictRepo.save(conflict);

    // Re-query from DB to verify restart durability
    const queue = await service.getQueue(testTenantId, testBranchId);
    const foundItem = queue.find((q) => q.dedupe_key === restartKey);
    expect(foundItem).toBeDefined();

    const conflicts = await service.getConflicts(testTenantId);
    const foundConflict = conflicts.find((c) => c.queue_item_id === savedItem.id);
    expect(foundConflict).toBeDefined();
    expect(foundConflict?.local_version).toBe(1);
    expect(foundConflict?.cloud_version).toBe(2);
  });

  it('4. Durable Retry Scheduling & Expired Claim Recovery: updates attempt_count and recovers dead workers', async () => {
    const queueRepo = dataSource.getRepository(OfflineQueueItem);

    // Insert an item with expired claim from a crashed worker
    const expiredClaimItem = queueRepo.create({
      tenant_id: testTenantId,
      branch_id: testBranchId,
      entity_type: 'CUSTOMER',
      payload: { customer_id: 'cust-expired-1', name: 'Expired Worker Target' },
      status: 'SYNCING',
      claimed_by: 'crashed-worker-99',
      claimed_at: new Date(Date.now() - 60000), // 1 minute ago
      claim_expires_at: new Date(Date.now() - 30000), // expired 30s ago
      client_version: 1,
    });
    const savedExpired = await queueRepo.save(expiredClaimItem);

    // Worker runs and recovers expired claim
    const res = await service.triggerSyncWorker(testTenantId, testBranchId);
    expect(res.synced_count).toBeGreaterThanOrEqual(1);

    const reRead = await queueRepo.findOne({ where: { id: savedExpired.id } });
    expect(reRead?.status).toBe('SYNCED');
    expect(reRead?.claimed_by).toBeNull();
  });

  it('5. DLQ Threshold & Manual Retry Cloning: clones DLQ_FAILED item to new PENDING item', async () => {
    const queueRepo = dataSource.getRepository(OfflineQueueItem);

    const dlqItem = queueRepo.create({
      tenant_id: testTenantId,
      branch_id: testBranchId,
      entity_type: 'ORDER',
      payload: { order_id: 'ord-dlq-1', product_id: 'p-1', quantity: 1, simulate_dlq: true },
      status: 'PENDING',
      client_version: 1,
      dedupe_key: `DLQ-KEY-${Date.now()}`,
    });
    const savedDlq = await queueRepo.save(dlqItem);

    await service.triggerSyncWorker(testTenantId, testBranchId);

    const afterWorker = await queueRepo.findOne({ where: { id: savedDlq.id } });
    expect(afterWorker?.status).toBe('DLQ_FAILED');
    expect(afterWorker?.failure_reason).toBeDefined();

    // Clone DLQ item for manual retry
    const cloned = await service.cloneDlqItem(testTenantId, savedDlq.id);
    expect(cloned.status).toBe('PENDING');
    expect(cloned.attempt_count).toBe(0);
    expect(cloned.failure_reason).toBeNull();
    expect(cloned.payload.simulate_dlq).toBeUndefined();
  });

  it('6. Version Conflicts & Resolutions: Local, Cloud, Merged, and Rejection of Merged Financial Payloads', async () => {
    const queueRepo = dataSource.getRepository(OfflineQueueItem);
    const conflictRepo = dataSource.getRepository(SyncConflictRecord);

    // A. Financial Merged Resolution Rejection Test
    const finQueueItem = queueRepo.create({
      tenant_id: testTenantId,
      branch_id: testBranchId,
      entity_type: 'ORDER',
      payload: { order_id: 'ord-fin-1' },
      status: 'CONFLICT',
    });
    const savedFinItem = await queueRepo.save(finQueueItem);

    const finConflict = conflictRepo.create({
      tenant_id: testTenantId,
      queue_item_id: savedFinItem.id,
      conflict_type: 'VERSION_MISMATCH',
      client_state: { order_id: 'ord-fin-1' },
      server_state: { order_id: 'ord-fin-1' },
      local_original: { order_id: 'ord-fin-1' },
      cloud_original: { order_id: 'ord-fin-1' },
      local_version: 1,
      cloud_version: 2,
      resolution_strategy: 'UNRESOLVED',
    });
    const savedFinConflict = await conflictRepo.save(finConflict);

    await expect(
      service.resolveConflict(testTenantId, {
        conflict_id: savedFinConflict.id,
        resolution_strategy: 'MERGED',
        override_payload: { order_id: 'ord-fin-1' },
      }),
    ).rejects.toThrow(BadRequestException);

    // B. Non-Financial Merged Resolution Acceptance Test (e.g. CUSTOMER)
    const custQueueItem = queueRepo.create({
      tenant_id: testTenantId,
      branch_id: testBranchId,
      entity_type: 'CUSTOMER',
      payload: { customer_id: 'cust-merge-1', name: 'Alice' },
      status: 'CONFLICT',
    });
    const savedCustItem = await queueRepo.save(custQueueItem);

    const custConflict = conflictRepo.create({
      tenant_id: testTenantId,
      queue_item_id: savedCustItem.id,
      conflict_type: 'VERSION_MISMATCH',
      client_state: { customer_id: 'cust-merge-1', name: 'Alice' },
      server_state: { customer_id: 'cust-merge-1', name: 'Alice Smith' },
      local_original: { customer_id: 'cust-merge-1', name: 'Alice' },
      cloud_original: { customer_id: 'cust-merge-1', name: 'Alice Smith' },
      local_version: 1,
      cloud_version: 2,
      resolution_strategy: 'UNRESOLVED',
    });
    const savedCustConflict = await conflictRepo.save(custConflict);

    const mergedRes = await service.resolveConflict(testTenantId, {
      conflict_id: savedCustConflict.id,
      resolution_strategy: 'MERGED',
      override_payload: { customer_id: 'cust-merge-1', name: 'Alice M. Smith' },
    });

    expect(mergedRes.success).toBe(true);
    expect(mergedRes.conflict.resolution_strategy).toBe('MERGED');
    expect(mergedRes.conflict.resolution_result).toEqual({ customer_id: 'cust-merge-1', name: 'Alice M. Smith' });
    expect(mergedRes.queue_item.status).toBe('SYNCED');

    // C. LOCAL Resolution Test
    const localConflictItem = queueRepo.create({
      tenant_id: testTenantId,
      branch_id: testBranchId,
      entity_type: 'SETTING',
      payload: { setting_key: 'theme', setting_value: 'dark' },
      status: 'CONFLICT',
    });
    const savedLocalItem = await queueRepo.save(localConflictItem);

    const localConflict = conflictRepo.create({
      tenant_id: testTenantId,
      queue_item_id: savedLocalItem.id,
      conflict_type: 'VERSION_MISMATCH',
      client_state: { setting_key: 'theme', setting_value: 'dark' },
      server_state: { setting_key: 'theme', setting_value: 'light' },
      local_original: { setting_key: 'theme', setting_value: 'dark' },
      cloud_original: { setting_key: 'theme', setting_value: 'light' },
      local_version: 1,
      cloud_version: 2,
      resolution_strategy: 'UNRESOLVED',
    });
    const savedLocalConflict = await conflictRepo.save(localConflict);

    const localRes = await service.resolveConflict(testTenantId, {
      conflict_id: savedLocalConflict.id,
      resolution_strategy: 'LOCAL',
    });

    expect(localRes.success).toBe(true);
    expect(localRes.conflict.resolution_strategy).toBe('LOCAL');
    expect(localRes.conflict.resolution_result).toEqual({ setting_key: 'theme', setting_value: 'dark' });

    // D. CLOUD Resolution Test
    const cloudConflictItem = queueRepo.create({
      tenant_id: testTenantId,
      branch_id: testBranchId,
      entity_type: 'SETTING',
      payload: { setting_key: 'locale', setting_value: 'en' },
      status: 'CONFLICT',
    });
    const savedCloudItem = await queueRepo.save(cloudConflictItem);

    const cloudConflict = conflictRepo.create({
      tenant_id: testTenantId,
      queue_item_id: savedCloudItem.id,
      conflict_type: 'VERSION_MISMATCH',
      client_state: { setting_key: 'locale', setting_value: 'en' },
      server_state: { setting_key: 'locale', setting_value: 'fa' },
      local_original: { setting_key: 'locale', setting_value: 'en' },
      cloud_original: { setting_key: 'locale', setting_value: 'fa' },
      local_version: 1,
      cloud_version: 2,
      resolution_strategy: 'UNRESOLVED',
    });
    const savedCloudConflict = await conflictRepo.save(cloudConflict);

    const cloudRes = await service.resolveConflict(testTenantId, {
      conflict_id: savedCloudConflict.id,
      resolution_strategy: 'CLOUD',
    });

    expect(cloudRes.success).toBe(true);
    expect(cloudRes.conflict.resolution_strategy).toBe('CLOUD');
    expect(cloudRes.conflict.resolution_result).toEqual({ setting_key: 'locale', setting_value: 'fa' });
  });

  it('7. last_sync_at Nullability & Advancement: stays null on failure, advances on 100% success', async () => {
    const queueRepo = dataSource.getRepository(OfflineQueueItem);

    const testBranch2 = generateUuid();
    const initialStatus = await service.getStatus(testTenantId, testBranch2);
    expect(initialStatus.last_synced_at).toBeNull();

    // Enqueue 1 succeeding item and 1 failing item
    await queueRepo.save(
      queueRepo.create({
        tenant_id: testTenantId,
        branch_id: testBranch2,
        entity_type: 'CUSTOMER',
        payload: { customer_id: 'cust-s-1' },
        status: 'PENDING',
      }),
    );

    await queueRepo.save(
      queueRepo.create({
        tenant_id: testTenantId,
        branch_id: testBranch2,
        entity_type: 'CUSTOMER',
        payload: { customer_id: 'cust-f-1', simulate_failure: 'DB connection dropped' },
        status: 'PENDING',
      }),
    );

    const batch1 = await service.triggerSyncWorker(testTenantId, testBranch2);
    expect(batch1.advanced_last_sync).toBe(false);

    const statusAfterBatch1 = await service.getStatus(testTenantId, testBranch2);
    expect(statusAfterBatch1.last_synced_at).toBeNull();

    // Now clear failed items and run batch with 100% success
    await queueRepo.delete({ tenant_id: testTenantId, branch_id: testBranch2, status: 'DLQ_FAILED' });

    await queueRepo.save(
      queueRepo.create({
        tenant_id: testTenantId,
        branch_id: testBranch2,
        entity_type: 'CUSTOMER',
        payload: { customer_id: 'cust-s-2' },
        status: 'PENDING',
      }),
    );

    const batch2 = await service.triggerSyncWorker(testTenantId, testBranch2);
    expect(batch2.advanced_last_sync).toBe(true);

    const statusAfterBatch2 = await service.getStatus(testTenantId, testBranch2);
    expect(statusAfterBatch2.last_synced_at).not.toBeNull();
  });

  it('8. Persisted Incremental Category Logs: sync_category_log table stores batch counts', async () => {
    const catLogRepo = dataSource.getRepository(SyncCategoryLog);
    const queueRepo = dataSource.getRepository(OfflineQueueItem);

    const branchCat = generateUuid();

    await queueRepo.save(
      queueRepo.create({
        tenant_id: testTenantId,
        branch_id: branchCat,
        entity_type: 'ORDER',
        payload: { order_id: 'ord-cat-1' },
        status: 'PENDING',
      }),
    );

    await queueRepo.save(
      queueRepo.create({
        tenant_id: testTenantId,
        branch_id: branchCat,
        entity_type: 'PAYMENT',
        payload: { order_id: 'ord-cat-1', payment_method_id: 'cash' },
        status: 'PENDING',
      }),
    );

    const res = await service.triggerSyncWorker(testTenantId, branchCat);
    expect(res.batch_id).toBeDefined();

    const logs = await catLogRepo.find({ where: { tenant_id: testTenantId, branch_id: branchCat, batch_id: res.batch_id } });
    expect(logs.length).toBeGreaterThanOrEqual(2);

    const orderLog = logs.find((l) => l.category === 'ORDER');
    const paymentLog = logs.find((l) => l.category === 'PAYMENT');

    expect(orderLog).toBeDefined();
    expect(orderLog?.processed_count).toBe(1);
    expect(orderLog?.synced_count).toBe(1);

    expect(paymentLog).toBeDefined();
    expect(paymentLog?.processed_count).toBe(1);
    expect(paymentLog?.synced_count).toBe(1);
  });

  it('9. Offline -> Online E2E Flow: offline queueing to online sync worker execution', async () => {
    const branchE2e = generateUuid();

    // A. Toggle Offline
    const offlineStatus = await service.toggleConnectivity(testTenantId, branchE2e, false);
    expect(offlineStatus.is_online).toBe(false);

    // B. Enqueue while offline
    const item = await service.enqueueOfflineItem(testTenantId, {
      branch_id: branchE2e,
      entity_type: 'CUSTOMER',
      payload: { customer_id: 'cust-e2e-1', name: 'Offline Customer' },
    });
    expect(item.status).toBe('PENDING');

    // C. Toggle Online
    const onlineStatus = await service.toggleConnectivity(testTenantId, branchE2e, true);
    expect(onlineStatus.is_online).toBe(true);

    // D. Trigger Sync Worker
    const syncRes = await service.triggerSyncWorker(testTenantId, branchE2e);
    expect(syncRes.synced_count).toBe(1);

    const finalStatus = await service.getStatus(testTenantId, branchE2e);
    expect(finalStatus.pending_queue_count).toBe(0);
    expect(finalStatus.last_synced_at).not.toBeNull();
  });
});
