import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The wallet is no longer the credit account (2026-10-12). Cashback the customer earned is
 * money we owe them; credit is money they owe us. One balance held both, so a customer's
 * cashback quietly paid off their debt and a cashback award opened a credit line.
 *
 * Each customer now has up to two accounts, told apart by `kind`: CREDIT (pay later, with a
 * limit, never above zero) and WALLET (cashback, never below zero), paid from with the new
 * WALLET payment method.
 *
 * Existing balances are split where they stand: an account that only ever earned cashback
 * becomes the wallet; any other account in the customer's favour moves that part to a new
 * wallet with a TRANSFER entry on each side, so both ledgers still add up.
 *
 * The friends-and-family rate (customer_discount) belongs to one branch now: each branch has
 * its own few people. Rates set before this go to the chain's first branch.
 */
export class WalletApartFromCredit1700000000121 implements MigrationInterface {
  name = 'WalletApartFromCredit1700000000121';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "credit_account" ADD COLUMN IF NOT EXISTS "kind" varchar(10) NOT NULL DEFAULT 'CREDIT'`);
    await queryRunner.query(`ALTER TABLE "credit_account" DROP CONSTRAINT IF EXISTS "UQ_credit_account_tenant_customer_currency"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_credit_account_tenant_customer_currency_kind" ON "credit_account" ("tenant_id", "customer_id", "currency_code", "kind")`,
    );

    // Accounts opened by a cashback award (or never used for credit) become the wallet.
    await queryRunner.query(`
      UPDATE "credit_account" a
         SET "kind" = 'WALLET', "credit_limit" = NULL, "mode" = 'FINITE'
       WHERE a."kind" = 'CREDIT'
         AND EXISTS (SELECT 1 FROM "credit_entry" e WHERE e."account_id" = a."id"
                      AND e."entry_type" IN ('LOYALTY_CASHBACK', 'LOYALTY_CASHBACK_REVERSAL'))
         AND NOT EXISTS (SELECT 1 FROM "credit_entry" e WHERE e."account_id" = a."id"
                      AND e."entry_type" NOT IN ('LOYALTY_CASHBACK', 'LOYALTY_CASHBACK_REVERSAL'))
         AND COALESCE(a."credit_limit", 0) IN (0, 10000000)
    `);

    // Any other credit account in the customer's favour hands that part to a new wallet.
    const inFavour: { id: string; tenant_id: string; customer_id: string; currency_code: string; current_balance: string }[] =
      await queryRunner.query(`
        SELECT a."id", a."tenant_id", a."customer_id", a."currency_code", a."current_balance"
          FROM "credit_account" a
         WHERE a."kind" = 'CREDIT' AND a."current_balance" > 0 AND a."deleted_at" IS NULL
      `);
    for (const acc of inFavour) {
      const [wallet] = await queryRunner.query(
        `INSERT INTO "credit_account" ("tenant_id", "customer_id", "currency_code", "kind", "mode", "credit_limit", "current_balance")
         VALUES ($1, $2, $3, 'WALLET', 'FINITE', NULL, $4)
         ON CONFLICT ("tenant_id", "customer_id", "currency_code", "kind")
           DO UPDATE SET "current_balance" = "credit_account"."current_balance" + EXCLUDED."current_balance"
         RETURNING "id", "current_balance"`,
        [acc.tenant_id, acc.customer_id, acc.currency_code, acc.current_balance],
      );
      await queryRunner.query(
        `INSERT INTO "credit_entry" ("tenant_id", "account_id", "entry_type", "amount", "currency_code", "reason_text", "reference", "business_date", "balance_after")
         VALUES ($1, $2, 'TRANSFER', $3, $4, 'Moved to the wallet', 'WALLET_SPLIT', to_char(now(), 'YYYY-MM-DD'), 0),
                ($1, $5, 'TRANSFER', $6, $4, 'Moved from the credit account', 'WALLET_SPLIT', to_char(now(), 'YYYY-MM-DD'), $7)`,
        [acc.tenant_id, acc.id, `-${acc.current_balance}`, acc.currency_code, wallet.id, acc.current_balance, wallet.current_balance],
      );
      await queryRunner.query(`UPDATE "credit_account" SET "current_balance" = 0 WHERE "id" = $1`, [acc.id]);
    }

    // The wallet is paid from like any other tender.
    await queryRunner.query(`
      INSERT INTO "payment_method" ("tenant_id", "code", "name", "kind", "is_active")
      SELECT DISTINCT pm."tenant_id", 'WALLET', 'کیف پول', 'WALLET', true
        FROM "payment_method" pm
       WHERE pm."code" = 'CREDIT_ACCOUNT'
         AND NOT EXISTS (SELECT 1 FROM "payment_method" w WHERE w."tenant_id" = pm."tenant_id" AND w."code" = 'WALLET')
    `);

    // Friends and family belong to a branch.
    await queryRunner.query(`ALTER TABLE "customer_discount" ADD COLUMN IF NOT EXISTS "branch_id" uuid`);
    await queryRunner.query(`
      UPDATE "customer_discount" cd
         SET "branch_id" = (SELECT b."id" FROM "branch" b WHERE b."tenant_id" = cd."tenant_id" ORDER BY b."created_at" ASC LIMIT 1)
       WHERE cd."branch_id" IS NULL
    `);
    // One live rate per person per branch: older duplicates are switched off.
    await queryRunner.query(`
      UPDATE "customer_discount" cd SET "is_active" = false
       WHERE cd."is_active" AND cd."deleted_at" IS NULL
         AND EXISTS (SELECT 1 FROM "customer_discount" n
                      WHERE n."tenant_id" = cd."tenant_id" AND n."customer_id" = cd."customer_id"
                        AND n."branch_id" IS NOT DISTINCT FROM cd."branch_id"
                        AND n."is_active" AND n."deleted_at" IS NULL AND n."created_at" > cd."created_at")
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_customer_discount_branch_active" ON "customer_discount" ("tenant_id", "customer_id", "branch_id") WHERE "is_active" AND "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_customer_discount_branch_active"`);
    await queryRunner.query(`ALTER TABLE "customer_discount" DROP COLUMN IF EXISTS "branch_id"`);
    await queryRunner.query(`DELETE FROM "payment_method" WHERE "code" = 'WALLET' AND "kind" = 'WALLET'`);
    // Balances stay split: folding a wallet back into a credit account is not undone here.
  }
}
