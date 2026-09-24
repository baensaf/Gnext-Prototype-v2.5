import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Change notices for what the offline till adds to the branch snapshot and the staff list
 * (protocol §13.3, §13.11): the users who may sign in, the print routing, and the tenant's name
 * on the ticket heading. Same `agent-data` topic and trigger name as migration 073.
 *
 * Two tables do not carry the tenant the notice needs: a printer group's member row only names
 * its group, and a tenant row is its own tenant. Each gets a small function that finds it.
 */
const TABLES = ['admin_user', 'print_route', 'printer_group', 'kds_routing_rule', 'printer'];

export class OfflineTillNotify1700000000076 implements MigrationInterface {
  name = 'OfflineTillNotify1700000000076';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_agent_data_notify" ON "${table}"`);
      await queryRunner.query(`
        CREATE TRIGGER "trg_agent_data_notify"
        AFTER INSERT OR UPDATE OR DELETE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION gnext_live_notify('agent-data')
      `);
    }

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION gnext_agent_data_notify_group_member() RETURNS trigger AS $$
      DECLARE
        g record;
      BEGIN
        SELECT "tenant_id", "branch_id" INTO g FROM "printer_group"
         WHERE "id" = (to_jsonb(COALESCE(NEW, OLD))->>'group_id')::uuid;
        IF FOUND THEN
          PERFORM pg_notify('gnext_live', json_build_object(
            'topic', 'agent-data', 'tenant_id', g."tenant_id", 'branch_id', g."branch_id"
          )::text);
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_agent_data_notify" ON "printer_group_member"`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_agent_data_notify"
      AFTER INSERT OR UPDATE OR DELETE ON "printer_group_member"
      FOR EACH ROW EXECUTE FUNCTION gnext_agent_data_notify_group_member()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION gnext_agent_data_notify_tenant() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_notify('gnext_live', json_build_object(
          'topic', 'agent-data', 'tenant_id', to_jsonb(COALESCE(NEW, OLD))->>'id', 'branch_id', NULL
        )::text);
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_agent_data_notify" ON "tenant"`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_agent_data_notify"
      AFTER UPDATE ON "tenant"
      FOR EACH ROW EXECUTE FUNCTION gnext_agent_data_notify_tenant()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [...TABLES, 'printer_group_member', 'tenant']) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_agent_data_notify" ON "${table}"`);
    }
    await queryRunner.query(`DROP FUNCTION IF EXISTS gnext_agent_data_notify_group_member()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS gnext_agent_data_notify_tenant()`);
  }
}
