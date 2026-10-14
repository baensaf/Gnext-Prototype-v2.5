import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Friends and family" was a long name for a customer's own rate at a branch; it is the
 * personal discount now (2026-10-14). Renames the till's reason where the tenant kept the
 * seeded name; the code stays FRIENDS_FAMILY.
 */
export class PersonalDiscountName1700000000132 implements MigrationInterface {
  name = 'PersonalDiscountName1700000000132';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "reason_code" SET "name" = 'تخفیف اختصاصی' WHERE "code" = 'FRIENDS_FAMILY' AND "name" = 'دوستان و آشنایان'`,
    );
  }

  public async down(): Promise<void> {
    // The old name is not restored.
  }
}
