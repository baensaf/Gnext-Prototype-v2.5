import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairCustomerCreditSchema1700000000006 implements MigrationInterface {
  name = 'RepairCustomerCreditSchema1700000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create credit_account table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "credit_account" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "currency_code" character varying(3) NOT NULL DEFAULT 'IRR',
        "mode" character varying(16) NOT NULL DEFAULT 'FINITE',
        "credit_limit" numeric(19, 4),
        "current_balance" numeric(19, 4) NOT NULL DEFAULT '0.0000',
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "is_blocked" boolean NOT NULL DEFAULT false,
        "policy_note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" uuid,
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_credit_account" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_credit_account_tenant_customer_currency" UNIQUE ("tenant_id", "customer_id", "currency_code")
      );
    `);

    await queryRunner.query(`
      ALTER TABLE "credit_account"
        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE NULL;

      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'idempotency_record' AND column_name = 'idempotency_key') THEN
          ALTER TABLE "idempotency_record" ALTER COLUMN "idempotency_key" DROP NOT NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'idempotency_record' AND column_name = 'response_code') THEN
          ALTER TABLE "idempotency_record" ALTER COLUMN "response_code" DROP NOT NULL;
        END IF;
      END $$;

      ALTER TABLE "idempotency_record"
        ADD COLUMN IF NOT EXISTS "scope" character varying(80),
        ADD COLUMN IF NOT EXISTS "key" character varying(160),
        ADD COLUMN IF NOT EXISTS "status" character varying(20) DEFAULT 'PENDING',
        ADD COLUMN IF NOT EXISTS "response_status" integer,
        ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP WITH TIME ZONE;

      CREATE INDEX IF NOT EXISTS "IDX_credit_account_customer_status"
      ON "credit_account" ("tenant_id", "customer_id", "status");
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_idempotency_record_tenant_scope_key"
      ON "idempotency_record" ("tenant_id", "scope", "key");
    `);

    // 2. Create credit_entry table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "credit_entry" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "entry_type" character varying(30) NOT NULL,
        "amount" numeric(19, 4) NOT NULL,
        "currency_code" character varying(3) NOT NULL DEFAULT 'IRR',
        "order_id" uuid,
        "payment_id" uuid,
        "related_entry_id" uuid,
        "reason_code_id" uuid,
        "reason_text" text,
        "reference" character varying(160),
        "business_date" character varying(10) NOT NULL,
        "posted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "posted_by" uuid,
        "balance_after" numeric(19, 4) NOT NULL DEFAULT '0.0000',
        CONSTRAINT "PK_credit_entry" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_credit_entry_account_posted"
      ON "credit_entry" ("account_id", "posted_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "credit_entry";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "credit_account";`);
  }
}
