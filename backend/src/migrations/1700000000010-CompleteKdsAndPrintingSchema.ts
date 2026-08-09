import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteKdsAndPrintingSchema1700000000010 implements MigrationInterface {
  name = 'CompleteKdsAndPrintingSchema1700000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. KitchenStation columns
    await queryRunner.query(`
      ALTER TABLE "kitchen_station"
      ADD COLUMN IF NOT EXISTS "tenant_id" uuid,
      ADD COLUMN IF NOT EXISTS "code" character varying(32),
      ADD COLUMN IF NOT EXISTS "target_minutes" integer NOT NULL DEFAULT 10,
      ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE;
    `);

    // 2. KdsScreen table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kds_screen" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "terminal_id" uuid,
        "code" character varying(32) NOT NULL,
        "name" character varying(160) NOT NULL,
        "station_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_kds_screen" PRIMARY KEY ("id")
      );
    `);

    // 3. KdsRoutingRule table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kds_routing_rule" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "station_id" uuid NOT NULL,
        "product_id" uuid,
        "category_id" uuid,
        "priority" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_kds_routing_rule" PRIMARY KEY ("id")
      );
    `);

    // 4. KitchenTicket (KdsTicket) columns & index
    await queryRunner.query(`
      ALTER TABLE "kitchen_ticket"
      ADD COLUMN IF NOT EXISTS "tenant_id" uuid,
      ADD COLUMN IF NOT EXISTS "branch_id" uuid,
      ADD COLUMN IF NOT EXISTS "state" character varying(32) NOT NULL DEFAULT 'NEW',
      ADD COLUMN IF NOT EXISTS "priority" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "is_aggregator" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "ready_at" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_kds_ticket_order_station"
      ON "kitchen_ticket" ("tenant_id", "order_id", "station_id");
    `);

    // 5. KitchenTicketItem (KdsTicketItem) columns & index
    await queryRunner.query(`
      ALTER TABLE "kitchen_ticket_item"
      ADD COLUMN IF NOT EXISTS "tenant_id" uuid,
      ADD COLUMN IF NOT EXISTS "product_name" character varying(160),
      ADD COLUMN IF NOT EXISTS "state" character varying(32) NOT NULL DEFAULT 'NEW',
      ADD COLUMN IF NOT EXISTS "special_instructions" text,
      ADD COLUMN IF NOT EXISTS "options_summary" text,
      ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_kds_ticket_item_ticket_order_item"
      ON "kitchen_ticket_item" ("tenant_id", "ticket_id", "order_item_id");
    `);

    // 6. KdsEvent table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kds_event" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "ticket_id" uuid NOT NULL,
        "from_state" character varying(32),
        "to_state" character varying(32) NOT NULL,
        "action" character varying(64) NOT NULL,
        "occurred_by" uuid,
        "details" jsonb,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kds_event" PRIMARY KEY ("id")
      );
    `);

    // 7. Printer table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "printer" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "name" character varying(160) NOT NULL,
        "printer_type" character varying(32) NOT NULL DEFAULT 'THERMAL_RECEIPT',
        "simulated_address" character varying(128),
        "paper_width_mm" integer NOT NULL DEFAULT 80,
        "is_active" boolean NOT NULL DEFAULT true,
        "fallback_printer_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_printer" PRIMARY KEY ("id")
      );
    `);

    // 8. PrinterGroup table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "printer_group" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "name" character varying(160) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_printer_group" PRIMARY KEY ("id")
      );
    `);

    // 9. PrinterGroupMember table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "printer_group_member" (
        "group_id" uuid NOT NULL,
        "printer_id" uuid NOT NULL,
        "priority" integer NOT NULL DEFAULT 0,
        "copies" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_printer_group_member" PRIMARY KEY ("group_id", "printer_id")
      );
    `);

    // 10. PrintRoute table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "print_route" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "document_type" character varying(64) NOT NULL,
        "product_id" uuid,
        "category_id" uuid,
        "station_id" uuid,
        "printer_group_id" uuid NOT NULL,
        "priority" integer NOT NULL DEFAULT 0,
        "copies" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_print_route" PRIMARY KEY ("id")
      );
    `);

    // 11. PrintJob table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "print_job" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "document_type" character varying(64) NOT NULL,
        "entity_type" character varying(64) NOT NULL,
        "entity_id" uuid NOT NULL,
        "printer_id" uuid,
        "status" character varying(32) NOT NULL DEFAULT 'QUEUED',
        "copies" integer NOT NULL DEFAULT 1,
        "rendered_html" text NOT NULL,
        "is_reprint" boolean NOT NULL DEFAULT false,
        "reason" text,
        "created_by" uuid,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_print_job" PRIMARY KEY ("id")
      );
    `);

    // 12. PrintAttempt table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "print_attempt" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "job_id" uuid NOT NULL,
        "printer_id" uuid NOT NULL,
        "attempt_no" integer NOT NULL DEFAULT 1,
        "status" character varying(32) NOT NULL DEFAULT 'SUCCESS',
        "scenario_id" character varying(64),
        "error_code" character varying(64),
        "error_message" text,
        "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "finished_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_print_attempt" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_print_attempt_job_attempt"
      ON "print_attempt" ("job_id", "attempt_no");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_print_attempt_job_attempt";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "print_attempt";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "print_job";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "print_route";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "printer_group_member";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "printer_group";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "printer";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kds_event";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_kds_ticket_item_ticket_order_item";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_kds_ticket_order_station";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kds_routing_rule";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kds_screen";`);
  }
}
