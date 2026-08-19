import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixDineInSchemaColumns1700000000035 implements MigrationInterface {
  name = 'FixDineInSchemaColumns1700000000035';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "dining_area"
        ADD COLUMN IF NOT EXISTS "tenant_id" uuid,
        ADD COLUMN IF NOT EXISTS "branch_id" uuid,
        ADD COLUMN IF NOT EXISTS "code" varchar(32),
        ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

      ALTER TABLE "dining_table"
        ADD COLUMN IF NOT EXISTS "tenant_id" uuid,
        ADD COLUMN IF NOT EXISTS "dining_area_id" uuid,
        ADD COLUMN IF NOT EXISTS "code" varchar(32),
        ADD COLUMN IF NOT EXISTS "table_number" varchar(32),
        ADD COLUMN IF NOT EXISTS "seating_capacity" integer NOT NULL DEFAULT 4,
        ADD COLUMN IF NOT EXISTS "shape" varchar(32) NOT NULL DEFAULT 'RECTANGLE',
        ADD COLUMN IF NOT EXISTS "pos_x" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "pos_y" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "status" varchar(32) NOT NULL DEFAULT 'VACANT',
        ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dining_table' AND column_name='number') THEN
          UPDATE "dining_table" SET "table_number" = "number" WHERE "table_number" IS NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dining_table' AND column_name='area_id') THEN
          UPDATE "dining_table" SET "dining_area_id" = "area_id" WHERE "dining_area_id" IS NULL;
        END IF;
      END $$;

      ALTER TABLE "table_session"
        ADD COLUMN IF NOT EXISTS "tenant_id" uuid,
        ADD COLUMN IF NOT EXISTS "table_id" uuid,
        ADD COLUMN IF NOT EXISTS "active_order_id" uuid,
        ADD COLUMN IF NOT EXISTS "status" varchar(32) NOT NULL DEFAULT 'OCCUPIED',
        ADD COLUMN IF NOT EXISTS "guest_count" integer NOT NULL DEFAULT 2,
        ADD COLUMN IF NOT EXISTS "seated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Non-destructive down
  }
}
