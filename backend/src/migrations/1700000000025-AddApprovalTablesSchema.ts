import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApprovalTablesSchema1700000000025 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "approval_rule" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "action" varchar(64) NOT NULL,
        "threshold_type" varchar(32) NOT NULL DEFAULT 'PERCENTAGE',
        "threshold_value" numeric(19,4) NOT NULL DEFAULT '0.0000',
        "required_steps" int NOT NULL DEFAULT 1,
        "approver_role" varchar(32) NOT NULL DEFAULT 'SUPERVISOR',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_approval_rule" PRIMARY KEY ("id")
      );

      CREATE TABLE IF NOT EXISTS "approval_request" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL,
        "action" varchar(64) NOT NULL,
        "entity_type" varchar(64) NOT NULL,
        "entity_id" uuid,
        "requester_user_id" uuid NOT NULL,
        "command_hash" varchar(128),
        "status" varchar(32) NOT NULL DEFAULT 'PENDING',
        "current_step" int NOT NULL DEFAULT 1,
        "total_steps" int NOT NULL DEFAULT 1,
        "reason" varchar(255),
        "details" jsonb,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_approval_request" PRIMARY KEY ("id")
      );

      ALTER TABLE "approval_request" ADD COLUMN IF NOT EXISTS "command_hash" varchar(128);
      ALTER TABLE "approval_request" ADD COLUMN IF NOT EXISTS "entity_type" varchar(64);
      ALTER TABLE "approval_request" ADD COLUMN IF NOT EXISTS "entity_id" uuid;
      ALTER TABLE "approval_request" ADD COLUMN IF NOT EXISTS "action" varchar(64);
      ALTER TABLE "approval_request" ADD COLUMN IF NOT EXISTS "requester_user_id" uuid;
      ALTER TABLE "approval_request" ADD COLUMN IF NOT EXISTS "current_step" int DEFAULT 1;
      ALTER TABLE "approval_request" ADD COLUMN IF NOT EXISTS "total_steps" int DEFAULT 1;
      ALTER TABLE "approval_request" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP WITH TIME ZONE;

      CREATE TABLE IF NOT EXISTS "approval_decision" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "request_id" uuid NOT NULL,
        "step_number" int NOT NULL DEFAULT 1,
        "approver_user_id" uuid NOT NULL,
        "decision" varchar(32) NOT NULL,
        "pin_attempt_count" int NOT NULL DEFAULT 1,
        "note" varchar(255),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_approval_decision" PRIMARY KEY ("id")
      );

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

      ALTER TABLE "refund_allocation" ADD COLUMN IF NOT EXISTS "refund_id" uuid;
      ALTER TABLE "refund_allocation" ADD COLUMN IF NOT EXISTS "payment_id" uuid;
      ALTER TABLE "refund_allocation" ADD COLUMN IF NOT EXISTS "order_item_id" uuid;
      ALTER TABLE "refund_allocation" ADD COLUMN IF NOT EXISTS "amount" numeric(19, 4);

      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='refund_allocation' AND column_name='payment_method_id') THEN
          ALTER TABLE "refund_allocation" ALTER COLUMN "payment_method_id" DROP NOT NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='refund_allocation' AND column_name='refund_request_id') THEN
          ALTER TABLE "refund_allocation" ALTER COLUMN "refund_request_id" DROP NOT NULL;
          UPDATE "refund_allocation" SET "refund_id" = "refund_request_id" WHERE "refund_id" IS NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='refund_allocation' AND column_name='original_payment_id') THEN
          ALTER TABLE "refund_allocation" ALTER COLUMN "original_payment_id" DROP NOT NULL;
          UPDATE "refund_allocation" SET "payment_id" = "original_payment_id" WHERE "payment_id" IS NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='refund_allocation' AND column_name='amount_refunded') THEN
          ALTER TABLE "refund_allocation" ALTER COLUMN "amount_refunded" DROP NOT NULL;
          UPDATE "refund_allocation" SET "amount" = "amount_refunded" WHERE "amount" IS NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "approval_decision";
      DROP TABLE IF EXISTS "approval_request";
      DROP TABLE IF EXISTS "approval_rule";
    `);
  }
}
