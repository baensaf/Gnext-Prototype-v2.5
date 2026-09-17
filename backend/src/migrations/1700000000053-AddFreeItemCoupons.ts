import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Free-item coupons ("buy 2 burgers, get a drink free"). Existing coupons stay percentage
 * coupons.
 */
export class AddFreeItemCoupons1700000000053 implements MigrationInterface {
  name = 'AddFreeItemCoupons1700000000053';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "coupon"
        ADD COLUMN IF NOT EXISTS "coupon_type" character varying(20) NOT NULL DEFAULT 'PERCENTAGE',
        ADD COLUMN IF NOT EXISTS "buy_product_id" uuid,
        ADD COLUMN IF NOT EXISTS "buy_quantity" integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "reward_product_id" uuid,
        ADD COLUMN IF NOT EXISTS "reward_quantity" integer NOT NULL DEFAULT 1;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "coupon"
        DROP COLUMN IF EXISTS "reward_quantity",
        DROP COLUMN IF EXISTS "reward_product_id",
        DROP COLUMN IF EXISTS "buy_quantity",
        DROP COLUMN IF EXISTS "buy_product_id",
        DROP COLUMN IF EXISTS "coupon_type";
    `);
  }
}
