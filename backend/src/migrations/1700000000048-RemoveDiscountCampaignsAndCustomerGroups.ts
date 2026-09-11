import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Discount campaigns and customer groups are out of the prototype.
 *
 * Campaigns went further than their screen. A one-time coupon was stored as a hidden
 * campaign holding its percentage and limits, with the coupon row only pointing at it, so
 * the coupon's terms move onto the coupon before the campaign tables go. A coupon whose
 * campaign held something other than a percentage has nothing left to give and is switched
 * off rather than deleted. Usage rows are now always a coupon's.
 *
 * `discount` was the pre-campaign table, kept only as a mirror written on campaign create.
 *
 * Customer groups were a label with no behaviour behind them — nothing priced or discounted
 * by group — so the column and the table simply go.
 */
export class RemoveDiscountCampaignsAndCustomerGroups1700000000048 implements MigrationInterface {
  name = 'RemoveDiscountCampaignsAndCustomerGroups1700000000048';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "coupon" ADD COLUMN IF NOT EXISTS "percentage" numeric(5,2);
      ALTER TABLE "coupon" ADD COLUMN IF NOT EXISTS "minimum_subtotal" numeric(19,4);
      ALTER TABLE "coupon" ADD COLUMN IF NOT EXISTS "maximum_discount_amount" numeric(19,4);
    `);
    await queryRunner.query(`
      UPDATE "coupon" c
         SET "percentage" = dc."percentage",
             "minimum_subtotal" = dc."minimum_subtotal",
             "maximum_discount_amount" = dc."maximum_discount_amount"
        FROM "discount_campaign" dc
       WHERE dc."id" = COALESCE(c."campaign_id", c."discount_id");
    `);
    await queryRunner.query(`
      UPDATE "coupon" SET "is_active" = false, "percentage" = 0 WHERE "percentage" IS NULL;
      ALTER TABLE "coupon" ALTER COLUMN "percentage" SET NOT NULL;
      ALTER TABLE "coupon" DROP COLUMN IF EXISTS "campaign_id";
      ALTER TABLE "coupon" DROP COLUMN IF EXISTS "discount_id";
    `);

    await queryRunner.query(`
      DELETE FROM "discount_usage" WHERE "coupon_id" IS NULL;
      ALTER TABLE "discount_usage" DROP CONSTRAINT IF EXISTS "UQ_discount_usage_campaign_order";
      DROP INDEX IF EXISTS "IDX_discount_usage_campaign_customer";
      ALTER TABLE "discount_usage" DROP COLUMN IF EXISTS "campaign_id";
      ALTER TABLE "discount_usage" ALTER COLUMN "coupon_id" SET NOT NULL;
      ALTER TABLE "discount_usage" ADD CONSTRAINT "UQ_discount_usage_coupon_order" UNIQUE ("coupon_id", "order_id");
      CREATE INDEX IF NOT EXISTS "IDX_discount_usage_coupon_customer" ON "discount_usage" ("coupon_id", "customer_id");
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "discount_scope";
      DROP TABLE IF EXISTS "discount_campaign";
      DROP TABLE IF EXISTS "discount";
    `);

    // Adjustments used to call every non-manual discount a campaign. Relabel the two kinds
    // that are left by the names the engine gave them; anything else keeps its history.
    await queryRunner.query(`
      ALTER TABLE "order_adjustment" ALTER COLUMN "source_type" SET DEFAULT 'MANUAL';
      UPDATE "order_adjustment" SET "source_type" = 'COUPON'
       WHERE "source_type" = 'CAMPAIGN' AND "name" LIKE 'Coupon%';
      UPDATE "order_adjustment" SET "source_type" = 'CUSTOMER'
       WHERE "source_type" = 'CAMPAIGN' AND "name" LIKE 'Customer Specific%';
    `);

    await queryRunner.query(`
      ALTER TABLE "customer" DROP COLUMN IF EXISTS "customer_group_id";
      DROP TABLE IF EXISTS "customer_group";
    `);
  }

  /** Brings the structures back empty; the data the up() dropped is not recoverable. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_group" (
        "id" uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "code" varchar(32),
        "discount_id" uuid,
        "price_group_id" uuid,
        "is_active" boolean DEFAULT true NOT NULL,
        "created_by" uuid,
        "updated_at" timestamptz DEFAULT now() NOT NULL,
        "updated_by" uuid,
        "deleted_at" timestamptz,
        "version" integer DEFAULT 1 NOT NULL
      );
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "customer_group_id" uuid;
    `);

    await queryRunner.query(`
      ALTER TABLE "order_adjustment" ALTER COLUMN "source_type" SET DEFAULT 'CAMPAIGN';
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "discount" (
        "id" uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL,
        "name" varchar(160) NOT NULL,
        "type" varchar(32) NOT NULL,
        "value" numeric(15,4) NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "kind" varchar(30) DEFAULT 'MANUAL' NOT NULL,
        "calculation_type" varchar(20) DEFAULT 'PERCENTAGE' NOT NULL,
        "min_order_total" numeric(19,4) DEFAULT 0.0000 NOT NULL,
        "max_discount_amount" numeric(19,4),
        "requires_reason" boolean DEFAULT false NOT NULL,
        "requires_manager_approval" boolean DEFAULT false NOT NULL,
        "applies_to_scope" varchar(20) DEFAULT 'ORDER' NOT NULL,
        "created_by" uuid,
        "updated_at" timestamptz DEFAULT now() NOT NULL,
        "updated_by" uuid,
        "deleted_at" timestamptz,
        "version" integer DEFAULT 1 NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "discount_campaign" (
        "id" uuid DEFAULT gen_random_uuid() NOT NULL,
        "tenant_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL,
        "name" varchar(160) NOT NULL,
        "discount_type" varchar(30) DEFAULT 'PERCENTAGE' NOT NULL,
        "percentage" numeric(5,2),
        "amount" numeric(19,4),
        "currency_code" varchar(3),
        "priority" integer DEFAULT 30 NOT NULL,
        "stacking_group" varchar(40) DEFAULT 'DEFAULT',
        "is_stackable" boolean DEFAULT true NOT NULL,
        "coupon_required" boolean DEFAULT false NOT NULL,
        "usage_limit_total" integer,
        "usage_limit_per_customer" integer,
        "usage_count" integer DEFAULT 0 NOT NULL,
        "effective_from" timestamptz,
        "effective_to" timestamptz,
        "minimum_subtotal" numeric(19,4),
        "maximum_discount_amount" numeric(19,4),
        "reward_product_id" uuid,
        "reward_quantity" numeric(12,3),
        "funding_source" varchar(80) DEFAULT 'MERCHANT' NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "created_by" uuid,
        "updated_at" timestamptz DEFAULT now() NOT NULL,
        "updated_by" uuid,
        "deleted_at" timestamptz,
        "version" integer DEFAULT 1 NOT NULL,
        CONSTRAINT "PK_discount_campaign" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_discount_campaign_tenant_active" ON "discount_campaign" ("tenant_id", "is_active");
      CREATE TABLE IF NOT EXISTS "discount_scope" (
        "id" uuid DEFAULT gen_random_uuid() NOT NULL,
        "tenant_id" uuid NOT NULL,
        "campaign_id" uuid NOT NULL,
        "scope_type" varchar(32) NOT NULL,
        "scope_id" varchar(128),
        "is_exclusion" boolean DEFAULT false NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        CONSTRAINT "PK_discount_scope" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_discount_scope_campaign" ON "discount_scope" ("campaign_id");
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_discount_usage_coupon_customer";
      ALTER TABLE "discount_usage" DROP CONSTRAINT IF EXISTS "UQ_discount_usage_coupon_order";
      ALTER TABLE "discount_usage" ALTER COLUMN "coupon_id" DROP NOT NULL;
      ALTER TABLE "discount_usage" ADD COLUMN IF NOT EXISTS "campaign_id" uuid;
      CREATE INDEX IF NOT EXISTS "IDX_discount_usage_campaign_customer" ON "discount_usage" ("campaign_id", "customer_id");
    `);

    await queryRunner.query(`
      ALTER TABLE "coupon" ADD COLUMN IF NOT EXISTS "campaign_id" uuid;
      ALTER TABLE "coupon" ADD COLUMN IF NOT EXISTS "discount_id" uuid;
      ALTER TABLE "coupon" DROP COLUMN IF EXISTS "maximum_discount_amount";
      ALTER TABLE "coupon" DROP COLUMN IF EXISTS "minimum_subtotal";
      ALTER TABLE "coupon" DROP COLUMN IF EXISTS "percentage";
    `);
  }
}
