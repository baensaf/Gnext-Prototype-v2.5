import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A Snappfood order's arrival no longer goes to the Notification Center (2026-10-04): the
 * chime, the toast and the header's Incoming Orders count announce it. The code that closed
 * an arrival notice once its order was answered went with it, so notices still open would
 * sit in the bell for good. They are closed here. The one INCOMING_ORDER warning that stays,
 * a paid order with no ONLINE payment method, has a different title and is left alone.
 */
export class CloseOrderArrivalAlerts1700000000092 implements MigrationInterface {
  name = 'CloseOrderArrivalAlerts1700000000092';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "operational_alert"
         SET "acknowledged" = true, "acknowledged_at" = now()
       WHERE "type" = 'INCOMING_ORDER'
         AND "acknowledged" = false
         AND ("title" LIKE 'New Snappfood order %' OR "title" LIKE 'Snappfood sent order %')
    `);
  }

  public async down(): Promise<void> {
    // Nothing to undo: which notices were open before is not kept.
  }
}
