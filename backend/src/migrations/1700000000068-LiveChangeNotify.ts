import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tells the backend when the rows behind the operations boards change, so the boards can
 * refresh when something happened instead of asking every few seconds.
 *
 * The trigger sits in the database rather than in the services because the boards'
 * rows are written from many places — the delivery and KDS services, order placement,
 * the print agent, the simulators — and a notice from each would be easy to miss.
 *
 * The payload names the board, the tenant and, where the row has one, the branch. It
 * carries nothing else: a listener is only told to re-read, through the usual endpoints
 * and their checks. Postgres drops identical notices raised inside one transaction, so a
 * bulk update sends one notice per board rather than one per row.
 */
const TOPICS: Record<string, string> = {
  delivery: 'delivery',
  delivery_assignment: 'delivery',
  delivery_zone: 'delivery',
  courier: 'delivery',
  courier_attendance: 'delivery',
  courier_terminal_assignment: 'delivery',
  kitchen_ticket: 'kds',
  kitchen_ticket_item: 'kds',
  print_job: 'print',
  print_attempt: 'print',
};

export class LiveChangeNotify1700000000068 implements MigrationInterface {
  name = 'LiveChangeNotify1700000000068';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION gnext_live_notify() RETURNS trigger AS $$
      DECLARE
        rec jsonb := to_jsonb(COALESCE(NEW, OLD));
      BEGIN
        PERFORM pg_notify('gnext_live', json_build_object(
          'topic', TG_ARGV[0],
          'tenant_id', rec->>'tenant_id',
          'branch_id', rec->>'branch_id'
        )::text);
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);

    for (const [table, topic] of Object.entries(TOPICS)) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_live_notify" ON "${table}"`);
      await queryRunner.query(`
        CREATE TRIGGER "trg_live_notify"
        AFTER INSERT OR UPDATE OR DELETE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION gnext_live_notify('${topic}')
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of Object.keys(TOPICS)) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_live_notify" ON "${table}"`);
    }
    await queryRunner.query(`DROP FUNCTION IF EXISTS gnext_live_notify()`);
  }
}
