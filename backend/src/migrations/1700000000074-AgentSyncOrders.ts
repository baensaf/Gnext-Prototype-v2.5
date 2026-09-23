import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Orders a branch took while offline (protocol §12.5–§12.6): each saved as its agent sent it,
 * and marked on the order it became, so the directory can say it was taken offline.
 */
export class AgentSyncOrders1700000000074 implements MigrationInterface {
  name = 'AgentSyncOrders1700000000074';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_sync_order" (
        "id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "agent_id" uuid NOT NULL,
        "payload" jsonb NOT NULL,
        "payload_hash" character varying(64) NOT NULL,
        "status" character varying(16) NOT NULL,
        "flags" jsonb NOT NULL DEFAULT '[]',
        "error" text,
        "order_number" character varying(40),
        "received_at" timestamptz NOT NULL DEFAULT now(),
        "booked_at" timestamptz,
        "reviewed_at" timestamptz,
        "reviewed_by" uuid
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_agent_sync_order_status"
      ON "agent_sync_order" ("tenant_id", "status", "received_at")
    `);
    await queryRunner.query(`ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "source" character varying(30)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "source"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_sync_order"`);
  }
}
