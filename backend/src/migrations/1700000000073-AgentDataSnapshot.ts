import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The branch snapshot for the agent (protocol §12.2): the table that keeps each served
 * version, and a change notice on every table the snapshot is built from, so the cloud can
 * tell a connected agent to pull (§12.3).
 *
 * The notice reuses `gnext_live_notify` (migration 068) under its own trigger name and topic,
 * `agent-data`, so it sits beside a table's board trigger instead of replacing it. Stock sold
 * and call numbers drawn are left out on purpose: they move with every order, and the agent's
 * 15-minute pull picks them up.
 */
const TABLES = [
  'branch',
  'category',
  'product',
  'product_variant',
  'option_group',
  'option_item',
  'product_option_group',
  'price_entry',
  'price_group',
  'price_group_branch',
  'product_availability',
  'availability_schedule',
  'daily_stock',
  'payment_method',
  'dining_area',
  'dining_table',
  'delivery_zone',
  'terminal',
  'cashier_shift',
  'tenant_setting',
];

export class AgentDataSnapshot1700000000073 implements MigrationInterface {
  name = 'AgentDataSnapshot1700000000073';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_data_snapshot" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "data_version" character varying(64) NOT NULL,
        "body" jsonb NOT NULL,
        "first_served_at" timestamptz NOT NULL DEFAULT now(),
        "last_served_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_agent_data_snapshot_version"
      ON "agent_data_snapshot" ("tenant_id", "branch_id", "data_version")
    `);

    for (const table of TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_agent_data_notify" ON "${table}"`);
      await queryRunner.query(`
        CREATE TRIGGER "trg_agent_data_notify"
        AFTER INSERT OR UPDATE OR DELETE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION gnext_live_notify('agent-data')
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_agent_data_notify" ON "${table}"`);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_data_snapshot"`);
  }
}
