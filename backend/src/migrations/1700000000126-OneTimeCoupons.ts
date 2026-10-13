import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-time coupons, back for V2 (2026-10-13): head office makes a batch of codes for a
 * campaign, each code works once at the till, for a percent off the order or one free item.
 * The coupons removed on 2026-10-10 (migration 112) were shared codes with usage counts.
 */
export class OneTimeCoupons1700000000126 implements MigrationInterface {
  name = 'OneTimeCoupons1700000000126';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "coupon_batch" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "reward_type" varchar(16) NOT NULL,
        "percent" numeric(5,2),
        "max_discount" numeric(19,4),
        "reward_product_id" uuid,
        "min_subtotal" numeric(19,4),
        "valid_from" varchar(10),
        "valid_to" varchar(10),
        "is_active" boolean NOT NULL DEFAULT true,
        "code_count" int NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_coupon_batch_tenant" ON "coupon_batch" ("tenant_id", "created_at")`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "coupon" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "batch_id" uuid NOT NULL REFERENCES "coupon_batch"("id") ON DELETE CASCADE,
        "code" varchar(16) NOT NULL,
        "used_at" TIMESTAMP WITH TIME ZONE,
        "used_order_id" uuid,
        "used_branch_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_coupon_tenant_code" ON "coupon" ("tenant_id", "code")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_coupon_batch" ON "coupon" ("tenant_id", "batch_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "coupon"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "coupon_batch"`);
  }
}
