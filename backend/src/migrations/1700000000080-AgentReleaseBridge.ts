import { MigrationInterface, QueryRunner } from 'typeorm';

/** The Saman bridge CI builds with each agent release, which agents install with it (§9.3). */
export class AgentReleaseBridge1700000000080 implements MigrationInterface {
  name = 'AgentReleaseBridge1700000000080';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent_release"
        ADD COLUMN IF NOT EXISTS "bridge_path" character varying(255),
        ADD COLUMN IF NOT EXISTS "bridge_sha256" character varying(64),
        ADD COLUMN IF NOT EXISTS "bridge_size_bytes" bigint;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent_release"
        DROP COLUMN IF EXISTS "bridge_size_bytes",
        DROP COLUMN IF EXISTS "bridge_sha256",
        DROP COLUMN IF EXISTS "bridge_path";
    `);
  }
}
