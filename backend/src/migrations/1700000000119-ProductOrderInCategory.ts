import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Products have an order inside their category, set by hand as on Snappfood's "ترتیب محصولات"
 * (2026-10-12). Empty means not placed yet: such products come after the placed ones, by name,
 * which is how every product is listed until someone orders a category.
 */
export class ProductOrderInCategory1700000000119 implements MigrationInterface {
  name = 'ProductOrderInCategory1700000000119';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "sort_order" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN IF EXISTS "sort_order"`);
  }
}
