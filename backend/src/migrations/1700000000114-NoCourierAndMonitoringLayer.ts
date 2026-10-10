import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The courier and head-office layer above plain delivery is gone (2026-10-10).
 *
 * - Courier attendance (the daily check-in) and courier mobile-POS assignments are dropped: any
 *   active courier of the branch can be given an order.
 * - A courier settlement goes straight from open to closed; one waiting in review is open again.
 * - A delivery can no longer be failed and requeued. One that was failed goes back to waiting
 *   for a courier; a failed ride nobody settled is deleted, since it expected no money.
 * - The operational alerts (the monitoring page and the bell) are dropped with their table.
 */
export class NoCourierAndMonitoringLayer1700000000114 implements MigrationInterface {
  name = 'NoCourierAndMonitoringLayer1700000000114';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "courier_settlement" SET "status" = 'DRAFT' WHERE "status" = 'UNDER_REVIEW'`);
    await queryRunner.query(`ALTER TABLE "courier_settlement" DROP COLUMN IF EXISTS "reviewed_by_user_id"`);

    await queryRunner.query(`UPDATE "delivery" SET "state" = 'UNASSIGNED', "courier_id" = NULL WHERE "state" = 'FAILED'`);
    await queryRunner.query(`
      DELETE FROM "delivery_assignment" a
       WHERE a."status" = 'FAILED'
         AND a."is_settled" = false
         AND NOT EXISTS (SELECT 1 FROM "courier_settlement_line" l WHERE l."delivery_assignment_id" = a."id")
    `);
    await queryRunner.query(`ALTER TABLE "delivery" DROP COLUMN IF EXISTS "failure_reason"`);
    await queryRunner.query(`ALTER TABLE "delivery_assignment" DROP COLUMN IF EXISTS "failure_reason"`);

    for (const table of ['courier_attendance', 'courier_terminal_assignment', 'operational_alert']) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }

  public async down(): Promise<void> {
    // Not restored: the features are gone.
  }
}
