import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Snappfood orders taken while the cloud was away (protocol §17). One order per Snappfood code:
 * `aggregator_match` says whether the till's record, Snappfood's, or both are in, and
 * `aggregator_match_at` when it got there, for the Missed while offline list. The branch's
 * couriers join the snapshot, so a change to them is announced like the other tables it is
 * built from (migration 073).
 */
export class SnappfoodOfflineMatch1700000000078 implements MigrationInterface {
  name = 'SnappfoodOfflineMatch1700000000078';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "aggregator_match" varchar(20)`);
    await queryRunner.query(`ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "aggregator_match_at" timestamptz`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_order_header_aggregator_match"
      ON "order_header" ("tenant_id", "aggregator_match")
      WHERE "aggregator_match" IS NOT NULL
    `);

    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_agent_data_notify" ON "courier"`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_agent_data_notify"
      AFTER INSERT OR UPDATE OR DELETE ON "courier"
      FOR EACH ROW EXECUTE FUNCTION gnext_live_notify('agent-data')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_agent_data_notify" ON "courier"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_order_header_aggregator_match"`);
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "aggregator_match_at"`);
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "aggregator_match"`);
  }
}
