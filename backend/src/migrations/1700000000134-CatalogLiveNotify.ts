import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Every catalog change reaches the open tills within 5 seconds, without a reload (C-27,
 * 2026-10-15). The menu tables send the `catalog` change notice of migration 068, and the
 * register re-reads its menu, stops and prices when it hears one. A stop names its branch, so
 * only that branch's tills hear it; a menu row has no branch and reaches the whole chain.
 */
const TABLES = [
  'category',
  'product',
  'product_variant',
  'option_group',
  'option_item',
  'product_option_group',
  'product_availability',
  'item_discount',
  'price_entry',
  'price_group_branch',
];

export class CatalogLiveNotify1700000000134 implements MigrationInterface {
  name = 'CatalogLiveNotify1700000000134';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_live_notify" ON "${table}"`);
      await queryRunner.query(`
        CREATE TRIGGER "trg_live_notify"
        AFTER INSERT OR UPDATE OR DELETE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION gnext_live_notify('catalog')
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_live_notify" ON "${table}"`);
    }
  }
}
