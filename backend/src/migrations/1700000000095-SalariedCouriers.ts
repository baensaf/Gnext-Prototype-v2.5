import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Iran Burger pays its couriers a salary, not by the trip (PM, 2026-10-05), so the pay rules are
 * gone from the screens and every rate goes to zero: a trip that closes from now on earns the
 * rider nothing beyond a tip, and settlements stop netting pay out of the cash handed in.
 * Settled batches keep the pay they were closed with; unsettled trips are cleared so the next
 * settlement does not hold back money no one is owed. The engine stays, so this is data only.
 */
export class SalariedCouriers1700000000095 implements MigrationInterface {
  name = 'SalariedCouriers1700000000095';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "courier" SET "pay_mode" = 'FLAT', "compensation_per_delivery" = 0`);
    await queryRunner.query(`UPDATE "delivery_zone" SET "courier_pay" = NULL`);
    // Without a stored policy every branch falls back to FLAT, which now pays nothing.
    await queryRunner.query(`DELETE FROM "tenant_setting" WHERE "key" = 'COURIER_PAY'`);
    await queryRunner.query(
      `UPDATE "delivery_assignment" SET "compensation_amount" = "tip_amount" WHERE "is_settled" = false`,
    );
    await queryRunner.query(`
      UPDATE "delivery" d SET "compensation_amount" = 0
       WHERE NOT EXISTS (
         SELECT 1 FROM "delivery_assignment" a
          WHERE a."order_id" = d."order_id" AND a."is_settled" = true
       )`);
  }

  public async down(): Promise<void> {
    // The old rates are not kept anywhere, so there is nothing to put back.
  }
}
