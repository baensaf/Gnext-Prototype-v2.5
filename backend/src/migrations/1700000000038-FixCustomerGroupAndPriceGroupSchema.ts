import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixCustomerGroupAndPriceGroupSchema1700000000038 implements MigrationInterface {
  name = 'FixCustomerGroupAndPriceGroupSchema1700000000038';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. customer_group schema fixes
    await queryRunner.query(`
      ALTER TABLE "customer_group"
        ADD COLUMN IF NOT EXISTS "code" character varying(32),
        ADD COLUMN IF NOT EXISTS "discount_id" uuid,
        ADD COLUMN IF NOT EXISTS "price_group_id" uuid,
        ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "created_by" uuid,
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "updated_by" uuid,
        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
    `);

    await queryRunner.query(`
      UPDATE "customer_group"
      SET "code" = UPPER(SUBSTRING(COALESCE("name", 'GRP'), 1, 10)) || '_' || SUBSTRING(id::text, 1, 4)
      WHERE "code" IS NULL;
    `);

    // 2. price_group schema fixes
    await queryRunner.query(`
      ALTER TABLE "price_group"
        ADD COLUMN IF NOT EXISTS "code" character varying(32),
        ADD COLUMN IF NOT EXISTS "currency_code" character(3) NOT NULL DEFAULT 'IRR',
        ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "created_by" uuid,
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "updated_by" uuid,
        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
    `);

    await queryRunner.query(`
      UPDATE "price_group"
      SET "code" = UPPER(SUBSTRING(COALESCE("name", 'PRICE'), 1, 10)) || '_' || SUBSTRING(id::text, 1, 4)
      WHERE "code" IS NULL;
    `);

    // 3. price_group_item schema fixes
    await queryRunner.query(`
      ALTER TABLE "price_group_item"
        ADD COLUMN IF NOT EXISTS "tenant_id" uuid,
        ADD COLUMN IF NOT EXISTS "override_price" numeric(19, 4),
        ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'price_group_item' AND column_name = 'price'
        ) THEN
          UPDATE "price_group_item"
          SET "override_price" = "price"
          WHERE "override_price" IS NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Down migration
  }
}
