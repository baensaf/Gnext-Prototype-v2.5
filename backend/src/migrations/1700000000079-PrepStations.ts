import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One prep station for the kitchen screens and the kitchen printers.
 *
 * Until now a kitchen chit found its printer through print routes (product, category, KDS
 * station or catch-all selectors, scored, with priorities) that pointed at printer groups,
 * while the kitchen screen found its station through the KDS routing rules. Two answers to
 * "where does the burger go", kept apart.
 *
 * From here the KDS rule is the only answer: a product's station, else its category's. The
 * station carries its printers, its copies and its paper. A receipt, a guest bill and a courier
 * slip print at the till the order was taken on, and without one at the branch's receipt
 * printer, so a two-till branch no longer sends both tills' receipts to one printer.
 *
 * The old routes and groups are dropped, not converted: only demo data used them. A branch
 * whose stations have no printers yet still prints, on its kitchen printer, as a branch with no
 * routes did before.
 */
export class PrepStations1700000000079 implements MigrationInterface {
  name = 'PrepStations1700000000079';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kitchen_station"
        ADD COLUMN IF NOT EXISTS "printer_ids" uuid[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS "copies" integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "ticket_template" varchar(16) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "terminal"
        ADD COLUMN IF NOT EXISTS "receipt_printer_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "receipt_copies" integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "receipt_template" varchar(16) NULL
    `);

    // A print job remembers the station it was for, so a retry reaches that station's printers.
    await queryRunner.query(`ALTER TABLE "print_job" RENAME COLUMN "printer_group_id" TO "station_id"`);
    await queryRunner.query(`UPDATE "print_job" SET "station_id" = NULL`);

    // One station per product and per category in a branch. Of rules that said otherwise, the
    // one that used to win (highest priority, then newest) is kept.
    await queryRunner.query(`
      UPDATE "kds_routing_rule" r SET "deleted_at" = now()
        FROM (
          SELECT "id", row_number() OVER (
            PARTITION BY "tenant_id", "branch_id", COALESCE("product_id", "category_id"), ("product_id" IS NULL)
            ORDER BY "priority" DESC, "created_at" DESC
          ) AS rank
          FROM "kds_routing_rule" WHERE "deleted_at" IS NULL
        ) ranked
       WHERE r."id" = ranked."id" AND ranked.rank > 1
    `);
    await queryRunner.query(`ALTER TABLE "kds_routing_rule" DROP COLUMN IF EXISTS "priority"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_kds_routing_rule_product"
        ON "kds_routing_rule" ("tenant_id", "branch_id", "product_id")
        WHERE "product_id" IS NOT NULL AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_kds_routing_rule_category"
        ON "kds_routing_rule" ("tenant_id", "branch_id", "category_id")
        WHERE "category_id" IS NOT NULL AND "deleted_at" IS NULL
    `);

    // A station's printers are in the branch snapshot (protocol §13.11).
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_agent_data_notify" ON "kitchen_station"`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_agent_data_notify"
      AFTER INSERT OR UPDATE OR DELETE ON "kitchen_station"
      FOR EACH ROW EXECUTE FUNCTION gnext_live_notify('agent-data')
    `);

    for (const table of ['print_route', 'printer_group_member', 'printer_group']) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_agent_data_notify" ON "${table}"`);
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
    await queryRunner.query(`DROP FUNCTION IF EXISTS gnext_agent_data_notify_group_member()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The routes and groups come back empty; the stations' printers are not turned back into them.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "printer_group" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "code" varchar(32) NOT NULL,
        "name" varchar(160) NOT NULL,
        "ticket_template" varchar(16) NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_printer_group" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "printer_group_member" (
        "group_id" uuid NOT NULL,
        "printer_id" uuid NOT NULL,
        "priority" integer NOT NULL DEFAULT 0,
        "copies" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_printer_group_member" PRIMARY KEY ("group_id", "printer_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "print_route" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "document_type" varchar(64) NOT NULL,
        "product_id" uuid NULL,
        "category_id" uuid NULL,
        "station_id" uuid NULL,
        "printer_group_id" uuid NOT NULL,
        "priority" integer NOT NULL DEFAULT 0,
        "copies" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_print_route" PRIMARY KEY ("id")
      )
    `);
    for (const table of ['print_route', 'printer_group']) {
      await queryRunner.query(`
        CREATE TRIGGER "trg_agent_data_notify"
        AFTER INSERT OR UPDATE OR DELETE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION gnext_live_notify('agent-data')
      `);
    }
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_agent_data_notify" ON "kitchen_station"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_kds_routing_rule_category"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_kds_routing_rule_product"`);
    await queryRunner.query(`ALTER TABLE "kds_routing_rule" ADD COLUMN IF NOT EXISTS "priority" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "print_job" RENAME COLUMN "station_id" TO "printer_group_id"`);
    await queryRunner.query(`
      ALTER TABLE "terminal"
        DROP COLUMN IF EXISTS "receipt_template",
        DROP COLUMN IF EXISTS "receipt_copies",
        DROP COLUMN IF EXISTS "receipt_printer_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "kitchen_station"
        DROP COLUMN IF EXISTS "ticket_template",
        DROP COLUMN IF EXISTS "copies",
        DROP COLUMN IF EXISTS "printer_ids"
    `);
  }
}
