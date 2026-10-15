import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A branch chooses its default receipt printer, as it chooses its default kitchen printer
 * (K-23, 2026-10-15). A till with no receipt printer of its own prints there; with none chosen
 * its receipts fail where they can be seen, instead of going to whichever printer sorts first.
 *
 * Each branch's first receipt printer is marked once, so nothing that prints today stops. After
 * that, the first receipt printer a branch adds becomes its default by itself (a trigger, so a
 * printer added by the web app, the branch agent or a seed is treated alike); head office or
 * the branch manager can then pick another.
 */
export class ReceiptDefaultPrinter1700000000135 implements MigrationInterface {
  name = 'ReceiptDefaultPrinter1700000000135';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "printer" ADD COLUMN IF NOT EXISTS "receipt_default" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`
      UPDATE "printer" p SET "receipt_default" = true
        FROM (
          SELECT DISTINCT ON ("tenant_id", "branch_id") "id"
            FROM "printer"
           WHERE "deleted_at" IS NULL AND "is_active" AND upper("printer_type") LIKE '%RECEIPT%'
           ORDER BY "tenant_id", "branch_id", "code", "id"
        ) first
       WHERE p."id" = first."id"
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION gnext_printer_receipt_default() RETURNS trigger AS $$
      BEGIN
        IF upper(COALESCE(NEW."printer_type", '')) LIKE '%RECEIPT%' AND NOT NEW."receipt_default"
           AND NOT EXISTS (
             SELECT 1 FROM "printer"
              WHERE "tenant_id" = NEW."tenant_id" AND "branch_id" IS NOT DISTINCT FROM NEW."branch_id"
                AND "receipt_default" AND "deleted_at" IS NULL
           ) THEN
          NEW."receipt_default" := true;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_printer_receipt_default" ON "printer"`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_printer_receipt_default"
      BEFORE INSERT ON "printer"
      FOR EACH ROW EXECUTE FUNCTION gnext_printer_receipt_default()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_printer_receipt_default" ON "printer"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS gnext_printer_receipt_default()`);
    await queryRunner.query(`ALTER TABLE "printer" DROP COLUMN IF EXISTS "receipt_default"`);
  }
}
