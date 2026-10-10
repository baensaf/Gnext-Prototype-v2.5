import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Couriers are salaried, so nothing in Gnext prices a trip any more.
 *
 * Migration 095 zeroed the pay and the screens went with it; the engine behind them stayed so
 * the tests kept passing. It goes now: each courier's pay rule and rate, the zone's courier
 * rate, the pay a delivery, an attempt and a settlement carried, and the COURIER_PAY setting.
 * A settlement is now simply what the courier collected and hands back.
 */
export class NoCourierPayEngine1700000000103 implements MigrationInterface {
  name = 'NoCourierPayEngine1700000000103';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "courier" DROP COLUMN IF EXISTS "pay_mode", DROP COLUMN IF EXISTS "compensation_per_delivery"`);
    await queryRunner.query(`ALTER TABLE "delivery" DROP COLUMN IF EXISTS "compensation_amount", DROP COLUMN IF EXISTS "compensation_basis"`);
    await queryRunner.query(`ALTER TABLE "delivery_assignment" DROP COLUMN IF EXISTS "compensation_amount"`);
    await queryRunner.query(`ALTER TABLE "delivery_zone" DROP COLUMN IF EXISTS "courier_pay"`);
    await queryRunner.query(`ALTER TABLE "courier_settlement" DROP COLUMN IF EXISTS "total_compensation_amount"`);
    await queryRunner.query(`DELETE FROM "tenant_setting" WHERE "key" = 'COURIER_PAY'`);
  }

  public async down(): Promise<void> {
    // Courier pay is gone for good; it was all zero since migration 095.
  }
}
