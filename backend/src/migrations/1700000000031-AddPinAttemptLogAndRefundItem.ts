import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPinAttemptLogAndRefundItem1700000000031 implements MigrationInterface {
  name = 'AddPinAttemptLogAndRefundItem1700000000031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. pin_attempt_log table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pin_attempt_log" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "action" character varying(64),
        "is_success" boolean NOT NULL DEFAULT false,
        "attempted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pin_attempt_log" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "IDX_pin_attempt_log_user" ON "pin_attempt_log" ("tenant_id", "user_id");
    `);

    // 2. refund_item table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refund_item" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "refund_request_id" uuid NOT NULL,
        "order_item_id" uuid NOT NULL,
        "quantity_refunded" integer NOT NULL DEFAULT 1,
        "amount" numeric(19, 4) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refund_item" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "IDX_refund_item_req" ON "refund_item" ("refund_request_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "refund_item";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pin_attempt_log";`);
  }
}
