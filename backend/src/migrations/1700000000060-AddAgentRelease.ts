import { MigrationInterface, QueryRunner } from 'typeorm';

/** Builds of the branch agent that agents download (docs/agent-gateway/agent-protocol.md §9). */
export class AddAgentRelease1700000000060 implements MigrationInterface {
  name = 'AddAgentRelease1700000000060';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_release" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "version" character varying(32) NOT NULL,
        "sha256" character varying(64) NOT NULL,
        "size_bytes" bigint NOT NULL,
        "file_path" character varying(255) NOT NULL,
        "notes" text,
        "min_agent_version" character varying(32),
        "published_at" TIMESTAMP WITH TIME ZONE,
        "uploaded_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_agent_release_version" UNIQUE ("version")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_release";`);
  }
}
