import { MigrationInterface, QueryRunner } from 'typeorm';

/** The setup wizard CI builds with each agent release, for head office to download. */
export class AgentReleaseInstaller1700000000069 implements MigrationInterface {
  name = 'AgentReleaseInstaller1700000000069';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent_release"
        ADD COLUMN IF NOT EXISTS "installer_path" character varying(255),
        ADD COLUMN IF NOT EXISTS "installer_sha256" character varying(64),
        ADD COLUMN IF NOT EXISTS "installer_size_bytes" bigint;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent_release"
        DROP COLUMN IF EXISTS "installer_size_bytes",
        DROP COLUMN IF EXISTS "installer_sha256",
        DROP COLUMN IF EXISTS "installer_path";
    `);
  }
}
