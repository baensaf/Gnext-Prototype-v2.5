import { MigrationInterface, QueryRunner } from 'typeorm';

export class R23OfflineSyncCorrections1700000000015 implements MigrationInterface {
  name = 'R23OfflineSyncCorrections1700000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add missing retry scheduling, worker claiming, and failure columns to offline_queue_item
    await queryRunner.query(`
      ALTER TABLE "offline_queue_item"
        ADD COLUMN IF NOT EXISTS "dedupe_key" varchar(128) NULL,
        ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "claimed_by" varchar(128) NULL,
        ADD COLUMN IF NOT EXISTS "claimed_at" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "claim_expires_at" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "failure_reason" text NULL;
    `);

    // 2. Add scoped partial unique index for active deduplication
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_offline_queue_active_dedupe"
      ON "offline_queue_item" ("tenant_id", "branch_id", "dedupe_key")
      WHERE dedupe_key IS NOT NULL AND status IN ('PENDING', 'SYNCING', 'CONFLICT');
    `);

    // 3. Add local/cloud originals, versions, and resolution_result to sync_conflict_record
    await queryRunner.query(`
      ALTER TABLE "sync_conflict_record"
        ADD COLUMN IF NOT EXISTS "local_original" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "cloud_original" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "local_version" integer NULL,
        ADD COLUMN IF NOT EXISTS "cloud_version" integer NULL,
        ADD COLUMN IF NOT EXISTS "resolution_result" jsonb NULL;
    `);

    // 4. Create sync_category_log table for persisted batch category metrics
    await queryRunner.query(`
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

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sync_category_log_tenant_batch"
      ON "sync_category_log" ("tenant_id", "branch_id", "batch_id");
    `);

    // 5. Create approval_rule table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "approval_rule" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "action" varchar(64) NOT NULL,
        "threshold_type" varchar(32) NOT NULL DEFAULT 'PERCENTAGE',
        "threshold_value" numeric(19,4) NOT NULL DEFAULT '0.0000',
        "required_steps" integer NOT NULL DEFAULT 1,
        "approver_role" varchar(32) NOT NULL DEFAULT 'SUPERVISOR',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_approval_rule" PRIMARY KEY ("id")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "approval_rule";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sync_category_log_tenant_batch";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sync_category_log";`);
    await queryRunner.query(`
      ALTER TABLE "sync_conflict_record"
        DROP COLUMN IF EXISTS "resolution_result",
        DROP COLUMN IF EXISTS "cloud_version",
        DROP COLUMN IF EXISTS "local_version",
        DROP COLUMN IF EXISTS "cloud_original",
        DROP COLUMN IF EXISTS "local_original";
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_offline_queue_active_dedupe";`);
    await queryRunner.query(`
      ALTER TABLE "offline_queue_item"
        DROP COLUMN IF EXISTS "failure_reason",
        DROP COLUMN IF EXISTS "claim_expires_at",
        DROP COLUMN IF EXISTS "claimed_at",
        DROP COLUMN IF EXISTS "claimed_by",
        DROP COLUMN IF EXISTS "next_attempt_at",
        DROP COLUMN IF EXISTS "attempt_count";
    `);
  }
}
