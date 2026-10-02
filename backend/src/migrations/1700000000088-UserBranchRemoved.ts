import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Archiving a branch takes it away from its staff (Branch Management spec, B4, decided
 * 2026-10-03). The account keeps its `branch_id`, so its history still says where it worked,
 * and `branch_removed_at` records that the assignment was taken away. Such an account signs in
 * with no branch: it reaches no branch's data and is never treated as head office. Restoring
 * the branch does not clear it; head office assigns the person again.
 */
export class UserBranchRemoved1700000000088 implements MigrationInterface {
  name = 'UserBranchRemoved1700000000088';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "admin_user" ADD COLUMN IF NOT EXISTS "branch_removed_at" timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "admin_user" DROP COLUMN IF EXISTS "branch_removed_at"`);
  }
}
