import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Four catalog extras are out of the prototype (2026-10-10): the packaging price on a product,
 * weekly selling windows, today's stock counts, and dated price changes. Price changes apply at
 * once now, so changes still waiting for their day are dropped with the prices they would have
 * started.
 */
export class CatalogExtrasOut1700000000110 implements MigrationInterface {
  name = 'CatalogExtrasOut1700000000110';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN IF EXISTS "container_price"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "availability_schedule"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "daily_stock"`);

    // A price change that has not started: its rows were never charged. The rows it was going
    // to end are put back as they were (the job remembers each one's previous end).
    const waiting: Array<{ id: string; params: { closed?: Array<{ id: string; previous_to: string | null }> } | null }> =
      await queryRunner.query(`SELECT "id", "params" FROM "price_bulk_job" WHERE "status" = 'SCHEDULED' AND "effective_from" > now()`);
    for (const job of waiting) {
      for (const closed of job.params?.closed || []) {
        await queryRunner.query(`UPDATE "price_entry" SET "effective_to" = $1 WHERE "id" = $2`, [closed.previous_to, closed.id]);
      }
      await queryRunner.query(`DELETE FROM "price_entry" WHERE "bulk_job_id" = $1`, [job.id]);
    }
    await queryRunner.query(`DELETE FROM "price_bulk_job" WHERE "id" = ANY($1)`, [waiting.map((job) => job.id)]);
    await queryRunner.query(`DELETE FROM "price_bulk_job" WHERE "status" = 'CANCELLED'`);
    await queryRunner.query(`UPDATE "price_bulk_job" SET "status" = 'APPLIED' WHERE "status" = 'SCHEDULED'`);
    await queryRunner.query(`ALTER TABLE "price_bulk_job" DROP COLUMN IF EXISTS "cancelled_at"`);
  }

  public async down(): Promise<void> {
    // Not restored: the features are gone.
  }
}
