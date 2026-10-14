import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payment, refund and shift numbers come from the `order_sequence` counters, like order numbers
 * (2026-10-14). Payments and refunds were numbered by counting the day's rows, and shifts with a
 * random four-digit suffix. Each counter starts after the highest number already used for its
 * day, so nothing issued today is handed out again.
 */
export class NumberCountersForPaymentsRefundsShifts1700000000129 implements MigrationInterface {
  name = 'NumberCountersForPaymentsRefundsShifts1700000000129';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column, tag] of [
      ['payment', 'payment_number', 'PAY'],
      ['refund', 'refund_number', 'REF'],
      ['cashier_shift', 'shift_number', 'SHF'],
    ]) {
      await queryRunner.query(`
        INSERT INTO "order_sequence" ("tenant_id", "prefix", "last_value")
        SELECT "tenant_id",
               substring("${column}" from '^(${tag}-[0-9]{8})-'),
               max(substring("${column}" from '-([0-9]+)$')::int)
          FROM "${table}"
         WHERE "${column}" ~ '^${tag}-[0-9]{8}-[0-9]+$'
         GROUP BY 1, 2
        ON CONFLICT ("tenant_id", "prefix")
        DO UPDATE SET "last_value" = GREATEST("order_sequence"."last_value", EXCLUDED."last_value")
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "order_sequence" WHERE "prefix" ~ '^(PAY|REF|SHF)-[0-9]{8}$'`);
  }
}
