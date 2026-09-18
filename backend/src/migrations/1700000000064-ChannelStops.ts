import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A stop can be on one channel ("off on Snappfood only, still sold in store"): the existing
 * `product_availability.channel`, NULL meaning everywhere. The one-stop-per-thing key now
 * counts the channel, so an item can carry a Snappfood stop beside an everywhere stop.
 *
 * Nothing wrote the column before; any stray value other than SNAPPFOOD is cleared so the
 * row keeps meaning what it meant (off everywhere).
 */
export class ChannelStops1700000000064 implements MigrationInterface {
  name = 'ChannelStops1700000000064';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "product_availability" SET "channel" = NULL WHERE "channel" IS NOT NULL AND "channel" <> 'SNAPPFOOD'`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_product_availability_target"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_product_availability_target" ON "product_availability" ("tenant_id", "branch_id", COALESCE("product_id", '00000000-0000-0000-0000-000000000000'), COALESCE("variant_id", '00000000-0000-0000-0000-000000000000'), COALESCE("option_item_id", '00000000-0000-0000-0000-000000000000'), COALESCE("channel", ''))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "product_availability" WHERE "channel" IS NOT NULL`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_product_availability_target"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_product_availability_target" ON "product_availability" ("tenant_id", "branch_id", COALESCE("product_id", '00000000-0000-0000-0000-000000000000'), COALESCE("variant_id", '00000000-0000-0000-0000-000000000000'), COALESCE("option_item_id", '00000000-0000-0000-0000-000000000000'))`,
    );
  }
}
