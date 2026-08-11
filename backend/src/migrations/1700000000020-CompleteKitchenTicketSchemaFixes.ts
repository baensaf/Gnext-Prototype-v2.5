import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteKitchenTicketSchemaFixes1700000000020 implements MigrationInterface {
  name = 'CompleteKitchenTicketSchemaFixes1700000000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add missing columns to kitchen_ticket table
    await queryRunner.query(`
      ALTER TABLE "kitchen_ticket"
        ADD COLUMN IF NOT EXISTS "ticket_number" varchar(32) NOT NULL DEFAULT 'TKT-001',
        ADD COLUMN IF NOT EXISTS "status" varchar(32) NOT NULL DEFAULT 'NEW',
        ADD COLUMN IF NOT EXISTS "prep_time_seconds" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "bumped_at" TIMESTAMP WITH TIME ZONE NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Migration rollback logic if needed
  }
}
