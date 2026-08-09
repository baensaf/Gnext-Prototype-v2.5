import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDiscountCampaignsSchema1700000000003 implements MigrationInterface {
  name = 'AddDiscountCampaignsSchema1700000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "discount_campaign" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "name" character varying(160) NOT NULL,
        "discount_type" character varying(30) NOT NULL DEFAULT 'PERCENTAGE',
        "percentage" numeric(5, 2),
        "amount" numeric(19, 4),
        "currency_code" character varying(3),
        "priority" integer NOT NULL DEFAULT 30,
        "stacking_group" character varying(40) DEFAULT 'DEFAULT',
        "is_stackable" boolean NOT NULL DEFAULT true,
        "coupon_required" boolean NOT NULL DEFAULT false,
        "usage_limit_total" integer,
        "usage_limit_per_customer" integer,
        "usage_count" integer NOT NULL DEFAULT 0,
        "effective_from" TIMESTAMP WITH TIME ZONE,
        "effective_to" TIMESTAMP WITH TIME ZONE,
        "minimum_subtotal" numeric(19, 4),
        "maximum_discount_amount" numeric(19, 4),
        "reward_product_id" uuid,
        "reward_quantity" numeric(12, 3),
        "funding_source" character varying(80) NOT NULL DEFAULT 'MERCHANT',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" uuid,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_discount_campaign" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_discount_campaign_tenant_active" ON "discount_campaign" ("tenant_id", "is_active");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "discount_scope" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "campaign_id" uuid NOT NULL,
        "scope_type" character varying(32) NOT NULL,
        "scope_id" character varying(128),
        "is_exclusion" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_discount_scope" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_discount_scope_campaign" ON "discount_scope" ("campaign_id");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "discount_usage" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "campaign_id" uuid NOT NULL,
        "coupon_id" uuid,
        "customer_id" uuid,
        "order_id" uuid NOT NULL,
        "amount" numeric(19, 4) NOT NULL DEFAULT '0.0000',
        "currency_code" character varying(3) NOT NULL DEFAULT 'IRR',
        "used_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "reversed_at" TIMESTAMP WITH TIME ZONE,
        "snapshot" jsonb,
        CONSTRAINT "PK_discount_usage" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_discount_usage_campaign_order" UNIQUE ("campaign_id", "order_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_discount_usage_campaign_customer" ON "discount_usage" ("campaign_id", "customer_id");
    `);

    // Ensure coupon table has campaign_id and updated column names
    await queryRunner.query(`
      ALTER TABLE "coupon" ADD COLUMN IF NOT EXISTS "campaign_id" uuid;
      ALTER TABLE "coupon" ADD COLUMN IF NOT EXISTS "max_uses" integer;
      ALTER TABLE "coupon" ADD COLUMN IF NOT EXISTS "uses_count" integer NOT NULL DEFAULT 0;
      ALTER TABLE "coupon" ADD COLUMN IF NOT EXISTS "effective_from" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "coupon" ADD COLUMN IF NOT EXISTS "effective_to" TIMESTAMP WITH TIME ZONE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "discount_usage";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "discount_scope";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "discount_campaign";`);
  }
}
