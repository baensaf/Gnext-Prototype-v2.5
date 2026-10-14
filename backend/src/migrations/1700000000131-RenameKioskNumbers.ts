import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Kiosk orders were numbered `KOS-…` and their payments `PAY-KOS-…` (reference `SIM-KOS-…`).
 * "KOS" is an offensive word in Persian. New kiosk orders and payments take the branch's
 * ORD/PAY counters (2026-10-14); this renames the ones already issued to `KIOSK-…`.
 */
export class RenameKioskNumbers1700000000131 implements MigrationInterface {
  name = 'RenameKioskNumbers1700000000131';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "order_header" SET "order_number" = 'KIOSK-' || substring("order_number" from 5) WHERE "order_number" LIKE 'KOS-%'`);
    await queryRunner.query(`UPDATE "courier_settlement_line" SET "order_number" = 'KIOSK-' || substring("order_number" from 5) WHERE "order_number" LIKE 'KOS-%'`);
    await queryRunner.query(`UPDATE "payment" SET "payment_number" = 'PAY-KIOSK-' || substring("payment_number" from 9) WHERE "payment_number" LIKE 'PAY-KOS-%'`);
    await queryRunner.query(`UPDATE "payment" SET "reference" = 'SIM-KIOSK-' || substring("reference" from 9) WHERE "reference" LIKE 'SIM-KOS-%'`);
  }

  public async down(): Promise<void> {
    // The old names are not restored.
  }
}
