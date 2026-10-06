import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The offline till is gone (agent-protocol.md §19.2), so what migrations 073, 074, 076, 078 and
 * 079 made only for it goes too:
 *
 * - `agent_sync_order` (offline orders as agents uploaded them) and `agent_data_snapshot` (the
 *   branch snapshots the cloud served), with their indexes;
 * - every `trg_agent_data_notify` trigger, on whichever tables migrations 073, 076, 078 and 079
 *   put it, and the two helper functions `gnext_agent_data_notify_group_member` and
 *   `gnext_agent_data_notify_tenant`. `gnext_live_notify` itself stays: the live boards use it;
 * - `order_header.aggregator_match`, `aggregator_match_at` and the partial index on them (Snappfood
 *   orders matched after the till took them offline).
 *
 * `order_header.source` stays, with the value AGENT_OFFLINE on the orders agents 1.x uploaded:
 * clearing it would be a data change for a label the orders directory still shows on those orders.
 * Nothing writes it any more.
 */
export class RemoveOfflineSelling1700000000096 implements MigrationInterface {
  name = 'RemoveOfflineSelling1700000000096';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_sync_order"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_data_snapshot"`);

    // The trigger is named the same on every table, so find them rather than list the tables.
    await queryRunner.query(`
      DO $$
      DECLARE
        t record;
      BEGIN
        FOR t IN
          SELECT c.relname AS table_name, n.nspname AS schema_name
            FROM pg_trigger g
            JOIN pg_class c ON c.oid = g.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE g.tgname = 'trg_agent_data_notify' AND NOT g.tgisinternal
        LOOP
          EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I', 'trg_agent_data_notify', t.schema_name, t.table_name);
        END LOOP;
      END
      $$
    `);
    await queryRunner.query(`DROP FUNCTION IF EXISTS gnext_agent_data_notify_group_member()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS gnext_agent_data_notify_tenant()`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_order_header_aggregator_match"`);
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "aggregator_match_at"`);
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "aggregator_match"`);
  }

  public async down(): Promise<void> {
    // Offline selling is not brought back here; if it returns it is rebuilt on the new base, and
    // the rows these tables held (uploaded offline orders, served snapshots) are not kept anywhere.
  }
}
