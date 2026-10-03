import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A chain can have 500,000 customers, and the POS picker now searches them on the server
 * (2026-10-03). Searching "contains" on the mobile and the name needs trigram indexes; the
 * name index is on the same expression the search uses (lower-cased, Arabic ي/ك as Persian
 * ی/ک). pg_trgm is a trusted extension, but if this database user still may not create it the
 * indexes are skipped: search keeps working, only slower, and the deploy is not blocked.
 */
export class CustomerSearchIndexes1700000000091 implements MigrationInterface {
  name = 'CustomerSearchIndexes1700000000091';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_customer_tenant_mobile" ON "customer" ("tenant_id", "mobile")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_customer_tenant_created" ON "customer" ("tenant_id", "created_at" DESC)`);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
      EXCEPTION WHEN insufficient_privilege OR feature_not_supported OR undefined_file THEN
        RAISE NOTICE 'pg_trgm not available; customer search runs without trigram indexes';
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
          CREATE INDEX IF NOT EXISTS "IDX_customer_mobile_trgm" ON "customer" USING gin ("mobile" gin_trgm_ops);
          CREATE INDEX IF NOT EXISTS "IDX_customer_name_trgm" ON "customer"
            USING gin ((translate(lower("first_name" || ' ' || "last_name"), 'يك', 'یک')) gin_trgm_ops);
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customer_name_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customer_mobile_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customer_tenant_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customer_tenant_mobile"`);
  }
}
