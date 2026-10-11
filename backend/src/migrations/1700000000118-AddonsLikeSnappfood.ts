import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add-ons work the way Snappfood's vendor panel does (2026-10-11): a group has a name, its
 * choices with prices and an at-least / at-most rule, and each product switches choices on or
 * off. What Snappfood does not have goes:
 *
 * - "Ask at the till": a group with a minimum asks, an optional one never does.
 * - Default choices, combo slots (a choice that is a menu item) and the combo product type.
 * - Linking a group to a category. The links it made stay, as ordinary links on each product.
 * - A product's own order of its groups: groups show in the order they were made.
 * - "At most 0 = no limit": the maximum becomes the number of choices.
 * - Changing add-on prices in bulk. Such prices are already copied into the add-ons.
 */
export class AddonsLikeSnappfood1700000000118 implements MigrationInterface {
  name = 'AddonsLikeSnappfood1700000000118';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "option_group" DROP COLUMN IF EXISTS "prompt_at_pos"`);
    await queryRunner.query(
      `UPDATE "option_group" g SET "max_selection" = GREATEST(g."min_selection", 1, (
         SELECT COUNT(*) FROM "option_item" i WHERE i."option_group_id" = g."id" AND i."deleted_at" IS NULL
       )) WHERE g."max_selection" = 0`,
    );

    await queryRunner.query(`ALTER TABLE "option_item" DROP COLUMN IF EXISTS "is_default"`);
    await queryRunner.query(`ALTER TABLE "option_item" DROP COLUMN IF EXISTS "product_id"`);
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN IF EXISTS "product_type"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "category_option_group"`);
    await queryRunner.query(`ALTER TABLE "product_option_group" DROP COLUMN IF EXISTS "from_category_id"`);
    await queryRunner.query(`ALTER TABLE "product_option_group" DROP COLUMN IF EXISTS "sort_order"`);

    await queryRunner.query(`DELETE FROM "price_entry" WHERE "modifier_option_id" IS NOT NULL`);
    await queryRunner.query(`DELETE FROM "price_bulk_job" WHERE "params"->>'target' = 'ADDONS'`);
  }

  public async down(): Promise<void> {
    // Not restored: the features are gone.
  }
}
