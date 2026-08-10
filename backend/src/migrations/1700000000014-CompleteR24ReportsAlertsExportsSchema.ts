import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteR24ReportsAlertsExportsSchema1700000000014 implements MigrationInterface {
  name = 'CompleteR24ReportsAlertsExportsSchema1700000000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "placed_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "subtotal" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "discount_total" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "discount_amount" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "tax_total" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "tax_amount" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "total_amount" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "notes" text;
      ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "special_instructions" text;
      ALTER TABLE "order_item" ALTER COLUMN "total_price" DROP NOT NULL;
      ALTER TABLE "payment" ALTER COLUMN "payment_method_id" DROP NOT NULL;
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "user_id" uuid;
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "opened_by" uuid;
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "closed_by" uuid;
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "opening_cash" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "opening_float" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "expected_cash" numeric(19,4);
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "actual_cash" numeric(19,4);
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "short_over" numeric(19,4);
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "over_short_amount" numeric(19,4);
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "closing_note" text;
      ALTER TABLE "cashier_shift" ADD COLUMN IF NOT EXISTS "notes" text;

      ALTER TABLE "terminal" ADD COLUMN IF NOT EXISTS "terminal_type" varchar(20) DEFAULT 'CASHIER';
      ALTER TABLE "terminal" ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "terminal" ADD COLUMN IF NOT EXISTS "created_by" uuid;
      ALTER TABLE "terminal" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
      ALTER TABLE "terminal" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "terminal" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1;

      ALTER TABLE "payment_method" ADD COLUMN IF NOT EXISTS "kind" varchar(30) DEFAULT 'CASH';
      ALTER TABLE "payment_method" ADD COLUMN IF NOT EXISTS "currency_code" char(3);
      ALTER TABLE "payment_method" ADD COLUMN IF NOT EXISTS "requires_reference" boolean DEFAULT false;
      ALTER TABLE "payment_method" ADD COLUMN IF NOT EXISTS "requires_device" boolean DEFAULT false;
      ALTER TABLE "payment_method" ADD COLUMN IF NOT EXISTS "allows_refund" boolean DEFAULT true;
      ALTER TABLE "payment_method" ADD COLUMN IF NOT EXISTS "allows_alternative_refund" boolean DEFAULT false;
      ALTER TABLE "payment_method" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0;
      ALTER TABLE "payment_method" ADD COLUMN IF NOT EXISTS "created_by" uuid;
      ALTER TABLE "payment_method" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
      ALTER TABLE "payment_method" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
      ALTER TABLE "payment_method" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "payment_method" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1;

      ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "parent_id" uuid;
      ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0;
      ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "image_asset_id" uuid;
      ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "created_by" uuid;
      ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
      ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1;

      ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "sku" varchar(64);
      ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "barcode" varchar(64);
      ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "description" text;
      ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "unit_of_measure" varchar(20) DEFAULT 'UNIT';
      ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "image_asset_id" uuid;
      ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "base_price" numeric(19,4) DEFAULT '0.0000';
      ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "created_by" uuid;
      ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
      ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1;

      ALTER TABLE "reason_code" ADD COLUMN IF NOT EXISTS "type" varchar(50);
      ALTER TABLE "reason_code" ALTER COLUMN "type" DROP NOT NULL;
      ALTER TABLE "reason_code" ADD COLUMN IF NOT EXISTS "applies_to" text[] DEFAULT '{}';
      ALTER TABLE "reason_code" ADD COLUMN IF NOT EXISTS "requires_note" boolean DEFAULT false;
      ALTER TABLE "reason_code" ADD COLUMN IF NOT EXISTS "created_by" uuid;
      ALTER TABLE "reason_code" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
      ALTER TABLE "reason_code" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
      ALTER TABLE "reason_code" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "reason_code" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1;

      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "code" varchar(32);
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "first_name" varchar(80);
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "last_name" varchar(80);
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "mobile" varchar(32);
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "national_id" varchar(20);
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true;
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "created_by" uuid;
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1;

      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "name" varchar(64);
      ALTER TABLE "currency" ALTER COLUMN "name" DROP NOT NULL;
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "decimal_precision" smallint DEFAULT 0;
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "rounding_increment" numeric(19,4) DEFAULT '1.0000';
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "is_enabled" boolean DEFAULT true;
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "is_base" boolean DEFAULT false;
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "created_by" uuid;
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "currency" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1;

      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "system" varchar(32);
      ALTER TABLE "integration_log" ALTER COLUMN "system" DROP NOT NULL;
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "provider" varchar(64);
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "event_type" varchar(64);
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "hmac_signature" varchar(128);
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(128);
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "is_duplicate" boolean DEFAULT false;
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "status" varchar(32) DEFAULT 'SUCCESS';
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "request_payload" jsonb;
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "response_payload" jsonb;
      ALTER TABLE "integration_log" ADD COLUMN IF NOT EXISTS "error_message" text;

      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "event_type" varchar(50);
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "actor_type" varchar(30);
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "actor_id" uuid;
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "action" varchar(80);
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "entity_type" varchar(40);
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "entity_id" uuid;
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "branch_id" uuid;
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "correlation_id" uuid;
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "ip" varchar(45);
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "before_data" jsonb;
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "after_data" jsonb;
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "details" jsonb;
      ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "occurred_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW();

      ALTER TABLE "inventory_item" ADD COLUMN IF NOT EXISTS "product_code" varchar(32);
      ALTER TABLE "inventory_item" ADD COLUMN IF NOT EXISTS "product_name" varchar(160);
      ALTER TABLE "inventory_item" ADD COLUMN IF NOT EXISTS "created_by" uuid;
      ALTER TABLE "inventory_item" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
      ALTER TABLE "inventory_item" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "inventory_item" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1;

      ALTER TABLE "inventory_transaction" ADD COLUMN IF NOT EXISTS "created_by" uuid;
      ALTER TABLE "inventory_transaction" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
      ALTER TABLE "inventory_transaction" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
      ALTER TABLE "inventory_transaction" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE "inventory_transaction" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "operational_alert" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NULL,
        "type" varchar(50) NOT NULL,
        "severity" varchar(20) NOT NULL DEFAULT 'WARNING',
        "title" varchar(150) NOT NULL,
        "message" text NOT NULL,
        "acknowledged" boolean NOT NULL DEFAULT false,
        "acknowledged_by" varchar(100) NULL,
        "acknowledged_at" TIMESTAMP WITH TIME ZONE NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_operational_alert" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_operational_alert_tenant_ack"
      ON "operational_alert" ("tenant_id", "acknowledged", "created_at");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "saved_report_view" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NULL,
        "name" varchar(100) NOT NULL,
        "report_code" varchar(60) NOT NULL,
        "filters" jsonb NULL,
        "column_order" jsonb NULL,
        "column_visibility" jsonb NULL,
        "grouping" varchar(50) NULL,
        "sort_by" varchar(50) NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_saved_report_view" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_saved_report_view_tenant_report"
      ON "saved_report_view" ("tenant_id", "report_code");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "report_export_job" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "report_code" varchar(60) NOT NULL,
        "format" varchar(10) NOT NULL DEFAULT 'CSV',
        "filters" jsonb NULL,
        "status" varchar(20) NOT NULL DEFAULT 'COMPLETED',
        "filename" varchar(255) NOT NULL,
        "file_size" integer NULL,
        "file_content_base64" text NULL,
        "error_message" text NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "completed_at" TIMESTAMP WITH TIME ZONE NULL,
        CONSTRAINT "PK_report_export_job" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_report_export_job_tenant"
      ON "report_export_job" ("tenant_id", "created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "report_export_job";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "saved_report_view";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "operational_alert";`);
  }
}
