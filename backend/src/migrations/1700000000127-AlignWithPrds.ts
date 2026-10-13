import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The prototype follows the Catalog and Pricing PRD and the Devices and Print Routing PRD
 * (2026-10-13):
 *
 * - An item discount covers several products (`product_ids`) and can be paused (`is_active`).
 * - Add-ons are never stopped: their stops are deleted and the column goes.
 */
export class AlignWithPrds1700000000127 implements MigrationInterface {
  name = 'AlignWithPrds1700000000127';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "item_discount" ADD COLUMN IF NOT EXISTS "product_ids" uuid[] NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "item_discount" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`UPDATE "item_discount" SET "product_ids" = ARRAY["product_id"] WHERE "product_id" IS NOT NULL AND "product_ids" = '{}'`);
    await queryRunner.query(`ALTER TABLE "item_discount" DROP COLUMN IF EXISTS "product_id"`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_item_discount_tenant" ON "item_discount" ("tenant_id")`);

    await queryRunner.query(`DELETE FROM "product_availability" WHERE "option_item_id" IS NOT NULL`);
    await queryRunner.query(`ALTER TABLE "product_availability" DROP COLUMN IF EXISTS "option_item_id"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product_availability" ADD COLUMN IF NOT EXISTS "option_item_id" uuid`);

    await queryRunner.query(`ALTER TABLE "item_discount" ADD COLUMN IF NOT EXISTS "product_id" uuid`);
    await queryRunner.query(`UPDATE "item_discount" SET "product_id" = "product_ids"[1]`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_item_discount_tenant"`);
    await queryRunner.query(`ALTER TABLE "item_discount" DROP COLUMN IF EXISTS "is_active"`);
    await queryRunner.query(`ALTER TABLE "item_discount" DROP COLUMN IF EXISTS "product_ids"`);
  }
}
