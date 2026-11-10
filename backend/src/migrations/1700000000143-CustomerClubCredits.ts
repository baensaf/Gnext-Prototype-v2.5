import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The club for branches leaving HAMI (2026-11-10): wallet credit that starts the next day and
 * expires, as HamiClub's does, and a discount reason for HamiClub codes typed at the till.
 *
 * Every wallet entry that put money in becomes a credit with what is left of it. The balance a
 * wallet holds today is laid on its newest such entries, since spending always took the oldest;
 * those credits keep no last day, so nothing already in a wallet expires.
 */
export class CustomerClubCredits1700000000143 implements MigrationInterface {
  name = 'CustomerClubCredits1700000000143';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "credit_entry" ADD COLUMN IF NOT EXISTS "remaining" numeric(19,4)`);
    await queryRunner.query(`ALTER TABLE "credit_entry" ADD COLUMN IF NOT EXISTS "available_from" varchar(10)`);
    await queryRunner.query(`ALTER TABLE "credit_entry" ADD COLUMN IF NOT EXISTS "expires_on" varchar(10)`);

    await queryRunner.query(
      `WITH credits AS (
         SELECT e."id", e."amount", a."current_balance",
                SUM(e."amount") OVER (PARTITION BY e."account_id" ORDER BY e."posted_at" DESC, e."id" DESC) AS "running"
           FROM "credit_entry" e
           JOIN "credit_account" a ON a."id" = e."account_id"
          WHERE a."kind" = 'WALLET' AND e."amount" > 0
       )
       UPDATE "credit_entry" c
          SET "remaining" = GREATEST(LEAST(credits."amount", credits."current_balance" - (credits."running" - credits."amount")), 0)
         FROM credits
        WHERE c."id" = credits."id"`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_credit_entry_open_credits" ON "credit_entry" ("account_id", "expires_on") WHERE "remaining" > 0`,
    );

    await queryRunner.query(
      `INSERT INTO "reason_code" ("tenant_id", "code", "name", "type", "applies_to")
       SELECT t."id", 'HAMI_CLUB', 'کد باشگاه حامی', 'DISCOUNT', ARRAY['DISCOUNT']::varchar[]
         FROM "tenant" t
        WHERE NOT EXISTS (SELECT 1 FROM "reason_code" r WHERE r."tenant_id" = t."id" AND r."code" = 'HAMI_CLUB')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "reason_code" WHERE "type" = 'DISCOUNT' AND "code" = 'HAMI_CLUB'`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_credit_entry_open_credits"`);
    await queryRunner.query(`ALTER TABLE "credit_entry" DROP COLUMN IF EXISTS "expires_on"`);
    await queryRunner.query(`ALTER TABLE "credit_entry" DROP COLUMN IF EXISTS "available_from"`);
    await queryRunner.query(`ALTER TABLE "credit_entry" DROP COLUMN IF EXISTS "remaining"`);
  }
}
