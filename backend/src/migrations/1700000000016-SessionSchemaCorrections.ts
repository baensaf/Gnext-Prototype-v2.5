import { MigrationInterface, QueryRunner } from 'typeorm';

export class SessionSchemaCorrections1700000000016 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "session"
      ALTER COLUMN "token" DROP NOT NULL,
      ALTER COLUMN "tenant_id" DROP NOT NULL,
      ADD COLUMN IF NOT EXISTS "token_hash" char(64),
      ADD COLUMN IF NOT EXISTS "csrf_hash" char(64),
      ADD COLUMN IF NOT EXISTS "last_seen_at" timestamptz DEFAULT now(),
      ADD COLUMN IF NOT EXISTS "ip" varchar(45);
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_session_token_hash" ON "session" ("token_hash");
    `);

    await queryRunner.query(`
      ALTER TABLE "kitchen_ticket"
      ADD COLUMN IF NOT EXISTS "ticket_number" varchar(32);
    `);

    await queryRunner.query(`
      ALTER TABLE "courier"
      ADD COLUMN IF NOT EXISTS "branch_id" uuid;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "session"
      DROP COLUMN IF EXISTS "token_hash",
      DROP COLUMN IF EXISTS "csrf_hash",
      DROP COLUMN IF EXISTS "last_seen_at",
      DROP COLUMN IF EXISTS "ip";
    `);
  }
}
