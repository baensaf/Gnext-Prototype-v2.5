import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Branch management (Branch Management spec, 2026-10-01).
 *
 * A branch gets its pin on the map: latitude and longitude, required when a branch is
 * created. Branches made before this have none until head office places them.
 *
 * Outside its opening hours a branch still sells; the till only warns. An order sent then
 * is marked `after_hours`, decided once when it is sent, so changing the hours later never
 * re-marks what came before.
 *
 * A day's shift that closes at or before it opens runs past midnight. `spans_midnight` is
 * now derived from the times, so rows saved with the flag off and such times are corrected.
 */
export class BranchLocationAfterHours1700000000086 implements MigrationInterface {
  name = 'BranchLocationAfterHours1700000000086';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "branch" ADD COLUMN IF NOT EXISTS "latitude" numeric(9,6)`);
    await queryRunner.query(`ALTER TABLE "branch" ADD COLUMN IF NOT EXISTS "longitude" numeric(9,6)`);
    await queryRunner.query(`ALTER TABLE "branch" ADD COLUMN IF NOT EXISTS "archived_by" uuid`);
    await queryRunner.query(
      `ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "after_hours" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "branch_operating_hour" SET "spans_midnight" = ("close_time" <= "open_time")
        WHERE "is_closed" = false AND "open_time" IS NOT NULL AND "close_time" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "after_hours"`);
    await queryRunner.query(`ALTER TABLE "branch" DROP COLUMN IF EXISTS "archived_by"`);
    await queryRunner.query(`ALTER TABLE "branch" DROP COLUMN IF EXISTS "longitude"`);
    await queryRunner.query(`ALTER TABLE "branch" DROP COLUMN IF EXISTS "latitude"`);
  }
}
