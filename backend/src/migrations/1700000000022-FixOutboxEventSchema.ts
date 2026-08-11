import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixOutboxEventSchema1700000000022 implements MigrationInterface {
  name = 'FixOutboxEventSchema1700000000022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add missing state, attempts, available_at, locked_at, and error columns to outbox_event table
    await queryRunner.query(`
      ALTER TABLE "outbox_event"
        ADD COLUMN IF NOT EXISTS "state" varchar(20) NOT NULL DEFAULT 'PENDING',
        ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "available_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS "locked_at" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "error" text NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback logic if needed
  }
}
