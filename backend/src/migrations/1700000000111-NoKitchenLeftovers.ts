import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Leftovers of features that are gone (2026-10-10).
 *
 * - Orders no longer pass through PREPARING or READY: nothing in Gnext moves them there (kitchen
 *   tickets are printed). An order in either state is simply sent and confirmed, the state it
 *   would be in without a kitchen screen. History rows keep the states they recorded.
 * - Every branch is a RESTAURANT; the commissary and office types are gone.
 * - The unused Menu tables (menu, menu_category, menu_product) are dropped.
 * - The Tara Pay payment kind is gone. A method of that kind stays for the payments and refunds
 *   that point at it, as an inactive "other" method.
 */
export class NoKitchenLeftovers1700000000111 implements MigrationInterface {
  name = 'NoKitchenLeftovers1700000000111';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "order_header" SET "state" = 'CONFIRMED' WHERE "state" IN ('PREPARING', 'READY')`);
    await queryRunner.query(`UPDATE "order_header" SET "status" = 'CONFIRMED' WHERE "status" IN ('PREPARING', 'KITCHEN_PREPARING', 'READY')`);

    await queryRunner.query(`UPDATE "branch" SET "branch_type" = 'RESTAURANT' WHERE "branch_type" <> 'RESTAURANT'`);

    for (const table of ['menu_product', 'menu_category', 'menu']) {
      if (await queryRunner.hasTable(table)) {
        await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_agent_data_notify" ON "${table}"`);
        await queryRunner.query(`DROP TABLE "${table}" CASCADE`);
      }
    }

    await queryRunner.query(`UPDATE "payment_method" SET "kind" = 'OTHER', "is_active" = false WHERE "kind" = 'TARA_PAY'`);
  }

  public async down(): Promise<void> {
    // Not restored: the states, branch types, menu tables and payment kind are gone for good.
  }
}
