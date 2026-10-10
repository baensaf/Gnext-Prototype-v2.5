import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Closing a shift is one step (2026-10-10): the cashier counts the cash and closes, and the
 * system stores the difference as a number.
 *
 * - A shift waiting in the old "closing review" step is simply open again.
 * - A safe drop becomes a pay-out of the same amount, so every drawer's arithmetic stays as it was.
 * - The difference reason, the approval link and the stale-preview stamp on a shift are gone.
 * - SHIFT_POLICY keeps only the default opening float; the tolerance and the blind-count switch go.
 */
export class ShiftCloseOneStep1700000000115 implements MigrationInterface {
  name = 'ShiftCloseOneStep1700000000115';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "cashier_shift" SET "state" = 'OPEN' WHERE "state" = 'CLOSING_REVIEW'`);
    await queryRunner.query(`UPDATE "cashier_shift" SET "status" = 'OPEN' WHERE "status" = 'CLOSING_REVIEW'`);

    await queryRunner.query(
      `UPDATE "cash_movement" SET "type" = 'PAID_OUT', "reason_text" = COALESCE("reason_text", 'Safe drop') WHERE "type" = 'SAFE_DROP'`,
    );

    for (const column of ['closing_note', 'approval_request_id', 'preview_version']) {
      await queryRunner.query(`ALTER TABLE "cashier_shift" DROP COLUMN IF EXISTS "${column}"`);
    }

    await queryRunner.query(
      `UPDATE "tenant_setting" SET "value" = "value" - 'varianceTolerance' - 'blindClose' WHERE "key" = 'SHIFT_POLICY'`,
    );
  }

  public async down(): Promise<void> {
    // Not restored: the states, movement type, columns and policy fields are gone for good.
  }
}
