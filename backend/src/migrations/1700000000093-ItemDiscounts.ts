import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Automatic item discounts (V1, 2026-10-03): a dated percent off one product, applied to POS
 * lines by itself. Each order line keeps the percent it was given (`item_discount_percent`,
 * null until the line is priced), so voids, additions and a re-send after reopening price it
 * the same way. The order keeps the item-discount part of its discount total separately, so
 * the one order discount (manual, coupon, customer rate) is never mistaken for it.
 */
export class ItemDiscounts1700000000093 implements MigrationInterface {
  name = 'ItemDiscounts1700000000093';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "item_discount" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "percent" numeric(5,2) NOT NULL,
        "starts_on" date NOT NULL,
        "ends_on" date,
        "note" character varying(160),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_item_discount" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_item_discount_percent" CHECK ("percent" > 0 AND "percent" <= 100),
        CONSTRAINT "CHK_item_discount_dates" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_item_discount_tenant_product" ON "item_discount" ("tenant_id", "product_id")`);
    await queryRunner.query(`ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "item_discount_percent" numeric(5,2)`);
    await queryRunner.query(`ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "item_discount_id" uuid`);
    await queryRunner.query(`ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "item_discount_total" numeric(19,4) NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "item_discount_total" numeric(19,4) NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "item_discount_total"`);
    await queryRunner.query(`ALTER TABLE "order_item" DROP COLUMN IF EXISTS "item_discount_total"`);
    await queryRunner.query(`ALTER TABLE "order_item" DROP COLUMN IF EXISTS "item_discount_id"`);
    await queryRunner.query(`ALTER TABLE "order_item" DROP COLUMN IF EXISTS "item_discount_percent"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "item_discount"`);
  }
}
