import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTableEventAndDeliveryAssignmentCols1700000000032 implements MigrationInterface {
  name = 'AddTableEventAndDeliveryAssignmentCols1700000000032';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. delivery_assignment columns
    await queryRunner.query(`
      ALTER TABLE "delivery_assignment"
        ADD COLUMN IF NOT EXISTS "tenant_id" uuid,
        ADD COLUMN IF NOT EXISTS "picked_up_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "delivery_fee" numeric(12, 2) NOT NULL DEFAULT '0.00',
        ADD COLUMN IF NOT EXISTS "tip_amount" numeric(12, 2) NOT NULL DEFAULT '0.00',
        ADD COLUMN IF NOT EXISTS "failure_reason" text,
        ADD COLUMN IF NOT EXISTS "is_settled" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "settlement_id" uuid,
        ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();
    `);

    // 2. table_event table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "table_event" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "table_session_id" uuid NOT NULL,
        "event_type" character varying(64) NOT NULL,
        "payload" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_table_event" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "IDX_table_event_session" ON "table_event" ("tenant_id", "table_session_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "table_event";`);
  }
}
