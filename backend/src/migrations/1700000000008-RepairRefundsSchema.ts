import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairRefundsSchema1700000000008 implements MigrationInterface {
  name = 'RepairRefundsSchema1700000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create refund table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refund" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "refund_number" character varying(40) NOT NULL,
        "status" character varying(30) NOT NULL DEFAULT 'PENDING',
        "method_id" uuid NOT NULL,
        "method_kind" character varying(30) NOT NULL DEFAULT 'CASH',
        "amount" numeric(19, 4) NOT NULL,
        "currency_code" character varying(3) NOT NULL DEFAULT 'IRR',
        "reason_code_id" uuid,
        "reason_text" text,
        "reference" character varying(160),
        "is_alternative_method" boolean NOT NULL DEFAULT false,
        "approval_request_id" uuid,
        "device_id" uuid,
        "settlement_account_id" uuid,
        "shift_id" uuid,
        "original_refund_id" uuid,
        "failure_code" character varying(80),
        "failure_message" text,
        "initiated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "posted_at" TIMESTAMP WITH TIME ZONE,
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_refund" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_refund_number" UNIQUE ("tenant_id", "refund_number")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_refund_order_status"
      ON "refund" ("tenant_id", "order_id", "status");
    `);

    // 2. Ensure refund_allocation table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refund_allocation" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "refund_id" uuid NOT NULL,
        "payment_id" uuid NOT NULL,
        "order_item_id" uuid,
        "amount" numeric(19, 4) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refund_allocation" PRIMARY KEY ("id")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "refund_allocation";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refund";`);
  }
}
