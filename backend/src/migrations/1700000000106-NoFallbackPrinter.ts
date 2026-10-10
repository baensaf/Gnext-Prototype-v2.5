import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * No fallback printers, label printers or serial-port printers (2026-10-10). A printer that was
 * a label printer becomes a receipt printer; one on a serial port is left unconnected.
 */
export class NoFallbackPrinter1700000000106 implements MigrationInterface {
  name = 'NoFallbackPrinter1700000000106';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "printer" DROP COLUMN IF EXISTS "fallback_printer_id"`);
    await queryRunner.query(`UPDATE "printer" SET "printer_type" = 'THERMAL_RECEIPT' WHERE "printer_type" NOT IN ('THERMAL_RECEIPT', 'KITCHEN_IMPACT')`);
    await queryRunner.query(`UPDATE "printer" SET "agent_connection" = NULL WHERE "agent_connection"->>'kind' = 'serial'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "printer" ADD COLUMN IF NOT EXISTS "fallback_printer_id" uuid`);
  }
}
