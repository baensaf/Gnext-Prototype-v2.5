import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tara comes back as a way to pay at the till (2026-10-15, V3), following Tara's in-store
 * purchase API: login, a token per terminal, product groups, then trace → request → verify,
 * reverse and inquiry for each sale.
 *
 * - `tara_connection`: the chain's Tara account, its token, Tara's product groups and which
 *   group each menu category is sent under.
 * - `tara_branch`: the branch code Tara gave each branch.
 * - `tara_terminal`: Tara's terminals for a branch, with their long-lived tokens, each given
 *   to one till.
 * - `tara_purchase`: Gnext's side of one Tara sale, one row per payment, with the call that
 *   got no answer while the sweep sorts it out.
 * - `tara_sim_purchase`: the simulated Tara server's own record of each sale. Nothing in Gnext
 *   reads it except the simulator.
 */
export class TaraPay1700000000133 implements MigrationInterface {
  name = 'TaraPay1700000000133';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tara_connection" (
        "tenant_id" uuid PRIMARY KEY,
        "username" varchar(120) NOT NULL,
        "password" varchar(200) NOT NULL,
        "access_code" text,
        "connected_at" timestamptz,
        "groups" jsonb NOT NULL DEFAULT '[]',
        "default_group_id" bigint,
        "category_groups" jsonb NOT NULL DEFAULT '{}',
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE TABLE "tara_branch" (
        "branch_id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "branch_code" varchar(40) NOT NULL,
        "terminals_fetched_at" timestamptz,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE TABLE "tara_terminal" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "terminal_code" varchar(40) NOT NULL,
        "terminal_title" varchar(160),
        "merchant_code" varchar(40),
        "access_code" text NOT NULL,
        "register_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_tara_terminal_code" UNIQUE ("tenant_id", "terminal_code")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tara_terminal_register" ON "tara_terminal" ("register_id") WHERE "register_id" IS NOT NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE "tara_purchase" (
        "payment_id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "terminal_code" varchar(40) NOT NULL,
        "barcode" varchar(64) NOT NULL,
        "mobile" varchar(20),
        "trace_number" varchar(40),
        "reference_number" varchar(40),
        "step" varchar(16) NOT NULL DEFAULT 'TRACE',
        "awaiting" varchar(16),
        "unanswered_since" timestamptz,
        "next_check_at" timestamptz,
        "checks" integer NOT NULL DEFAULT 0,
        "stuck" boolean NOT NULL DEFAULT false,
        "reversed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_tara_purchase_awaiting" ON "tara_purchase" ("next_check_at") WHERE "awaiting" IS NOT NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE "tara_sim_purchase" (
        "trace_number" varchar(40) PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "terminal_code" varchar(40) NOT NULL,
        "barcode" varchar(64) NOT NULL,
        "mobile" varchar(20),
        "amount" bigint NOT NULL,
        "reference_number" varchar(40),
        "invoice" jsonb,
        "status" varchar(16) NOT NULL DEFAULT 'TRACED',
        "track" jsonb NOT NULL DEFAULT '[]',
        "dropped" jsonb NOT NULL DEFAULT '[]',
        "held_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_tara_sim_reference" ON "tara_sim_purchase" ("reference_number")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['tara_sim_purchase', 'tara_purchase', 'tara_terminal', 'tara_branch', 'tara_connection']) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
