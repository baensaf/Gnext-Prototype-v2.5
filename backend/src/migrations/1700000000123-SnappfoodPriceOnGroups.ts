import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Snappfood prices belong to the price group (2026-10-12). Until now an item could carry one
 * chain-wide fixed Snappfood price (a `price_entry` with channel SNAPPFOOD and no group, branch
 * or add-on). Now each price group has its own Snappfood price per item, in the same table with
 * the group's id and channel SNAPPFOOD.
 *
 * Each chain-wide fixed price in force is copied into EVERY price group that has no Snappfood
 * price for the item yet, then the chain-wide rows are deleted, so a branch on any group keeps
 * the price it had. A chain with no price group loses the fixed prices: its branches follow
 * base price plus the markup.
 */
export class SnappfoodPriceOnGroups1700000000123 implements MigrationInterface {
  name = 'SnappfoodPriceOnGroups1700000000123';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "price_entry" ("tenant_id", "product_id", "variant_id", "price_group_id", "channel", "price_type", "currency_code", "amount", "effective_from")
      SELECT f."tenant_id", f."product_id", f."variant_id", g."id", 'SNAPPFOOD', 'CHANNEL', f."currency_code", f."amount", f."effective_from"
        FROM "price_entry" f
        JOIN "price_group" g ON g."tenant_id" = f."tenant_id" AND g."deleted_at" IS NULL
       WHERE f."channel" = 'SNAPPFOOD' AND f."price_group_id" IS NULL AND f."branch_id" IS NULL
         AND f."modifier_option_id" IS NULL AND f."order_type" IS NULL
         AND (f."effective_to" IS NULL OR f."effective_to" > now())
         AND NOT EXISTS (
           SELECT 1 FROM "price_entry" x
            WHERE x."tenant_id" = f."tenant_id" AND x."price_group_id" = g."id" AND x."channel" = 'SNAPPFOOD'
              AND x."product_id" = f."product_id" AND x."variant_id" IS NOT DISTINCT FROM f."variant_id"
              AND x."branch_id" IS NULL AND x."modifier_option_id" IS NULL AND x."order_type" IS NULL
              AND (x."effective_to" IS NULL OR x."effective_to" > now())
         )
    `);
    await queryRunner.query(`
      DELETE FROM "price_entry"
       WHERE "channel" = 'SNAPPFOOD' AND "price_group_id" IS NULL AND "branch_id" IS NULL
         AND "modifier_option_id" IS NULL AND "order_type" IS NULL
    `);
  }

  public async down(): Promise<void> {
    // The chain-wide fixed prices are not coming back.
  }
}
