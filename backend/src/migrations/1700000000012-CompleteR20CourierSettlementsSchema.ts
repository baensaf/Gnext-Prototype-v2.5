import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteR20CourierSettlementsSchema1700000000012 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. courier_settlement table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "courier_settlement" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NULL,
        "courier_id" uuid NOT NULL,
        "settlement_number" varchar(64) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'DRAFT',
        "settlement_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "expected_cash_amount" numeric(12, 2) NOT NULL DEFAULT 0.00,
        "actual_cash_amount" numeric(12, 2) NOT NULL DEFAULT 0.00,
        "cash_discrepancy_amount" numeric(12, 2) NOT NULL DEFAULT 0.00,
        "expected_pos_amount" numeric(12, 2) NOT NULL DEFAULT 0.00,
        "actual_pos_amount" numeric(12, 2) NOT NULL DEFAULT 0.00,
        "pos_discrepancy_amount" numeric(12, 2) NOT NULL DEFAULT 0.00,
        "total_compensation_amount" numeric(12, 2) NOT NULL DEFAULT 0.00,
        "total_adjustment_amount" numeric(12, 2) NOT NULL DEFAULT 0.00,
        "net_settlement_amount" numeric(12, 2) NOT NULL DEFAULT 0.00,
        "notes" text NULL,
        "created_by_user_id" uuid NULL,
        "reviewed_by_user_id" uuid NULL,
        "closed_by_user_id" uuid NULL,
        "approval_request_id" uuid NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "closed_at" TIMESTAMP WITH TIME ZONE NULL,
        CONSTRAINT "PK_courier_settlement" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_courier_settlement_number" UNIQUE ("settlement_number")
      );
    `);

    // 2. courier_settlement_line table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "courier_settlement_line" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "settlement_id" uuid NOT NULL,
        "delivery_assignment_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "order_number" varchar(64) NOT NULL,
        "delivery_status" varchar(32) NOT NULL,
        "payment_method_code" varchar(32) NOT NULL DEFAULT 'CASH',
        "expected_cash" numeric(12, 2) NOT NULL DEFAULT 0.00,
        "actual_cash" numeric(12, 2) NOT NULL DEFAULT 0.00,
        "expected_pos" numeric(12, 2) NOT NULL DEFAULT 0.00,
        "actual_pos" numeric(12, 2) NOT NULL DEFAULT 0.00,
        "receipt_verified" boolean NOT NULL DEFAULT true,
        "delivery_fee_amount" numeric(12, 2) NOT NULL DEFAULT 0.00,
        "commission_amount" numeric(12, 2) NOT NULL DEFAULT 0.00,
        "notes" text NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_courier_settlement_line" PRIMARY KEY ("id")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "courier_settlement_line";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "courier_settlement";`);
  }
}
