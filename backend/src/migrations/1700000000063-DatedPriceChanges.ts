import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dated price changes ("+10% from Saturday"). A change is a `price_bulk_job`; the prices it
 * sets are `price_entry` rows that start on its date and point back at it, so a change that
 * has not started yet can be cancelled whole.
 *
 * Base prices can now be dated too: a `price_entry` with no list, branch, channel, order type
 * or add-on. The old bulk update wrote rows like that which never priced anything; they are
 * closed here so they do not start pricing items now that base rows count.
 */
export class DatedPriceChanges1700000000063 implements MigrationInterface {
  name = 'DatedPriceChanges1700000000063';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "price_entry" ADD COLUMN IF NOT EXISTS "bulk_job_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_price_entry_bulk_job" ON "price_entry" ("bulk_job_id") WHERE "bulk_job_id" IS NOT NULL`,
    );

    await queryRunner.query(`ALTER TABLE "price_bulk_job" ADD COLUMN IF NOT EXISTS "price_group_id" uuid`);
    await queryRunner.query(`ALTER TABLE "price_bulk_job" ADD COLUMN IF NOT EXISTS "effective_from" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "price_bulk_job" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP WITH TIME ZONE`);

    await queryRunner.query(`
      UPDATE "price_entry"
      SET "effective_to" = GREATEST("effective_from", now())
      WHERE "price_group_id" IS NULL AND "branch_id" IS NULL AND "channel" IS NULL
        AND "order_type" IS NULL AND "modifier_option_id" IS NULL
        AND ("effective_to" IS NULL OR "effective_to" > now())
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "price_entry" WHERE "bulk_job_id" IS NOT NULL`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_price_entry_bulk_job"`);
    await queryRunner.query(`ALTER TABLE "price_entry" DROP COLUMN IF EXISTS "bulk_job_id"`);
    await queryRunner.query(`ALTER TABLE "price_bulk_job" DROP COLUMN IF EXISTS "cancelled_at"`);
    await queryRunner.query(`ALTER TABLE "price_bulk_job" DROP COLUMN IF EXISTS "effective_from"`);
    await queryRunner.query(`ALTER TABLE "price_bulk_job" DROP COLUMN IF EXISTS "price_group_id"`);
  }
}
