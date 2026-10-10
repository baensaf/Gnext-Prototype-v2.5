import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Production kitchens and offices are gone (2026-10-10): every branch is a restaurant. A
 * branch of another type is archived, as head office would archive it, so its history stays.
 */
export class OnlyRestaurantBranches1700000000107 implements MigrationInterface {
  name = 'OnlyRestaurantBranches1700000000107';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "branch" SET "deleted_at" = now() WHERE "branch_type" <> 'RESTAURANT' AND "deleted_at" IS NULL`);
  }

  public async down(): Promise<void> {
    // Not restored.
  }
}
