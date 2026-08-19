import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixSchemaDiscrepancies1700000000029 implements MigrationInterface {
  name = 'FixSchemaDiscrepancies1700000000029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. ProductOptionGroup schema alignment
    await queryRunner.query(`
      ALTER TABLE "product_option_group"
        ADD COLUMN IF NOT EXISTS "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        ADD COLUMN IF NOT EXISTS "tenant_id" uuid,
        ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();
    `);

    // Drop old composite PK if exists and replace with id PK
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'product_option_group_pkey'
        ) THEN
          ALTER TABLE "product_option_group" DROP CONSTRAINT "product_option_group_pkey";
          ALTER TABLE "product_option_group" ADD CONSTRAINT "PK_product_option_group" PRIMARY KEY ("id");
        END IF;
      END $$;
    `);

    // 2. Customer schema alignment
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'customer' AND column_name = 'full_name'
        ) THEN
          ALTER TABLE "customer" ALTER COLUMN "full_name" DROP NOT NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "customer"
        ADD COLUMN IF NOT EXISTS "first_name" character varying(80),
        ADD COLUMN IF NOT EXISTS "last_name" character varying(80),
        ADD COLUMN IF NOT EXISTS "customer_group_id" uuid,
        ADD COLUMN IF NOT EXISTS "national_id" character varying(20),
        ADD COLUMN IF NOT EXISTS "created_by" uuid,
        ADD COLUMN IF NOT EXISTS "updated_by" uuid,
        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
    `);

    // 3. TenantSetting schema alignment
    await queryRunner.query(`
      ALTER TABLE "tenant_setting"
        ADD COLUMN IF NOT EXISTS "schema_version" integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "created_by" uuid,
        ADD COLUMN IF NOT EXISTS "updated_by" uuid,
        ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
    `);

    // 4. ImportJob schema alignment
    await queryRunner.query(`
      ALTER TABLE "import_job"
        ADD COLUMN IF NOT EXISTS "file_name" character varying(255) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "valid_rows" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "error_rows" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "column_mapping" jsonb,
        ADD COLUMN IF NOT EXISTS "value_mapping" jsonb,
        ADD COLUMN IF NOT EXISTS "error_summary" jsonb,
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reversible if needed
  }
}
