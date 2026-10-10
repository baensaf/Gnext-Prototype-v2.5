import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customer fields head office defines, instead of a column for each thing a restaurant might
 * want to know.
 *
 * Gender and the wedding date (migration 090) were built as columns. They become fields any
 * chain can add, rename or archive: a chain whose customers already have a gender or a wedding
 * date gets those two fields made for it, with the answers carried over, and the columns go.
 */
export class CustomerCustomFields1700000000104 implements MigrationInterface {
  name = 'CustomerCustomFields1700000000104';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "custom_field_definition"
        ADD COLUMN IF NOT EXISTS "options" jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
        ALTER COLUMN "data_type" SET DEFAULT 'TEXT'
    `);
    await queryRunner.query(`UPDATE "custom_field_definition" SET "data_type" = 'TEXT' WHERE "data_type" = 'STRING'`);
    await queryRunner.query(`DELETE FROM "customer_custom_value" a USING "customer_custom_value" b WHERE a."customer_id" = b."customer_id" AND a."field_id" = b."field_id" AND a."id" < b."id"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customer_custom_value" ON "customer_custom_value" ("customer_id", "field_id")`,
    );

    const hasGender = await queryRunner.hasColumn('customer', 'gender');
    if (hasGender) {
      await queryRunner.query(`
        INSERT INTO "custom_field_definition" ("tenant_id", "key", "name", "data_type", "options", "sort_order")
        SELECT DISTINCT "tenant_id", 'gender', 'جنسیت', 'CHOICE', '["مرد","زن"]'::jsonb, 0
          FROM "customer" WHERE "gender" IS NOT NULL
      `);
      await queryRunner.query(`
        INSERT INTO "customer_custom_value" ("tenant_id", "customer_id", "field_id", "value")
        SELECT c."tenant_id", c."id", f."id", CASE c."gender" WHEN 'MALE' THEN 'مرد' ELSE 'زن' END
          FROM "customer" c
          JOIN "custom_field_definition" f ON f."tenant_id" = c."tenant_id" AND f."key" = 'gender'
         WHERE c."gender" IS NOT NULL
      `);
    }
    const hasMarriage = await queryRunner.hasColumn('customer', 'marriage_date');
    if (hasMarriage) {
      await queryRunner.query(`
        INSERT INTO "custom_field_definition" ("tenant_id", "key", "name", "data_type", "options", "sort_order")
        SELECT DISTINCT "tenant_id", 'marriage_date', 'تاریخ ازدواج', 'DATE', '[]'::jsonb, 1
          FROM "customer" WHERE "marriage_date" IS NOT NULL
      `);
      await queryRunner.query(`
        INSERT INTO "customer_custom_value" ("tenant_id", "customer_id", "field_id", "value")
        SELECT c."tenant_id", c."id", f."id", to_char(c."marriage_date", 'YYYY-MM-DD')
          FROM "customer" c
          JOIN "custom_field_definition" f ON f."tenant_id" = c."tenant_id" AND f."key" = 'marriage_date'
         WHERE c."marriage_date" IS NOT NULL
      `);
    }
    await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN IF EXISTS "gender", DROP COLUMN IF EXISTS "marriage_date"`);
  }

  public async down(): Promise<void> {
    // Gender and the wedding date live on as customer fields; the columns are not coming back.
  }
}
