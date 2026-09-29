import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add-on groups set up the way Toast does (audit 2026-09-29):
 * - "Required" is a minimum above zero and nothing else. A group marked required with a
 *   minimum of 0 already behaved as a minimum of 1; it now says so, and editing it no longer
 *   turns it optional.
 * - `prompt_at_pos`: whether an optional group opens the choices dialog when the item is rung
 *   up. Existing groups keep asking, as they did.
 * - A group can be put on a category; every product in it gets the group, and a product added
 *   to the category later gets it too. The product's link remembers the category it came
 *   from, so taking the group off the category takes those links away and leaves direct ones.
 */
export class AddonGroupSetup1700000000084 implements MigrationInterface {
  name = 'AddonGroupSetup1700000000084';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "option_group" SET "min_selection" = 1 WHERE "is_required" = true AND "min_selection" = 0`);
    await queryRunner.query(`UPDATE "option_group" SET "is_required" = ("min_selection" > 0)`);
    await queryRunner.query(`ALTER TABLE "option_group" ADD COLUMN IF NOT EXISTS "prompt_at_pos" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE "product_option_group" ADD COLUMN IF NOT EXISTS "from_category_id" uuid`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "category_option_group" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "category_id" uuid NOT NULL,
        "option_group_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_category_option_group" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_category_option_group" UNIQUE ("tenant_id", "category_id", "option_group_id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "category_option_group"`);
    await queryRunner.query(`ALTER TABLE "product_option_group" DROP COLUMN IF EXISTS "from_category_id"`);
    await queryRunner.query(`ALTER TABLE "option_group" DROP COLUMN IF EXISTS "prompt_at_pos"`);
  }
}
