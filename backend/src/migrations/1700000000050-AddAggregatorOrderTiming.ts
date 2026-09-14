import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Timing for incoming orders. Snappfood's preparation time, the minutes it lets the store add
 * and how the order travels decide the longest time a store may promise; accepted_at and
 * promised_minutes record what it did promise. aggregator_issue_* mark an accepted order the
 * store handed back to Snappfood support, which then cancels it or sends it back.
 */
export class AddAggregatorOrderTiming1700000000050 implements MigrationInterface {
  name = 'AddAggregatorOrderTiming1700000000050';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_header"
        ADD COLUMN IF NOT EXISTS "aggregator_prep_minutes" integer,
        ADD COLUMN IF NOT EXISTS "aggregator_max_extra_minutes" integer,
        ADD COLUMN IF NOT EXISTS "aggregator_expedition" character varying(20),
        ADD COLUMN IF NOT EXISTS "accepted_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "promised_minutes" integer,
        ADD COLUMN IF NOT EXISTS "aggregator_issue_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "aggregator_issue" character varying(255);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_header"
        DROP COLUMN IF EXISTS "aggregator_issue",
        DROP COLUMN IF EXISTS "aggregator_issue_at",
        DROP COLUMN IF EXISTS "promised_minutes",
        DROP COLUMN IF EXISTS "accepted_at",
        DROP COLUMN IF EXISTS "aggregator_expedition",
        DROP COLUMN IF EXISTS "aggregator_max_extra_minutes",
        DROP COLUMN IF EXISTS "aggregator_prep_minutes";
    `);
  }
}
