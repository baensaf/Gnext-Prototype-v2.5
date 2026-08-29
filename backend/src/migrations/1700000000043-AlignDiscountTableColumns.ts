import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignDiscountTableColumns1700000000043 implements MigrationInterface {
  name = 'AlignDiscountTableColumns1700000000043';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "discount" ADD COLUMN IF NOT EXISTS "kind" varchar(30) NOT NULL DEFAULT 'MANUAL';
      ALTER TABLE "discount" ADD COLUMN IF NOT EXISTS "calculation_type" varchar(20) NOT NULL DEFAULT 'PERCENTAGE';
      ALTER TABLE "discount" ADD COLUMN IF NOT EXISTS "min_order_total" numeric(19, 4) NOT NULL DEFAULT 0.0000;
      ALTER TABLE "discount" ADD COLUMN IF NOT EXISTS "max_discount_amount" numeric(19, 4);
      ALTER TABLE "discount" ADD COLUMN IF NOT EXISTS "requires_reason" boolean NOT NULL DEFAULT false;
      ALTER TABLE "discount" ADD COLUMN IF NOT EXISTS "requires_manager_approval" boolean NOT NULL DEFAULT false;
      ALTER TABLE "discount" ADD COLUMN IF NOT EXISTS "applies_to_scope" varchar(20) NOT NULL DEFAULT 'ORDER';
      ALTER TABLE "discount" ADD COLUMN IF NOT EXISTS "created_by" uuid;
      ALTER TABLE "discount" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
      ALTER TABLE "discount" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
      ALTER TABLE "discount" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
      ALTER TABLE "discount" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "discount" DROP COLUMN IF EXISTS "kind";
      ALTER TABLE "discount" DROP COLUMN IF EXISTS "calculation_type";
      ALTER TABLE "discount" DROP COLUMN IF EXISTS "min_order_total";
      ALTER TABLE "discount" DROP COLUMN IF EXISTS "max_discount_amount";
      ALTER TABLE "discount" DROP COLUMN IF EXISTS "requires_reason";
      ALTER TABLE "discount" DROP COLUMN IF EXISTS "requires_manager_approval";
      ALTER TABLE "discount" DROP COLUMN IF EXISTS "applies_to_scope";
      ALTER TABLE "discount" DROP COLUMN IF EXISTS "created_by";
      ALTER TABLE "discount" DROP COLUMN IF EXISTS "updated_at";
      ALTER TABLE "discount" DROP COLUMN IF EXISTS "updated_by";
      ALTER TABLE "discount" DROP COLUMN IF EXISTS "deleted_at";
      ALTER TABLE "discount" DROP COLUMN IF EXISTS "version";
    `);
  }
}
