import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Iran Burger's counter rings an item straight through: a burger is tapped and it is on the
 * order, nothing asked in between. The seed no longer carries the add-on groups (extras,
 * "without", the combo drink) it attached to every burger, sandwich, mini and combo, but a
 * database seeded before this still holds them, and a product they hang off opens the
 * register's options dialog before the line is added. They come off the menu here.
 *
 * The product links are removed and the groups and their items archived, the same soft
 * delete the modifiers screen performs. Nothing is erased: an order that sold an add-on
 * keeps its own copy of the group name, item name and price in `order_item_option`, so the
 * history and its receipts read the same afterwards.
 *
 * Only the seeded demo tenant is touched. Add-on groups remain a supported feature, and one
 * created after this runs is left alone.
 */
export class ClearDemoMenuModifiers1700000000068 implements MigrationInterface {
  name = 'ClearDemoMenuModifiers1700000000068';

  /** The tenant the seed creates; see DEFAULT_TENANT_ID in src/seed.ts. */
  private readonly demoTenantId = 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "product_option_group" WHERE "tenant_id" = $1`, [this.demoTenantId]);
    await queryRunner.query(
      `UPDATE "option_item" SET "deleted_at" = now() WHERE "tenant_id" = $1 AND "deleted_at" IS NULL`,
      [this.demoTenantId],
    );
    await queryRunner.query(
      `UPDATE "option_group" SET "deleted_at" = now() WHERE "tenant_id" = $1 AND "deleted_at" IS NULL`,
      [this.demoTenantId],
    );
  }

  /**
   * The archived groups come back to the modifiers screen. Which products they hung off is
   * recorded nowhere once the links are gone, so those attachments are not restored; they
   * are made again from the product's own screen.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "option_group" SET "deleted_at" = NULL WHERE "tenant_id" = $1`, [this.demoTenantId]);
    await queryRunner.query(`UPDATE "option_item" SET "deleted_at" = NULL WHERE "tenant_id" = $1`, [this.demoTenantId]);
  }
}
