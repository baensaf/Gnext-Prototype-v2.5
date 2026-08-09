import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialV15Schema1700000000000 implements MigrationInterface {
  name = 'InitialV15Schema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 0. Ensure uuid extension exists
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // 1. Core Tenant & Auth
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tenant" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "code" varchar(32) NOT NULL UNIQUE,
        "name" varchar(160) NOT NULL,
        "base_currency" char(3) NOT NULL DEFAULT 'IRR',
        "default_locale" varchar(5) NOT NULL DEFAULT 'fa',
        "time_zone" varchar(64) NOT NULL DEFAULT 'Asia/Tehran',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "version" integer NOT NULL DEFAULT 1
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_user" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "username" varchar(80) NOT NULL,
        "display_name" varchar(160) NOT NULL,
        "password_hash" text NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "role" varchar(32) NOT NULL DEFAULT 'CASHIER',
        "pin_hash" text,
        "preferred_locale" varchar(5) NOT NULL DEFAULT 'fa',
        "last_login_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" uuid,
        "version" integer NOT NULL DEFAULT 1
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "token" varchar(128) NOT NULL UNIQUE,
        "user_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid,
        "terminal_id" uuid,
        "ip_address" varchar(45),
        "user_agent" text,
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "revoked_at" timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_event" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid,
        "user_id" uuid,
        "event_type" varchar(64) NOT NULL,
        "entity_name" varchar(64),
        "entity_id" uuid,
        "action" varchar(32) NOT NULL,
        "correlation_id" varchar(64),
        "payload" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "outbox_event" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "event_type" varchar(64) NOT NULL,
        "aggregate_type" varchar(64) NOT NULL,
        "aggregate_id" uuid NOT NULL,
        "payload" jsonb NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'PENDING',
        "retry_count" integer NOT NULL DEFAULT 0,
        "error_detail" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "processed_at" timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "idempotency_record" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "idempotency_key" varchar(128) NOT NULL UNIQUE,
        "request_hash" varchar(64) NOT NULL,
        "response_code" integer NOT NULL,
        "response_body" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    // 2. Organization & Operations Setup
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "branch" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL,
        "name" varchar(160) NOT NULL,
        "phone" varchar(32),
        "address" text,
        "time_zone" varchar(64),
        "price_group_id" uuid,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" uuid,
        "deleted_at" timestamptz,
        "version" integer NOT NULL DEFAULT 1
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "terminal" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL,
        "name" varchar(160) NOT NULL,
        "device_type" varchar(32) NOT NULL DEFAULT 'POS_STATION',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tenant_setting" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "key" varchar(64) NOT NULL,
        "value" jsonb NOT NULL,
        "description" text,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_tenant_setting_key" UNIQUE ("tenant_id", "key")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "currency" (
        "code" char(3) PRIMARY KEY,
        "symbol" varchar(8) NOT NULL,
        "name" varchar(64) NOT NULL,
        "decimal_places" integer NOT NULL DEFAULT 0
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_method" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL,
        "name" varchar(64) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "reason_code" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL,
        "name" varchar(80) NOT NULL,
        "type" varchar(32) NOT NULL,
        "requires_approval" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    // 3. Catalog & Menus
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "category" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL,
        "name" varchar(160) NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "category_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL,
        "name" varchar(160) NOT NULL,
        "base_price" numeric(15, 4) NOT NULL DEFAULT 0,
        "tax_rate" numeric(5, 4) NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "option_group" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL,
        "name" varchar(160) NOT NULL,
        "min_select" integer NOT NULL DEFAULT 0,
        "max_select" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "option_item" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "option_group_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL,
        "name" varchar(160) NOT NULL,
        "price_override" numeric(15, 4) NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_option_group" (
        "product_id" uuid NOT NULL,
        "option_group_id" uuid NOT NULL,
        PRIMARY KEY ("product_id", "option_group_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "price_group" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "price_group_item" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "price_group_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "price" numeric(15, 4) NOT NULL,
        CONSTRAINT "UQ_price_group_item" UNIQUE ("price_group_id", "product_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "menu" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "menu_category" (
        "menu_id" uuid NOT NULL,
        "category_id" uuid NOT NULL,
        PRIMARY KEY ("menu_id", "category_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "menu_product" (
        "menu_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        PRIMARY KEY ("menu_id", "product_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_availability" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "is_available" boolean NOT NULL DEFAULT true,
        "reason" text,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_product_availability" UNIQUE ("tenant_id", "branch_id", "product_id")
      );
    `);

    // 4. Discounts & CRM
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "discount" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL,
        "name" varchar(160) NOT NULL,
        "type" varchar(32) NOT NULL,
        "value" numeric(15, 4) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "coupon" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "discount_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL UNIQUE,
        "max_uses" integer NOT NULL DEFAULT 1,
        "used_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_group" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "customer_group_id" uuid,
        "full_name" varchar(160) NOT NULL,
        "phone" varchar(32),
        "email" varchar(160),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_credit_account" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL UNIQUE,
        "credit_limit" numeric(15, 4) NOT NULL DEFAULT 0,
        "balance" numeric(15, 4) NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_credit_transaction" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "account_id" uuid NOT NULL,
        "amount" numeric(15, 4) NOT NULL,
        "type" varchar(32) NOT NULL,
        "reference_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    // 5. Orders & Financial Operations
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_header" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "terminal_id" uuid,
        "user_id" uuid,
        "customer_id" uuid,
        "order_number" varchar(32) NOT NULL,
        "order_type" varchar(32) NOT NULL DEFAULT 'DINE_IN',
        "status" varchar(32) NOT NULL DEFAULT 'SUBMITTED',
        "subtotal" numeric(15, 4) NOT NULL DEFAULT 0,
        "tax_total" numeric(15, 4) NOT NULL DEFAULT 0,
        "discount_total" numeric(15, 4) NOT NULL DEFAULT 0,
        "grand_total" numeric(15, 4) NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "version" integer NOT NULL DEFAULT 1
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_item" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "product_name" varchar(160) NOT NULL,
        "unit_price" numeric(15, 4) NOT NULL,
        "quantity" numeric(15, 4) NOT NULL DEFAULT 1,
        "total_price" numeric(15, 4) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_item_option" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "order_item_id" uuid NOT NULL,
        "option_item_id" uuid NOT NULL,
        "option_name" varchar(160) NOT NULL,
        "unit_price" numeric(15, 4) NOT NULL DEFAULT 0
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "payment_method_id" uuid NOT NULL,
        "amount" numeric(15, 4) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'COMPLETED',
        "reference_code" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cash_drawer_shift" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "opening_balance" numeric(15, 4) NOT NULL,
        "closing_balance" numeric(15, 4),
        "status" varchar(32) NOT NULL DEFAULT 'OPEN',
        "opened_at" timestamptz NOT NULL DEFAULT now(),
        "closed_at" timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cash_drawer_transaction" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "shift_id" uuid NOT NULL,
        "type" varchar(32) NOT NULL,
        "amount" numeric(15, 4) NOT NULL,
        "note" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    // 6. Kitchen (KDS), Dine-In, Delivery & Refunds
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kitchen_station" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "branch_id" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kitchen_ticket" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL,
        "station_id" uuid NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'PENDING',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kitchen_ticket_item" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "ticket_id" uuid NOT NULL,
        "order_item_id" uuid NOT NULL,
        "quantity" numeric(15, 4) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'PENDING'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dining_area" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "branch_id" uuid NOT NULL,
        "name" varchar(80) NOT NULL
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dining_table" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "area_id" uuid NOT NULL,
        "number" varchar(16) NOT NULL,
        "capacity" integer NOT NULL DEFAULT 4,
        "status" varchar(32) NOT NULL DEFAULT 'VACANT'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "table_session" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "table_id" uuid NOT NULL,
        "opened_at" timestamptz NOT NULL DEFAULT now(),
        "closed_at" timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "courier" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "phone" varchar(32) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "delivery_assignment" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL,
        "courier_id" uuid NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'ASSIGNED',
        "assigned_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refund_request" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "amount" numeric(15, 4) NOT NULL,
        "reason_code_id" uuid,
        "status" varchar(32) NOT NULL DEFAULT 'PENDING',
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    // 7. V5 Preview Tables (Annotated in schema)
    // -- V5 Preview Table: Inventory stock management (isolated from v1.5 availability/KDS)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inventory_item" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "product_code" varchar(32),
        "product_name" varchar(160),
        "quantity_on_hand" numeric(15, 4) NOT NULL DEFAULT 0,
        "reorder_level" numeric(15, 4) NOT NULL DEFAULT 0,
        "unit_of_measure" varchar(16) NOT NULL DEFAULT 'UNIT',
        "last_counted_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    // -- V5 Preview Table: Inventory stock transactions (isolated from v1.5 orders/financials)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inventory_transaction" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "inventory_item_id" uuid NOT NULL,
        "transaction_type" varchar(32) NOT NULL,
        "quantity_delta" numeric(15, 4) NOT NULL,
        "reason_code_id" uuid,
        "note" text,
        "recorded_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    // 8. Integrations & Import Tools
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "integration_log" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "system" varchar(64) NOT NULL,
        "payload" jsonb,
        "status" varchar(32) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "import_job" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "entity_type" varchar(32) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'PENDING',
        "total_rows" integer NOT NULL DEFAULT 0,
        "processed_rows" integer NOT NULL DEFAULT 0,
        "error_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "import_job" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "integration_log" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_transaction" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_item" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refund_request" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "delivery_assignment" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "courier" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "table_session" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dining_table" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dining_area" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kitchen_ticket_item" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kitchen_ticket" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kitchen_station" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cash_drawer_transaction" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cash_drawer_shift" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_item_option" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_item" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_header" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_credit_transaction" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_credit_account" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_group" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "coupon" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "discount" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_availability" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "menu_product" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "menu_category" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "menu" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "price_group_item" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "price_group" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_option_group" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "option_item" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "option_group" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "category" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "reason_code" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_method" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "currency" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_setting" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "terminal" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "branch" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "idempotency_record" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "outbox_event" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_event" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "session" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_user" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant" CASCADE;`);
  }
}
