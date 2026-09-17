import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How the branch agent reaches a printer (protocol §6.1). A printer without one keeps
 * printing on the simulator. Each print attempt remembers the agent command that carried it.
 */
export class AddPrinterAgentConnection1700000000058 implements MigrationInterface {
  name = 'AddPrinterAgentConnection1700000000058';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "printer" ADD COLUMN IF NOT EXISTS "agent_connection" jsonb;`);
    await queryRunner.query(`ALTER TABLE "print_attempt" ADD COLUMN IF NOT EXISTS "agent_command_id" uuid;`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_print_attempt_agent_command" ON "print_attempt" ("agent_command_id") WHERE "agent_command_id" IS NOT NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_print_attempt_agent_command";`);
    await queryRunner.query(`ALTER TABLE "print_attempt" DROP COLUMN IF EXISTS "agent_command_id";`);
    await queryRunner.query(`ALTER TABLE "printer" DROP COLUMN IF EXISTS "agent_connection";`);
  }
}
