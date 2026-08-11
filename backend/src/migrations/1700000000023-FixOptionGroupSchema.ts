import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixOptionGroupSchema1700000000023 implements MigrationInterface {
  name = 'FixOptionGroupSchema1700000000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add missing columns to option_group table
    await queryRunner.query(`
      ALTER TABLE "option_group"
        ADD COLUMN IF NOT EXISTS "min_selection" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "max_selection" integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "is_required" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "created_by" uuid NULL,
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS "updated_by" uuid NULL,
        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;

      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='option_group' AND column_name='min_select') THEN
          UPDATE "option_group" SET "min_selection" = "min_select" WHERE "min_select" IS NOT NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='option_group' AND column_name='max_select') THEN
          UPDATE "option_group" SET "max_selection" = "max_select" WHERE "max_select" IS NOT NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback logic if needed
  }
}
