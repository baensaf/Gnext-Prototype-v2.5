import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Puts the Orders page on the live stream. An order row changes when it is placed, paid,
 * sent, completed, cancelled or refunded, so the header table alone is enough: the page is
 * only told to re-read, through the usual list endpoint. Uses the notify function from
 * migration 068.
 */
export class LiveOrdersNotify1700000000072 implements MigrationInterface {
  name = 'LiveOrdersNotify1700000000072';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_live_notify" ON "order_header"`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_live_notify"
      AFTER INSERT OR UPDATE OR DELETE ON "order_header"
      FOR EACH ROW EXECUTE FUNCTION gnext_live_notify('orders')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_live_notify" ON "order_header"`);
  }
}
