import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Categories no longer nest (Phase 1 scope, 2026-09-29): a menu has categories and nothing
 * under them. A sub-category becomes a category of its own, placed where the menu showed it,
 * right after its old parent, and every category is numbered again in that order.
 */
export class FlatCategories1700000000083 implements MigrationInterface {
  name = 'FlatCategories1700000000083';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH placed AS (
        SELECT c.id,
               ROW_NUMBER() OVER (
                 PARTITION BY c.tenant_id
                 ORDER BY COALESCE(p.sort_order, c.sort_order), COALESCE(p.code, c.code),
                          (p.id IS NOT NULL), c.sort_order, c.code
               ) AS n
        FROM "category" c
        LEFT JOIN "category" p ON p.id = c.parent_id
      )
      UPDATE "category" c SET "sort_order" = placed.n FROM placed WHERE placed.id = c.id
    `);
    await queryRunner.query(`ALTER TABLE "category" DROP COLUMN IF EXISTS "parent_id"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "parent_id" uuid`);
  }
}
