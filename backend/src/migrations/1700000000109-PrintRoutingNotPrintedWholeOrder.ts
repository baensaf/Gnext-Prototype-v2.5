import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Print routing that can say "no kitchen chit", and a printer for the whole order (2026-10-10).
 *
 * - `print_route.printer_id` may be null: that category or product prints in no kitchen. Cans of
 *   cola and sauce sachets come off the shelf; a cook does not need a chit for them.
 * - `printer.prints_whole_order`: the printer prints every line of every order on one chit, for
 *   the person at the pass who bags it.
 */
export class PrintRoutingNotPrintedWholeOrder1700000000109 implements MigrationInterface {
  name = 'PrintRoutingNotPrintedWholeOrder1700000000109';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "print_route" ALTER COLUMN "printer_id" DROP NOT NULL`);
    // Not printed is one list per branch, so a category or product is on it once.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_print_route_np_category" ON "print_route" ("branch_id", "category_id") WHERE "printer_id" IS NULL AND "category_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_print_route_np_product" ON "print_route" ("branch_id", "product_id") WHERE "printer_id" IS NULL AND "product_id" IS NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "printer" ADD COLUMN IF NOT EXISTS "prints_whole_order" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "printer" DROP COLUMN IF EXISTS "prints_whole_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_print_route_np_category"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_print_route_np_product"`);
    await queryRunner.query(`DELETE FROM "print_route" WHERE "printer_id" IS NULL`);
    await queryRunner.query(`ALTER TABLE "print_route" ALTER COLUMN "printer_id" SET NOT NULL`);
  }
}
