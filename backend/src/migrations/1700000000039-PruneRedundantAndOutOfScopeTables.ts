import { MigrationInterface, QueryRunner } from 'typeorm';

export class PruneRedundantAndOutOfScopeTables1700000000039 implements MigrationInterface {
  name = 'PruneRedundantAndOutOfScopeTables1700000000039';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop redundant write-only table_event
    await queryRunner.query(`DROP TABLE IF EXISTS "table_event" CASCADE;`);

    // 2. Drop superseded customer_credit_transaction (superseded by credit_entry)
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_credit_transaction" CASCADE;`);

    // 3. Drop superseded cash drawer tables (superseded by cashier_shift and cash_movement)
    await queryRunner.query(`DROP TABLE IF EXISTS "cash_drawer_transaction" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cash_drawer_shift" CASCADE;`);

    // 4. Drop out-of-scope inventory tables
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_transaction" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_item" CASCADE;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Irreversible table cleanup for prototype simplification
  }
}
