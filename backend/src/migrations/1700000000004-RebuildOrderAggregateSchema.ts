import { MigrationInterface, QueryRunner } from 'typeorm';

export class RebuildOrderAggregateSchema1700000000004 implements MigrationInterface {
  name = 'RebuildOrderAggregateSchema1700000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create order_adjustment table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_adjustment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "order_item_id" uuid,
        "type" character varying(24) NOT NULL DEFAULT 'DISCOUNT',
        "source_type" character varying(32) NOT NULL DEFAULT 'CAMPAIGN',
        "source_id" uuid,
        "code" character varying(32),
        "name" character varying(160) NOT NULL,
        "amount" numeric(19, 4) NOT NULL DEFAULT '0.0000',
        "funding_source" character varying(80),
        "calculation_snapshot" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_adjustment" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_adjustment_order" ON "order_adjustment" ("order_id");
    `);

    // 2. Create order_note table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_note" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "order_item_id" uuid,
        "note_type" character varying(20) NOT NULL DEFAULT 'GENERAL',
        "text" text NOT NULL,
        "source" character varying(32) NOT NULL DEFAULT 'STAFF',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        CONSTRAINT "PK_order_note" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_note_order" ON "order_note" ("order_id");
    `);

    // 3. Create order_link table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_link" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "from_order_id" uuid NOT NULL,
        "to_order_id" uuid NOT NULL,
        "link_type" character varying(32) NOT NULL,
        "details" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_link" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_link_from_to" ON "order_link" ("from_order_id", "to_order_id");
    `);

    // 4. Create order_state_event table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_state_event" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "from_state" character varying(30),
        "to_state" character varying(30) NOT NULL,
        "action" character varying(40) NOT NULL,
        "reason_code_id" uuid,
        "reason_text" text,
        "approval_request_id" uuid,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "occurred_by" uuid,
        "snapshot" jsonb,
        CONSTRAINT "PK_order_state_event" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_state_event_order_time" ON "order_state_event" ("order_id", "occurred_at");
    `);

    // 5. Create order_sequence table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_sequence" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "prefix" character varying(32) NOT NULL,
        "last_value" integer NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_sequence" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_order_sequence_tenant_prefix" UNIQUE ("tenant_id", "prefix")
      );
    `);

    // 6. Update order_header columns for full specification alignment
    await queryRunner.query(`
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "shift_id" uuid;
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "channel" character varying(32) NOT NULL DEFAULT 'POS';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "order_type" character varying(30) NOT NULL DEFAULT 'DINE_IN';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "state" character varying(30) NOT NULL DEFAULT 'DRAFT';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "quote_version" character varying(40) NOT NULL DEFAULT '1';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "customer_address_id" uuid;
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "table_id" uuid;
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "table_number" character varying(20);
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "guest_count" integer;
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "price_group_id" uuid;
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "discount_id" uuid;
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "coupon_code" character varying(32);
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "currency_code" character varying(3) NOT NULL DEFAULT 'IRR';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "business_date" character varying(10);
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "subtotal" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "subtotal_amount" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "modifier_total" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "packaging_total" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "delivery_fee" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "discount_total" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "discount_amount" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "tax_total" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "tax_amount" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "grand_total" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "total_amount" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "paid_total" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "paid_amount" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "refunded_total" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "outstanding_total" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "due_amount" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "status" character varying(30) NOT NULL DEFAULT 'DRAFT';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "fulfillment_status" character varying(30) NOT NULL DEFAULT 'PENDING';
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "notes" text;
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "cancellation_reason_code_id" uuid;
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "parent_order_id" uuid;
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "created_by" uuid;
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_header_tenant_state" ON "order_header" ("tenant_id", "state");
    `);

    // 7. Update order_item columns
    await queryRunner.query(`
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "line_number" integer NOT NULL DEFAULT 1;
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "product_code" character varying(32);
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "variant_id" uuid;
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "variant_name" character varying(160);
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "base_total" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "modifier_total" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "packaging_total" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "line_total" numeric(19,4) NOT NULL DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "state" character varying(16) NOT NULL DEFAULT 'ACTIVE';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "replaces_item_id" uuid;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_sequence";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_state_event";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_link";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_note";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_adjustment";`);
  }
}
