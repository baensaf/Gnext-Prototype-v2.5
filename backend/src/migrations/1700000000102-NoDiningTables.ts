import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dine-in without tables.
 *
 * None of the HAMI branches looked at uses a table: every salon sale sits on the same default
 * table. An order can still be eaten in; it is just not seated anywhere. The floors, the tables,
 * their seating history, and the table and guest count on an order go. Only demo data used them.
 */
export class NoDiningTables1700000000102 implements MigrationInterface {
  name = 'NoDiningTables1700000000102';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_header"
        DROP COLUMN IF EXISTS "table_id",
        DROP COLUMN IF EXISTS "table_number",
        DROP COLUMN IF EXISTS "guest_count"
    `);
    for (const table of ['table_occupancy_event', 'table_event', 'table_session', 'dining_table', 'dining_area']) {
      if (await queryRunner.hasTable(table)) {
        await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_agent_data_notify" ON "${table}"`);
        await queryRunner.query(`DROP TABLE "${table}" CASCADE`);
      }
    }
  }

  public async down(): Promise<void> {
    // The floors and tables are gone for good; the demo data they held is not kept.
  }
}
