import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives settings a second level. A row with branch_id NULL is the organization's value,
 * inherited by every branch; a row with a branch_id overrides it for that one location.
 *
 * The old UNIQUE (tenant_id, key) cannot express that, and a plain UNIQUE across all
 * three columns would not either: Postgres treats NULLs as distinct, so it would happily
 * accept two competing organization rows for the same key. Two partial indexes give one
 * organization row and one row per branch, which is exactly the rule.
 */
export class AddBranchScopeToTenantSetting1700000000046 implements MigrationInterface {
  name = 'AddBranchScopeToTenantSetting1700000000046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "tenant_setting" ADD COLUMN IF NOT EXISTS "branch_id" uuid;');
    await queryRunner.query('ALTER TABLE "tenant_setting" DROP CONSTRAINT IF EXISTS "UQ_tenant_setting_key";');
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_setting_org_key"
       ON "tenant_setting" ("tenant_id", "key") WHERE "branch_id" IS NULL;`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_setting_branch_key"
       ON "tenant_setting" ("tenant_id", "key", "branch_id") WHERE "branch_id" IS NOT NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Overrides have nowhere to live once the column goes, and leaving them would break
    // the unique constraint being restored, so they are dropped with it.
    await queryRunner.query('DELETE FROM "tenant_setting" WHERE "branch_id" IS NOT NULL;');
    await queryRunner.query('DROP INDEX IF EXISTS "UQ_tenant_setting_branch_key";');
    await queryRunner.query('DROP INDEX IF EXISTS "UQ_tenant_setting_org_key";');
    await queryRunner.query('ALTER TABLE "tenant_setting" DROP COLUMN IF EXISTS "branch_id";');
    await queryRunner.query(
      'ALTER TABLE "tenant_setting" ADD CONSTRAINT "UQ_tenant_setting_key" UNIQUE ("tenant_id", "key");',
    );
  }
}
