import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Refunds are one full refund of a completed order, back by the methods it was paid with
 * (2026-10-10), and coupons are gone.
 *
 * - Partial refunds, per-line refunds, paying back another way (card-to-card, club credit) and
 *   the per-method refund policy flags are removed, with the tables and columns only they used.
 *   Refunds already made stay as they were.
 * - Coupons, their redemption log and the coupon code on an order are dropped. Order adjustment
 *   rows that came from a coupon keep their record of what was taken off.
 */
export class RefundSimplifiedCouponsOut1700000000112 implements MigrationInterface {
  name = 'RefundSimplifiedCouponsOut1700000000112';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "refund_item" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refund_request" CASCADE`);
    for (const column of ['is_alternative_method', 'reference', 'device_id']) {
      await queryRunner.query(`ALTER TABLE "refund" DROP COLUMN IF EXISTS "${column}"`);
    }
    for (const column of ['refund_request_id', 'order_item_id']) {
      await queryRunner.query(`ALTER TABLE "refund_allocation" DROP COLUMN IF EXISTS "${column}"`);
    }
    for (const column of ['allows_refund', 'allows_alternative_refund']) {
      await queryRunner.query(`ALTER TABLE "payment_method" DROP COLUMN IF EXISTS "${column}"`);
    }

    await queryRunner.query(`DROP TABLE IF EXISTS "discount_usage" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "coupon" CASCADE`);
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "coupon_code"`);
  }

  public async down(): Promise<void> {
    // Not restored: the refund variants and coupons are gone for good.
  }
}
