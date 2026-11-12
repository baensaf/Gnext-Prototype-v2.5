import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shared coupon codes (2026-11-12): one code head office chooses, typed by many customers,
 * like HamiClub's 10%, 15% and 20% codes. A batch says which kind it is and its limits; each
 * order a shared code goes on is a coupon_use row.
 */
export class SharedCouponCodes1700000000145 implements MigrationInterface {
  name = 'SharedCouponCodes1700000000145';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "coupon_batch" ADD COLUMN IF NOT EXISTS "kind" varchar(12) NOT NULL DEFAULT 'ONE_TIME'`);
    await queryRunner.query(`ALTER TABLE "coupon_batch" ADD COLUMN IF NOT EXISTS "uses_per_customer" int`);
    await queryRunner.query(`ALTER TABLE "coupon_batch" ADD COLUMN IF NOT EXISTS "uses_per_customer_per_day" int`);
    await queryRunner.query(`ALTER TABLE "coupon_batch" ADD COLUMN IF NOT EXISTS "max_uses" int`);
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "coupon_use" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "tenant_id" uuid NOT NULL,
         "coupon_id" uuid NOT NULL,
         "batch_id" uuid NOT NULL,
         "order_id" uuid NOT NULL,
         "customer_id" uuid NOT NULL,
         "branch_id" uuid,
         "business_date" varchar(10) NOT NULL,
         "used_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_coupon_use" PRIMARY KEY ("id")
       )`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_coupon_use_order" ON "coupon_use" ("coupon_id", "order_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_coupon_use_customer_day" ON "coupon_use" ("coupon_id", "customer_id", "business_date")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "coupon_use"`);
    await queryRunner.query(`ALTER TABLE "coupon_batch" DROP COLUMN IF EXISTS "max_uses"`);
    await queryRunner.query(`ALTER TABLE "coupon_batch" DROP COLUMN IF EXISTS "uses_per_customer_per_day"`);
    await queryRunner.query(`ALTER TABLE "coupon_batch" DROP COLUMN IF EXISTS "uses_per_customer"`);
    await queryRunner.query(`ALTER TABLE "coupon_batch" DROP COLUMN IF EXISTS "kind"`);
  }
}
