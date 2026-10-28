import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A live Snappfood connection (2026-10-28): the chain's webhook address and each branch's
 * vendor code and API account. See SnappfoodConnection.
 */
export class SnappfoodConnection1700000000140 implements MigrationInterface {
  name = 'SnappfoodConnection1700000000140';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "snappfood_webhook" (
        "tenant_id" uuid PRIMARY KEY,
        "token" varchar(64) NOT NULL,
        "hmac_secret" varchar(200),
        "last_received_at" TIMESTAMP WITH TIME ZONE,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_snappfood_webhook_token" ON "snappfood_webhook" ("token")`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "snappfood_connection" (
        "branch_id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "mode" varchar(16) NOT NULL DEFAULT 'SIMULATED',
        "vendor_code" varchar(40),
        "client_id" varchar(120),
        "client_secret" varchar(200),
        "username" varchar(120),
        "password" varchar(200),
        "access_token" text,
        "token_expires_at" TIMESTAMP WITH TIME ZONE,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_snappfood_connection_vendor" ON "snappfood_connection" ("tenant_id", "vendor_code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "snappfood_connection"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "snappfood_webhook"`);
  }
}
