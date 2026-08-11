import { MigrationInterface, QueryRunner } from 'typeorm';

export class SchemaFixesForConformantE2E1700000000018 implements MigrationInterface {
  name = 'SchemaFixesForConformantE2E1700000000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add missing columns to courier table
    await queryRunner.query(`
      ALTER TABLE "courier"
        ADD COLUMN IF NOT EXISTS "branch_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "code" varchar(32) NULL,
        ADD COLUMN IF NOT EXISTS "vehicle_type" varchar(32) NOT NULL DEFAULT 'MOTORCYCLE',
        ADD COLUMN IF NOT EXISTS "status" varchar(32) NOT NULL DEFAULT 'AVAILABLE',
        ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
    `);

    // 2. Add missing ticket_number and status to kitchen_ticket table
    await queryRunner.query(`
      ALTER TABLE "kitchen_ticket"
        ADD COLUMN IF NOT EXISTS "ticket_number" varchar(32) NOT NULL DEFAULT 'TKT-001',
        ADD COLUMN IF NOT EXISTS "status" varchar(32) NOT NULL DEFAULT 'NEW';
    `);

    // 3. Add missing columns to kitchen_station table
    await queryRunner.query(`
      ALTER TABLE "kitchen_station"
        ADD COLUMN IF NOT EXISTS "tenant_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "branch_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "code" varchar(32) NULL,
        ADD COLUMN IF NOT EXISTS "name" varchar(160) NULL,
        ADD COLUMN IF NOT EXISTS "station_type" varchar(32) NOT NULL DEFAULT 'PREP',
        ADD COLUMN IF NOT EXISTS "target_minutes" integer NOT NULL DEFAULT 10,
        ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Migration rollback logic if needed
  }
}
