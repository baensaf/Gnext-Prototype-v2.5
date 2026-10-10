import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customer credit down to its core, and the customer extras gone (2026-10-10).
 *
 * - A credit account has a limit, a balance and its transactions. Suspending, closing and
 *   blocking an account are gone, and so is the reason code that only manual adjustments
 *   carried. An account that was suspended, closed or blocked keeps its intent: its limit
 *   drops to zero, so nothing more can be sold on credit to it. Adjustment entries already
 *   posted stay in the ledger, because the balances were built from them.
 * - The approval rule for lifting a credit limit goes with the limit override.
 * - Tags, consents, segments and customer merges are dropped with their tables.
 */
export class CreditAndCustomerExtrasOut1700000000113 implements MigrationInterface {
  name = 'CreditAndCustomerExtrasOut1700000000113';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "credit_account" SET "mode" = 'FINITE', "credit_limit" = '0.0000' WHERE "status" <> 'ACTIVE' OR "is_blocked" = true`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_credit_account_customer_status"`);
    await queryRunner.query(`ALTER TABLE "credit_account" DROP COLUMN IF EXISTS "status"`);
    await queryRunner.query(`ALTER TABLE "credit_account" DROP COLUMN IF EXISTS "is_blocked"`);
    await queryRunner.query(`ALTER TABLE "credit_entry" DROP COLUMN IF EXISTS "reason_code_id"`);

    await queryRunner.query(`DELETE FROM "approval_rule" WHERE "action" = 'CREDIT_OVERRIDE'`);

    for (const table of ['customer_merge', 'customer_consent', 'customer_segment', 'customer_tag_link', 'customer_tag']) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }

  public async down(): Promise<void> {
    // Not restored: the columns, the rule and the tables are gone for good.
  }
}
