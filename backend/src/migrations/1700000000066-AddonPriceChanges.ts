import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pricing leftovers after branch price lists and dated changes:
 *
 * - An add-on's dated price (a price change on add-ons) is a `price_entry` row with
 *   `modifier_option_id` and no product, so `product_id` may be empty.
 * - `branch.price_group_id` was never read: a branch's list is its `price_group_branch` row.
 *   Any value set on a branch without such a row becomes one, then the column goes.
 */
export class AddonPriceChanges1700000000066 implements MigrationInterface {
  name = 'AddonPriceChanges1700000000066';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "price_entry" ALTER COLUMN "product_id" DROP NOT NULL`);
    await queryRunner.query(`
      INSERT INTO "price_group_branch" ("tenant_id", "price_group_id", "branch_id")
      SELECT b."tenant_id", b."price_group_id", b."id"
        FROM "branch" b
       WHERE b."price_group_id" IS NOT NULL
         AND EXISTS (SELECT 1 FROM "price_group" g WHERE g."id" = b."price_group_id")
         AND NOT EXISTS (SELECT 1 FROM "price_group_branch" pgb WHERE pgb."tenant_id" = b."tenant_id" AND pgb."branch_id" = b."id")
    `);
    await queryRunner.query(`ALTER TABLE "branch" DROP COLUMN IF EXISTS "price_group_id"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "branch" ADD COLUMN IF NOT EXISTS "price_group_id" uuid`);
    await queryRunner.query(`
      UPDATE "branch" b SET "price_group_id" = pgb."price_group_id"
        FROM "price_group_branch" pgb
       WHERE pgb."tenant_id" = b."tenant_id" AND pgb."branch_id" = b."id"
    `);
    await queryRunner.query(`DELETE FROM "price_entry" WHERE "product_id" IS NULL`);
    await queryRunner.query(`ALTER TABLE "price_entry" ALTER COLUMN "product_id" SET NOT NULL`);
  }
}
