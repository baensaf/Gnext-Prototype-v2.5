import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Branch agents and the one-time codes that enrol them (docs/agent-gateway/agent-protocol.md
 * §3). One active agent per branch; revoked agents stay for the record.
 */
export class AddAgentRegistry1700000000056 implements MigrationInterface {
  name = 'AddAgentRegistry1700000000056';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "key_hash" character varying(64) NOT NULL,
        "agent_version" character varying(32),
        "protocol_version" integer,
        "hostname" character varying(128),
        "os" character varying(128),
        "machine_id" character varying(64),
        "enrolment_code_id" uuid,
        "enrolled_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "last_seen_at" TIMESTAMP WITH TIME ZONE,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "revoked_by" uuid,
        "revoke_reason" character varying(255),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_agent_key_hash" UNIQUE ("key_hash"),
        CONSTRAINT "CHK_agent_status" CHECK ("status" IN ('ACTIVE', 'REVOKED'))
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_agent_active_branch" ON "agent" ("branch_id") WHERE "status" = 'ACTIVE';
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_agent_tenant" ON "agent" ("tenant_id", "branch_id");`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_enrolment_code" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "code_hash" character varying(64) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "used_at" TIMESTAMP WITH TIME ZONE,
        "agent_id" uuid,
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_agent_enrolment_code_hash" UNIQUE ("code_hash")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_enrolment_code_tenant" ON "agent_enrolment_code" ("tenant_id", "branch_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_enrolment_code";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent";`);
  }
}
