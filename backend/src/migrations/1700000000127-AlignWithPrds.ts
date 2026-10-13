import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The prototype follows the Catalog and Pricing PRD and the Devices and Print Routing PRD
 * (2026-10-13):
 *
 * - An item discount covers several products (`product_ids`) and can be paused (`is_active`).
 * - Add-ons are never stopped: their stops are deleted and the column goes.
 * - Every menu record has a permanent Snappfood id from the moment it is made.
 * - An order line keeps the tax rate it was sold at.
 */
const CHANNEL_ID_TABLES: Array<[string, string]> = [
  ['category', 'CATEGORY'],
  ['product', 'PRODUCT'],
  ['product_variant', 'VARIANT'],
  ['option_group', 'OPTION_GROUP'],
  ['option_item', 'OPTION_ITEM'],
];

export class AlignWithPrds1700000000127 implements MigrationInterface {
  name = 'AlignWithPrds1700000000127';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "item_discount" ADD COLUMN IF NOT EXISTS "product_ids" uuid[] NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "item_discount" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`UPDATE "item_discount" SET "product_ids" = ARRAY["product_id"] WHERE "product_id" IS NOT NULL AND "product_ids" = '{}'`);
    await queryRunner.query(`ALTER TABLE "item_discount" DROP COLUMN IF EXISTS "product_id"`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_item_discount_tenant" ON "item_discount" ("tenant_id")`);

    // A line keeps the tax rate it was sold at (fixed when the item was added to the cart).
    await queryRunner.query(`ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "tax_rate" numeric(5,4)`);

    await queryRunner.query(`DELETE FROM "product_availability" WHERE "option_item_id" IS NOT NULL`);
    await queryRunner.query(`ALTER TABLE "product_availability" DROP COLUMN IF EXISTS "option_item_id"`);

    // Every category, product, size, add-on group and add-on gets its Snappfood id the moment it
    // is made, from one sequence per tenant starting at 1001, whatever path creates it (a form, an
    // import, a seed). A per-tenant lock keeps two creates from taking the same number.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION gnext_assign_channel_id() RETURNS trigger AS $fn$
      DECLARE
        next_id integer;
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtext('channel_item_map:' || NEW.tenant_id::text));
        IF EXISTS (
          SELECT 1 FROM channel_item_map
           WHERE tenant_id = NEW.tenant_id AND channel = 'SNAPPFOOD' AND entity_type = TG_ARGV[0] AND entity_id = NEW.id
        ) THEN
          RETURN NEW;
        END IF;
        SELECT COALESCE(MAX(external_id) + 1, 1001) INTO next_id
          FROM channel_item_map WHERE tenant_id = NEW.tenant_id AND channel = 'SNAPPFOOD';
        INSERT INTO channel_item_map (tenant_id, channel, entity_type, entity_id, external_id)
        VALUES (NEW.tenant_id, 'SNAPPFOOD', TG_ARGV[0], NEW.id, next_id);
        RETURN NEW;
      END
      $fn$ LANGUAGE plpgsql
    `);
    for (const [table, type] of CHANNEL_ID_TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_${table}_channel_id" ON "${table}"`);
      await queryRunner.query(
        `CREATE TRIGGER "trg_${table}_channel_id" AFTER INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION gnext_assign_channel_id('${type}')`,
      );
    }
    // Records made before now get theirs, in the order they were made.
    for (const [table, type] of CHANNEL_ID_TABLES) {
      await queryRunner.query(`
        INSERT INTO channel_item_map (tenant_id, channel, entity_type, entity_id, external_id)
        SELECT t.tenant_id, 'SNAPPFOOD', '${type}', t.id,
               COALESCE((SELECT MAX(m.external_id) FROM channel_item_map m WHERE m.tenant_id = t.tenant_id AND m.channel = 'SNAPPFOOD'), 1000)
               + ROW_NUMBER() OVER (PARTITION BY t.tenant_id ORDER BY t.created_at, t.id)
          FROM "${table}" t
         WHERE t.tenant_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM channel_item_map m
              WHERE m.tenant_id = t.tenant_id AND m.channel = 'SNAPPFOOD' AND m.entity_type = '${type}' AND m.entity_id = t.id
           )
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_item" DROP COLUMN IF EXISTS "tax_rate"`);
    for (const [table] of CHANNEL_ID_TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_${table}_channel_id" ON "${table}"`);
    }
    await queryRunner.query(`DROP FUNCTION IF EXISTS gnext_assign_channel_id()`);

    await queryRunner.query(`ALTER TABLE "product_availability" ADD COLUMN IF NOT EXISTS "option_item_id" uuid`);

    await queryRunner.query(`ALTER TABLE "item_discount" ADD COLUMN IF NOT EXISTS "product_id" uuid`);
    await queryRunner.query(`UPDATE "item_discount" SET "product_id" = "product_ids"[1]`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_item_discount_tenant"`);
    await queryRunner.query(`ALTER TABLE "item_discount" DROP COLUMN IF EXISTS "is_active"`);
    await queryRunner.query(`ALTER TABLE "item_discount" DROP COLUMN IF EXISTS "product_ids"`);
  }
}
