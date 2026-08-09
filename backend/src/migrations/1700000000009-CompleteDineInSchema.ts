import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteDineInSchema1700000000009 implements MigrationInterface {
  name = 'CompleteDineInSchema1700000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "table_occupancy_event" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "table_id" uuid NOT NULL,
        "order_id" uuid,
        "from_table_id" uuid,
        "event_type" character varying(32) NOT NULL,
        "guest_count" integer,
        "occurred_by" uuid,
        "details" jsonb,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_table_occupancy_event" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      ALTER TABLE "dining_area"
        ADD COLUMN IF NOT EXISTS "tenant_id" uuid,
        ADD COLUMN IF NOT EXISTS "code" varchar(32),
        ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

      ALTER TABLE "dining_table"
        ADD COLUMN IF NOT EXISTS "tenant_id" uuid,
        ADD COLUMN IF NOT EXISTS "dining_area_id" uuid,
        ADD COLUMN IF NOT EXISTS "code" varchar(32),
        ADD COLUMN IF NOT EXISTS "seating_capacity" integer NOT NULL DEFAULT 4,
        ADD COLUMN IF NOT EXISTS "shape" varchar(32) NOT NULL DEFAULT 'RECTANGLE',
        ADD COLUMN IF NOT EXISTS "pos_x" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "pos_y" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dining_table' AND column_name='area_id') THEN
          UPDATE "dining_table" SET "dining_area_id" = "area_id" WHERE "dining_area_id" IS NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_table_occupancy_event_table_time"
      ON "table_occupancy_event" ("tenant_id", "table_id", "occurred_at");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_dining_table_area"
      ON "dining_table" ("tenant_id", "dining_area_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_dining_area_branch"
      ON "dining_area" ("tenant_id", "branch_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dining_area_branch";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dining_table_area";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_table_occupancy_event_table_time";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "table_occupancy_event";`);
  }
}
