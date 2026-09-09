import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A chain does not only run restaurants. Production kitchens and back-office sites are
 * real locations that carry staff, hours and reporting, but never ring up a sale, and
 * until now every branch was shaped like a storefront with no way to say otherwise.
 * Existing rows default to RESTAURANT, which is what they all were.
 */
export class AddBranchType1700000000045 implements MigrationInterface {
  name = 'AddBranchType1700000000045';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "branch" ADD COLUMN IF NOT EXISTS "branch_type" character varying(20) NOT NULL DEFAULT 'RESTAURANT';`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_branch_branch_type" ON "branch" ("branch_type");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_branch_branch_type";`);
    await queryRunner.query(`ALTER TABLE "branch" DROP COLUMN IF EXISTS "branch_type";`);
  }
}
