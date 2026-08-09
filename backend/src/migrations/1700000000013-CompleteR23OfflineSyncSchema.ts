import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteR23OfflineSyncSchema1700000000013 implements MigrationInterface {
  name = 'CompleteR23OfflineSyncSchema1700000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "offline_queue_item" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "terminal_id" uuid NULL,
        "entity_type" varchar(64) NOT NULL,
        "payload" jsonb NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'PENDING',
        "retry_count" integer NOT NULL DEFAULT 0,
        "conflict_reason" text NULL,
        "client_version" integer NOT NULL DEFAULT 1,
        "server_version" integer NULL,
        "dedupe_key" varchar(128) NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "synced_at" TIMESTAMP WITH TIME ZONE NULL,
        CONSTRAINT "PK_offline_queue_item" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_offline_queue_tenant_branch_status"
      ON "offline_queue_item" ("tenant_id", "branch_id", "status");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sync_conflict_record" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "queue_item_id" uuid NOT NULL,
        "conflict_type" varchar(64) NOT NULL,
        "client_state" jsonb NOT NULL,
        "server_state" jsonb NOT NULL,
        "resolution_strategy" varchar(32) NOT NULL DEFAULT 'UNRESOLVED',
        "resolved_by" uuid NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "resolved_at" TIMESTAMP WITH TIME ZONE NULL,
        CONSTRAINT "PK_sync_conflict_record" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sync_conflict_tenant_queue"
      ON "sync_conflict_record" ("tenant_id", "queue_item_id");
    `);

    await queryRunner.query(`
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
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_branch_status_tenant_branch"
      ON "branch_status_snapshot" ("tenant_id", "branch_id", "recorded_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "branch_status_snapshot";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sync_conflict_record";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "offline_queue_item";`);
  }
}
