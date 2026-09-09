import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ties a user to a location. NULL means head office: the account works across the whole
 * chain. A branch id confines the account to that one site, which is what makes "branch
 * manager" a different thing from "administrator" rather than just a different label.
 *
 * Existing accounts stay NULL, because every account created before this ran was, in
 * effect, chain-wide.
 */
export class AddBranchScopeToAdminUser1700000000047 implements MigrationInterface {
  name = 'AddBranchScopeToAdminUser1700000000047';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "admin_user" ADD COLUMN IF NOT EXISTS "branch_id" uuid;');
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_admin_user_branch" ON "admin_user" ("branch_id");',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_admin_user_branch";');
    await queryRunner.query('ALTER TABLE "admin_user" DROP COLUMN IF EXISTS "branch_id";');
  }
}
