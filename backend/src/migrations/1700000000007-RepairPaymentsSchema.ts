import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairPaymentsSchema1700000000007 implements MigrationInterface {
  name = 'RepairPaymentsSchema1700000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ensure settlement_account table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "settlement_account" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(40) NOT NULL,
        "name" character varying(120) NOT NULL,
        "account_type" character varying(40) NOT NULL,
        "masked_identifier" character varying(80),
        "currency_code" character varying(3) NOT NULL DEFAULT 'IRR',
        "is_company_owned" boolean NOT NULL DEFAULT true,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_settlement_account" PRIMARY KEY ("id")
      );
    `);

    // 2. Ensure payment_device table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_device" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid,
        "code" character varying(40) NOT NULL,
        "name" character varying(120) NOT NULL,
        "kind" character varying(30) NOT NULL DEFAULT 'POS',
        "ownership" character varying(30) NOT NULL DEFAULT 'COMPANY',
        "settlement_account_id" uuid,
        "device_identifier" character varying(120),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_device" PRIMARY KEY ("id")
      );
    `);

    // 3. Create or alter payment table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "payment_number" character varying(40) NOT NULL,
        "method_id" uuid NOT NULL,
        "method_kind" character varying(30) NOT NULL DEFAULT 'CASH',
        "status" character varying(30) NOT NULL DEFAULT 'PENDING',
        "amount" numeric(19, 4) NOT NULL,
        "currency_code" character varying(3) NOT NULL DEFAULT 'IRR',
        "device_id" uuid,
        "settlement_account_id" uuid,
        "reference" character varying(160),
        "receipt_number" character varying(80),
        "shift_id" uuid,
        "business_date" character varying(10) NOT NULL DEFAULT '2026-08-09',
        "idempotency_key" character varying(160),
        "original_payment_id" uuid,
        "correction_group_id" uuid,
        "failure_code" character varying(80),
        "failure_message" text,
        "initiated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "posted_at" TIMESTAMP WITH TIME ZONE,
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_payment" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_payment_number" UNIQUE ("tenant_id", "payment_number")
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_idempotency"
      ON "payment" ("tenant_id", "idempotency_key")
      WHERE "idempotency_key" IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payment_order_status"
      ON "payment" ("tenant_id", "order_id", "status");
    `);

    // 4. Create payment_allocation table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_allocation" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "payment_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "amount" numeric(19, 4) NOT NULL,
        "currency_code" character varying(3) NOT NULL DEFAULT 'IRR',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_allocation" PRIMARY KEY ("id")
      );
    `);

    // 5. Create payment_attempt table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_attempt" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "payment_id" uuid NOT NULL,
        "attempt_no" integer NOT NULL DEFAULT 1,
        "adapter" character varying(40) NOT NULL DEFAULT 'SYNCHRONOUS',
        "scenario_id" character varying(40),
        "status" character varying(30) NOT NULL DEFAULT 'PENDING',
        "request_snapshot" jsonb,
        "response_snapshot" jsonb,
        "external_reference" character varying(160),
        "error_code" character varying(80),
        "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "finished_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_payment_attempt" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_payment_attempt_no" UNIQUE ("payment_id", "attempt_no")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_attempt";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_allocation";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_device";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "settlement_account";`);
  }
}
