import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A product's code becomes optional: small shops never use one, chains fill it for search and
 * for matching rows on a re-import. The product's id is the identifier everything else points
 * at. SKU goes from products and variants: code covers it, and barcode holds what is scanned.
 */
export class OptionalProductCode1700000000081 implements MigrationInterface {
  name = 'OptionalProductCode1700000000081';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "code" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN IF EXISTS "sku"`);
    await queryRunner.query(`ALTER TABLE "product_variant" DROP COLUMN IF EXISTS "sku"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product_variant" ADD COLUMN IF NOT EXISTS "sku" character varying(64)`);
    await queryRunner.query(`ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "sku" varchar(64)`);
    await queryRunner.query(`UPDATE "product" SET "code" = 'P-' || upper(left(replace("id"::text, '-', ''), 8)) WHERE "code" IS NULL`);
    await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "code" SET NOT NULL`);
  }
}
