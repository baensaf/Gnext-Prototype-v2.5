import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A delivery price typed at the register (PM, 2026-10-05): the cashier may charge a delivery
 * order something other than its zone's fee, a far address more or a regular nothing. The order
 * keeps the typed price apart from the fee it charges, so it survives the fee being worked out
 * again and reports can tell a changed price from the zone's own. Null is the zone's fee.
 */
export class ManualDeliveryFee1700000000094 implements MigrationInterface {
  name = 'ManualDeliveryFee1700000000094';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "delivery_fee_manual" numeric(19,4)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "delivery_fee_manual"`);
  }
}
