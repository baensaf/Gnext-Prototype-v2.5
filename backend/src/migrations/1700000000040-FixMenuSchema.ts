import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixMenuSchema1700000000040 implements MigrationInterface {
  name = 'FixMenuSchema1700000000040';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ensure menu table has all entity columns
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "menu" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL DEFAULT '',
        "name" varchar(160) NOT NULL,
        "branch_id" uuid,
        "channel" varchar(32) NOT NULL DEFAULT 'ALL',
        "is_active" boolean NOT NULL DEFAULT true,
        "valid_from" timestamptz,
        "valid_to" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" uuid,
        "deleted_at" timestamptz,
        "version" int NOT NULL DEFAULT 1
      );
    `);

    await queryRunner.query(`ALTER TABLE "menu" ADD COLUMN IF NOT EXISTS "code" varchar(32) NOT NULL DEFAULT '';`);
    await queryRunner.query(`ALTER TABLE "menu" ADD COLUMN IF NOT EXISTS "branch_id" uuid;`);
    await queryRunner.query(`ALTER TABLE "menu" ADD COLUMN IF NOT EXISTS "channel" varchar(32) NOT NULL DEFAULT 'ALL';`);
    await queryRunner.query(`ALTER TABLE "menu" ADD COLUMN IF NOT EXISTS "valid_from" timestamptz;`);
    await queryRunner.query(`ALTER TABLE "menu" ADD COLUMN IF NOT EXISTS "valid_to" timestamptz;`);
    await queryRunner.query(`ALTER TABLE "menu" ADD COLUMN IF NOT EXISTS "created_by" uuid;`);
    await queryRunner.query(`ALTER TABLE "menu" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();`);
    await queryRunner.query(`ALTER TABLE "menu" ADD COLUMN IF NOT EXISTS "updated_by" uuid;`);
    await queryRunner.query(`ALTER TABLE "menu" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;`);
    await queryRunner.query(`ALTER TABLE "menu" ADD COLUMN IF NOT EXISTS "version" int NOT NULL DEFAULT 1;`);

    // 2. Ensure menu_category table has entity columns
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "menu_category" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid,
        "menu_id" uuid NOT NULL,
        "category_id" uuid NOT NULL,
        "sort_order" int NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`ALTER TABLE "menu_category" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT uuid_generate_v4();`);
    await queryRunner.query(`ALTER TABLE "menu_category" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;`);
    await queryRunner.query(`ALTER TABLE "menu_category" ADD COLUMN IF NOT EXISTS "sort_order" int NOT NULL DEFAULT 0;`);
    await queryRunner.query(`ALTER TABLE "menu_category" ADD COLUMN IF NOT EXISTS "created_at" timestamptz NOT NULL DEFAULT now();`);
    await queryRunner.query(`ALTER TABLE "menu_category" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();`);

    // 3. Ensure menu_product table has entity columns
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "menu_product" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid,
        "menu_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "category_id" uuid,
        "sort_order" int NOT NULL DEFAULT 0,
        "override_price" numeric(19,4),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`ALTER TABLE "menu_product" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT uuid_generate_v4();`);
    await queryRunner.query(`ALTER TABLE "menu_product" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;`);
    await queryRunner.query(`ALTER TABLE "menu_product" ADD COLUMN IF NOT EXISTS "category_id" uuid;`);
    await queryRunner.query(`ALTER TABLE "menu_product" ADD COLUMN IF NOT EXISTS "sort_order" int NOT NULL DEFAULT 0;`);
    await queryRunner.query(`ALTER TABLE "menu_product" ADD COLUMN IF NOT EXISTS "override_price" numeric(19,4);`);
    await queryRunner.query(`ALTER TABLE "menu_product" ADD COLUMN IF NOT EXISTS "created_at" timestamptz NOT NULL DEFAULT now();`);
    await queryRunner.query(`ALTER TABLE "menu_product" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Non-destructive down
  }
}
