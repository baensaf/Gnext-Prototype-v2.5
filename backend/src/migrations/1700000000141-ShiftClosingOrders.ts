import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A closed shift's report keeps its order figures as they stood at the close (P-29). Shifts
 * already closed stay empty and are added up from their orders, as before.
 */
export class ShiftClosingOrders1700000000141 implements MigrationInterface {
  name = 'ShiftClosingOrders1700000000141';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "closing_orders" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cashier_shift" DROP COLUMN IF EXISTS "closing_orders"`);
  }
}
