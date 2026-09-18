import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Branch price lists keep their prices in `price_entry` (price_group_id set, no branch,
 * channel, order type or add-on), dated like every other price. The old per-list overrides
 * in `price_group_item` were written by the Price Book page and read by nothing; they move
 * across as list prices and the table goes.
 *
 * No branch was on a list before this (there was no way to assign one), so moving the
 * overrides changes no price anyone is charged.
 */
export class BranchPriceLists1700000000062 implements MigrationInterface {
  name = 'BranchPriceLists1700000000062';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "price_entry" ("tenant_id", "product_id", "price_group_id", "price_type", "currency_code", "amount", "effective_from")
      SELECT pg."tenant_id", i."product_id", i."price_group_id", 'LIST', pg."currency_code", i."override_price", COALESCE(i."updated_at", now())
      FROM "price_group_item" i
      JOIN "price_group" pg ON pg."id" = i."price_group_id"
      WHERE i."override_price" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "price_entry" e
          WHERE e."price_group_id" = i."price_group_id" AND e."product_id" = i."product_id"
            AND e."variant_id" IS NULL AND e."branch_id" IS NULL AND e."channel" IS NULL
            AND e."order_type" IS NULL AND e."modifier_option_id" IS NULL AND e."effective_to" IS NULL
        )
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "price_group_item"`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_price_entry_tenant_list" ON "price_entry" ("tenant_id", "price_group_id") WHERE "price_group_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_price_entry_tenant_list"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "price_group_item" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid,
        "price_group_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "override_price" numeric(19, 4),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_price_group_item" UNIQUE ("price_group_id", "product_id")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "price_group_item" ("tenant_id", "price_group_id", "product_id", "override_price")
      SELECT DISTINCT ON (e."price_group_id", e."product_id") e."tenant_id", e."price_group_id", e."product_id", e."amount"
      FROM "price_entry" e
      WHERE e."price_group_id" IS NOT NULL AND e."variant_id" IS NULL AND e."branch_id" IS NULL
        AND e."channel" IS NULL AND e."order_type" IS NULL AND e."modifier_option_id" IS NULL AND e."effective_to" IS NULL
      ORDER BY e."price_group_id", e."product_id", e."effective_from" DESC
      ON CONFLICT DO NOTHING
    `);
  }
}
