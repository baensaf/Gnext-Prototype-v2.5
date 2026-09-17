import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Combo products: a product marked COMBO sells as one line whose option groups are its slots,
 * and an option choice may name the product it gives. Existing products stay STANDARD.
 */
export class AddComboProducts1700000000054 implements MigrationInterface {
  name = 'AddComboProducts1700000000054';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product"
        ADD COLUMN IF NOT EXISTS "product_type" character varying(20) NOT NULL DEFAULT 'STANDARD';
    `);
    await queryRunner.query(`
      ALTER TABLE "option_item"
        ADD COLUMN IF NOT EXISTS "product_id" uuid;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "option_item" DROP COLUMN IF EXISTS "product_id";`);
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN IF EXISTS "product_type";`);
  }
}
