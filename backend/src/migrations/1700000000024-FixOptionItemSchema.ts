import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixOptionItemSchema1700000000024 implements MigrationInterface {
  name = 'FixOptionItemSchema1700000000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add missing columns to option_item table
    await queryRunner.query(`
      ALTER TABLE "option_item"
        ADD COLUMN IF NOT EXISTS "price_delta" numeric(19, 4) NOT NULL DEFAULT '0.0000',
        ADD COLUMN IF NOT EXISTS "is_default" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "created_by" uuid NULL,
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS "updated_by" uuid NULL,
        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;

      UPDATE "option_item" SET "price_delta" = "price_override" WHERE "price_override" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback logic if needed
  }
}
