import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Card payments through the branch agent (docs/agent-gateway/agent-protocol.md §7.3–7.6).
 * A terminal records how the agent reaches it and which protocol driver talks to it; an
 * attempt remembers the command that carried it; and a payment whose outcome the terminal
 * never confirmed is flagged until someone checks it.
 */
export class AddAgentCardPayments1700000000059 implements MigrationInterface {
  name = 'AddAgentCardPayments1700000000059';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment_device"
        ADD COLUMN IF NOT EXISTS "agent_connection" jsonb,
        ADD COLUMN IF NOT EXISTS "agent_driver" character varying(32);
    `);
    await queryRunner.query(`ALTER TABLE "payment_attempt" ADD COLUMN IF NOT EXISTS "agent_command_id" uuid;`);
    await queryRunner.query(
      `ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "needs_terminal_check" boolean NOT NULL DEFAULT false;`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payment_needs_terminal_check" ON "payment" ("tenant_id") WHERE "needs_terminal_check";`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_needs_terminal_check";`);
    await queryRunner.query(`ALTER TABLE "payment" DROP COLUMN IF EXISTS "needs_terminal_check";`);
    await queryRunner.query(`ALTER TABLE "payment_attempt" DROP COLUMN IF EXISTS "agent_command_id";`);
    await queryRunner.query(`
      ALTER TABLE "payment_device"
        DROP COLUMN IF EXISTS "agent_driver",
        DROP COLUMN IF EXISTS "agent_connection";
    `);
  }
}
