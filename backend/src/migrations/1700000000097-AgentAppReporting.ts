import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What an agent that serves the cashier app (agent-protocol.md §19.12) reports about itself, for
 * the Branch Agents page: the frontend build it serves and its LAN addresses (heartbeat), and the
 * capabilities it announced in `hello`, so the page can say whether it has `app.serve` while the
 * PC is switched off. All three stay null for an agent that has not said anything yet.
 */
export class AgentAppReporting1700000000097 implements MigrationInterface {
  name = 'AgentAppReporting1700000000097';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent"
        ADD COLUMN IF NOT EXISTS "capabilities" jsonb,
        ADD COLUMN IF NOT EXISTS "app_build_id" character varying(64),
        ADD COLUMN IF NOT EXISTS "lan_urls" jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent"
        DROP COLUMN IF EXISTS "lan_urls",
        DROP COLUMN IF EXISTS "app_build_id",
        DROP COLUMN IF EXISTS "capabilities";
    `);
  }
}
