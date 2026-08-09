import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairCashierShiftsSchema1700000000005 implements MigrationInterface {
  name = 'RepairCashierShiftsSchema1700000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create cashier_shift table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cashier_shift" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "terminal_id" uuid NOT NULL,
        "opened_by" uuid,
        "closed_by" uuid,
        "shift_number" character varying(32) NOT NULL,
        "state" character varying(30) NOT NULL DEFAULT 'OPEN',
        "status" character varying(30) NOT NULL DEFAULT 'OPEN',
        "currency_code" character varying(3) NOT NULL DEFAULT 'IRR',
        "business_date" character varying(10) NOT NULL,
        "opened_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "closed_at" TIMESTAMP WITH TIME ZONE,
        "opening_cash" numeric(19, 4) NOT NULL DEFAULT '0.0000',
        "expected_cash" numeric(19, 4),
        "actual_cash" numeric(19, 4),
        "short_over" numeric(19, 4),
        "closing_note" text,
        "approval_request_id" uuid,
        "preview_version" character varying(40),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_cashier_shift" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cashier_shift_active_terminal"
      ON "cashier_shift" ("tenant_id", "terminal_id", "currency_code")
      WHERE "state" IN ('OPEN', 'CLOSING_REVIEW');
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_cashier_shift_branch_date_state"
      ON "cashier_shift" ("tenant_id", "branch_id", "business_date", "state");
    `);

    // 2. Create cash_movement table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cash_movement" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "shift_id" uuid NOT NULL,
        "type" character varying(30) NOT NULL,
        "amount" numeric(19, 4) NOT NULL,
        "currency_code" character varying(3) NOT NULL DEFAULT 'IRR',
        "payment_id" uuid,
        "refund_id" uuid,
        "reason_code_id" uuid,
        "reason_text" text,
        "reference" character varying(160),
        "posted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "posted_by" uuid,
        CONSTRAINT "PK_cash_movement" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_cash_movement_shift"
      ON "cash_movement" ("shift_id");
    `);

    // 3. Create business_day_close table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "business_day_close" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "business_date" character varying(10) NOT NULL,
        "currency_code" character varying(3) NOT NULL DEFAULT 'IRR',
        "status" character varying(30) NOT NULL DEFAULT 'CLOSED',
        "totals" jsonb,
        "closed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "closed_by" uuid,
        "reopened_at" TIMESTAMP WITH TIME ZONE,
        "reopened_by" uuid,
        "approval_request_id" uuid,
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_business_day_close" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_business_day_close_branch_date" UNIQUE ("tenant_id", "branch_id", "business_date", "currency_code")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "business_day_close";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cash_movement";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cashier_shift";`);
  }
}
