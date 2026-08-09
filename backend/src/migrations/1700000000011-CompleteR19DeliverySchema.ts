import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteR19DeliverySchema1700000000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. delivery_zone table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "delivery_zone" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL,
        "name" varchar(160) NOT NULL,
        "polygon" jsonb NULL,
        "postal_prefixes" text[] NULL,
        "fee" numeric(19, 4) NOT NULL DEFAULT 0.0000,
        "currency_code" varchar(3) NOT NULL DEFAULT 'IRR',
        "estimated_minutes" integer NOT NULL DEFAULT 30,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMP WITH TIME ZONE NULL,
        CONSTRAINT "PK_delivery_zone" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_delivery_zone_code" UNIQUE ("tenant_id", "branch_id", "code")
      );
    `);

    // 2. Add R19 columns to courier table if not exists
    await queryRunner.query(`
      ALTER TABLE "courier"
        ADD COLUMN IF NOT EXISTS "compensation_per_delivery" numeric(19, 4) NOT NULL DEFAULT 0.0000,
        ADD COLUMN IF NOT EXISTS "currency_code" varchar(3) NOT NULL DEFAULT 'IRR',
        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE NULL;
    `);

    // 3. courier_attendance table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "courier_attendance" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "courier_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "date" varchar(10) NOT NULL,
        "status" varchar(30) NOT NULL DEFAULT 'CHECKED_IN',
        "availability_status" varchar(30) NOT NULL DEFAULT 'AVAILABLE',
        "checked_in_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "checked_out_at" TIMESTAMP WITH TIME ZONE NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_courier_attendance" PRIMARY KEY ("id")
      );
    `);

    // 4. courier_terminal_assignment table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "courier_terminal_assignment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "courier_id" uuid NOT NULL,
        "terminal_id" uuid NOT NULL,
        "assigned_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "unassigned_at" TIMESTAMP WITH TIME ZONE NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_courier_terminal_assignment" PRIMARY KEY ("id")
      );
    `);

    // 5. delivery table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "delivery" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "zone_id" uuid NULL,
        "courier_id" uuid NULL,
        "state" varchar(30) NOT NULL DEFAULT 'UNASSIGNED',
        "fee" numeric(19, 4) NOT NULL DEFAULT 0.0000,
        "currency_code" varchar(3) NOT NULL DEFAULT 'IRR',
        "address_snapshot" jsonb NULL,
        "assigned_at" TIMESTAMP WITH TIME ZONE NULL,
        "picked_up_at" TIMESTAMP WITH TIME ZONE NULL,
        "delivered_at" TIMESTAMP WITH TIME ZONE NULL,
        "cash_expected" numeric(19, 4) NOT NULL DEFAULT 0.0000,
        "mobile_pos_expected" numeric(19, 4) NOT NULL DEFAULT 0.0000,
        "compensation_amount" numeric(19, 4) NOT NULL DEFAULT 0.0000,
        "failure_reason" text NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_delivery" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_delivery_order_id" UNIQUE ("order_id")
      );
    `);

    // 6. delivery_event table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "delivery_event" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "delivery_id" uuid NOT NULL,
        "from_state" varchar(30) NOT NULL,
        "to_state" varchar(30) NOT NULL,
        "reason" text NULL,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "occurred_by" uuid NULL,
        "details" jsonb NULL,
        CONSTRAINT "PK_delivery_event" PRIMARY KEY ("id")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "delivery_event";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "delivery";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "courier_terminal_assignment";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "courier_attendance";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "delivery_zone";`);
  }
}
