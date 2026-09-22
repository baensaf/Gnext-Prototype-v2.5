import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * - `order_header.call_number`: the short number a branch calls an order by (123), beside the
 *   chain-wide order number. It restarts every business day, per branch, from each channel's
 *   range; `order_call_counter` is that day's counter.
 * - `printer_group.ticket_template`: COMPACT or DETAILED paper for the documents the group
 *   prints. Null means the document's default (a compact kitchen chit, a detailed receipt).
 * - `terminal.payment_device_id`: the card terminal a kiosk charges through the branch agent.
 */
export class CallNumbersTicketTemplatesKioskTerminal1700000000071 implements MigrationInterface {
  name = 'CallNumbersTicketTemplatesKioskTerminal1700000000071';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "call_number" integer`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_call_counter" (
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "business_date" character varying(10) NOT NULL,
        "channel_group" character varying(16) NOT NULL,
        "last_value" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_order_call_counter" PRIMARY KEY ("tenant_id", "branch_id", "business_date", "channel_group")
      );
    `);
    await queryRunner.query(`ALTER TABLE "printer_group" ADD COLUMN IF NOT EXISTS "ticket_template" character varying(16)`);
    await queryRunner.query(`ALTER TABLE "terminal" ADD COLUMN IF NOT EXISTS "payment_device_id" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "terminal" DROP COLUMN IF EXISTS "payment_device_id"`);
    await queryRunner.query(`ALTER TABLE "printer_group" DROP COLUMN IF EXISTS "ticket_template"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_call_counter"`);
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "call_number"`);
  }
}
