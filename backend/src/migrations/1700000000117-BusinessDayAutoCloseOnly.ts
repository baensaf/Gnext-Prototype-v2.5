import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The business day is a cutoff and an automatic close (2026-10-11):
 *
 * - The cutoff is one chain setting (P-07). Branch rows for BUSINESS_DAY go, and the chain row
 *   keeps only `cutoff`: the old chain-wide hours and the auto-close switch are gone.
 * - A cutoff change applies from the moment it is saved, so the branches' rule history goes.
 * - Nobody closes or reopens a day by hand: a reopened day is simply open again (auto-close
 *   closes it on its next sweep, within its look-back), and a closed day keeps only its date,
 *   totals and when it closed.
 * - Rial only (F2): shifts, cash movements and day closes no longer carry a currency, and the
 *   shift's old duplicate columns go.
 */
export class BusinessDayAutoCloseOnly1700000000117 implements MigrationInterface {
  name = 'BusinessDayAutoCloseOnly1700000000117';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "tenant_setting" WHERE "key" = 'BUSINESS_DAY' AND "branch_id" IS NOT NULL`);
    await queryRunner.query(
      `UPDATE "tenant_setting" SET "value" = jsonb_build_object('cutoff', COALESCE("value"->>'cutoff', '05:00'))
        WHERE "key" = 'BUSINESS_DAY'`,
    );
    await queryRunner.query(`ALTER TABLE "branch" DROP COLUMN IF EXISTS "business_day_timeline"`);

    await queryRunner.query(`DELETE FROM "business_day_close" WHERE "status" = 'REOPENED'`);
    // One close per branch and day: keep the Rial one where a day was ever closed per currency.
    await queryRunner.query(
      `DELETE FROM "business_day_close" WHERE "id" IN (
         SELECT "id" FROM (
           SELECT "id", ROW_NUMBER() OVER (
                    PARTITION BY "tenant_id", "branch_id", "business_date"
                    ORDER BY ("currency_code" = 'IRR') DESC, "closed_at") AS rn
             FROM "business_day_close") ranked
          WHERE rn > 1)`,
    );
    // Dropping currency_code drops the old per-currency unique key with it.
    for (const column of ['currency_code', 'status', 'closed_by', 'reopened_at', 'reopened_by', 'approval_request_id']) {
      await queryRunner.query(`ALTER TABLE "business_day_close" DROP COLUMN IF EXISTS "${column}"`);
    }
    await queryRunner.query(
      `ALTER TABLE "business_day_close" ADD CONSTRAINT "UQ_business_day_close_branch_date" UNIQUE ("tenant_id", "branch_id", "business_date")`,
    );

    await queryRunner.query(`UPDATE "cashier_shift" SET "opened_by" = "user_id" WHERE "opened_by" IS NULL AND "user_id" IS NOT NULL`);
    await queryRunner.query(
      `UPDATE "cashier_shift" SET "short_over" = "over_short_amount" WHERE "short_over" IS NULL AND "over_short_amount" IS NOT NULL`,
    );
    for (const column of ['currency_code', 'user_id', 'status', 'opening_float', 'over_short_amount', 'notes']) {
      await queryRunner.query(`ALTER TABLE "cashier_shift" DROP COLUMN IF EXISTS "${column}"`);
    }
    await queryRunner.query(`ALTER TABLE "cash_movement" DROP COLUMN IF EXISTS "currency_code"`);
  }

  public async down(): Promise<void> {
    // Not restored: the columns, branch rows and rule history are gone for good.
  }
}
