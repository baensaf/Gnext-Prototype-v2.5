import { MigrationInterface, QueryRunner } from 'typeorm';

/** Commands for branch agents, kept until they are done (docs/agent-gateway/agent-protocol.md §4.4). */
export class AddAgentCommand1700000000057 implements MigrationInterface {
  name = 'AddAgentCommand1700000000057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_command" (
        "id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "type" character varying(64) NOT NULL,
        "payload" jsonb NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'QUEUED',
        "expects_result" boolean NOT NULL DEFAULT true,
        "entity_type" character varying(64),
        "entity_id" uuid,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "send_count" integer NOT NULL DEFAULT 0,
        "last_sent_at" TIMESTAMP WITH TIME ZONE,
        "agent_id" uuid,
        "acked_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "error_code" character varying(64),
        "error_message" text,
        "result_message_id" uuid,
        "result" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_agent_command_status" CHECK ("status" IN ('QUEUED', 'SENT', 'ACKED', 'DONE', 'FAILED', 'EXPIRED'))
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_command_branch_status" ON "agent_command" ("tenant_id", "branch_id", "status");`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_agent_command_entity" ON "agent_command" ("entity_type", "entity_id");`);
    // The delivery loop only ever looks at commands still waiting for the agent.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_command_pending" ON "agent_command" ("expires_at") WHERE "status" IN ('QUEUED', 'SENT');`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_command";`);
  }
}
