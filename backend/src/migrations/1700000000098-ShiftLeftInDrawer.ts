import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a closed shift left in its drawer for the next one. The rest of the count was handed over
 * (to the safe, or the central cash). The next shift on the register is offered this as its float.
 * Null on shifts closed before this was recorded.
 */
export class ShiftLeftInDrawer1700000000098 implements MigrationInterface {
  name = 'ShiftLeftInDrawer1700000000098';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "left_in_drawer" numeric(19,4);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cashier_shift" DROP COLUMN IF EXISTS "left_in_drawer";`);
  }
}
