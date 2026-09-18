import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What Snappfood's vendor panel lets a restaurant say about its menu, so the same menu can be
 * described here:
 *
 * - an off-sale stop can name one variant, or one add-on, not only a whole product;
 * - a day can have several opening shifts (lunch and dinner), not one open-close pair;
 * - an attached add-on group can leave some of its items out for one product;
 * - a product carries a packaging price, a per-order cap and extra photos;
 * - a branch can set how many of an item it has today (daily_stock).
 */
export class SnappfoodCatalogParity1700000000061 implements MigrationInterface {
  name = 'SnappfoodCatalogParity1700000000061';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product_availability" ALTER COLUMN "product_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "product_availability" ADD COLUMN IF NOT EXISTS "variant_id" uuid`);
    await queryRunner.query(`ALTER TABLE "product_availability" ADD COLUMN IF NOT EXISTS "option_item_id" uuid`);
    // One stop per thing per branch, where the thing is now a product, a variant of it or
    // an add-on. The old key (tenant, branch, product) refused a variant stop beside the
    // product's own row. A null branch stays distinct, as before: those are chain-wide.
    await queryRunner.query(`ALTER TABLE "product_availability" DROP CONSTRAINT IF EXISTS "UQ_product_availability"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_product_availability_target" ON "product_availability" ("tenant_id", "branch_id", COALESCE("product_id", '00000000-0000-0000-0000-000000000000'), COALESCE("variant_id", '00000000-0000-0000-0000-000000000000'), COALESCE("option_item_id", '00000000-0000-0000-0000-000000000000'))`,
    );

    await queryRunner.query(
      `ALTER TABLE "branch_operating_hour" DROP CONSTRAINT IF EXISTS "uq_branch_operating_hour_tenant_branch_day"`,
    );

    await queryRunner.query(
      `ALTER TABLE "product_option_group" ADD COLUMN IF NOT EXISTS "excluded_item_ids" jsonb NOT NULL DEFAULT '[]'`,
    );

    await queryRunner.query(
      `ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "container_price" numeric(19,4) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "max_per_order" integer`);
    await queryRunner.query(
      `ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "gallery_asset_ids" jsonb NOT NULL DEFAULT '[]'`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "daily_stock" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "variant_id" uuid,
        "business_date" date NOT NULL,
        "quantity" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_daily_stock_line" ON "daily_stock" ("tenant_id", "branch_id", "business_date", "product_id", COALESCE("variant_id", '00000000-0000-0000-0000-000000000000'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "daily_stock"`);
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN IF EXISTS "gallery_asset_ids"`);
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN IF EXISTS "max_per_order"`);
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN IF EXISTS "container_price"`);
    await queryRunner.query(`ALTER TABLE "product_option_group" DROP COLUMN IF EXISTS "excluded_item_ids"`);
    await queryRunner.query(`DELETE FROM "product_availability" WHERE "product_id" IS NULL OR "variant_id" IS NOT NULL`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_product_availability_target"`);
    await queryRunner.query(
      `ALTER TABLE "product_availability" ADD CONSTRAINT "UQ_product_availability" UNIQUE ("tenant_id", "branch_id", "product_id")`,
    );
    await queryRunner.query(`ALTER TABLE "product_availability" DROP COLUMN IF EXISTS "option_item_id"`);
    await queryRunner.query(`ALTER TABLE "product_availability" DROP COLUMN IF EXISTS "variant_id"`);
    await queryRunner.query(`ALTER TABLE "product_availability" ALTER COLUMN "product_id" SET NOT NULL`);
  }
}
