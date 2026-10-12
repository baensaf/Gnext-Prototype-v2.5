import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Item discounts get a scope (2026-10-12): all price groups or a chosen list of them, and a
 * channel: in store (till and kiosk), Snappfood, or both. Every discount that exists keeps
 * working as it did: all groups, in store.
 */
export class ItemDiscountScope1700000000124 implements MigrationInterface {
  name = 'ItemDiscountScope1700000000124';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "item_discount" ADD COLUMN IF NOT EXISTS "all_groups" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE "item_discount" ADD COLUMN IF NOT EXISTS "price_group_ids" uuid[] NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "item_discount" ADD COLUMN IF NOT EXISTS "applies_to" varchar(12) NOT NULL DEFAULT 'IN_STORE'`);
    await queryRunner.query(`ALTER TABLE "item_discount" DROP CONSTRAINT IF EXISTS "CHK_item_discount_applies_to"`);
    await queryRunner.query(`ALTER TABLE "item_discount" ADD CONSTRAINT "CHK_item_discount_applies_to" CHECK ("applies_to" IN ('IN_STORE', 'SNAPPFOOD', 'BOTH'))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "item_discount" DROP CONSTRAINT IF EXISTS "CHK_item_discount_applies_to"`);
    await queryRunner.query(`ALTER TABLE "item_discount" DROP COLUMN IF EXISTS "applies_to"`);
    await queryRunner.query(`ALTER TABLE "item_discount" DROP COLUMN IF EXISTS "price_group_ids"`);
    await queryRunner.query(`ALTER TABLE "item_discount" DROP COLUMN IF EXISTS "all_groups"`);
  }
}
