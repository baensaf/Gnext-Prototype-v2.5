import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Kitchen printing without prep stations, and no kitchen screen.
 *
 * No restaurant in Iran runs a kitchen screen, and with the screen gone a station was only a
 * name between a category and a printer. Now a branch sets up its printers and sends categories
 * or single products to them, as HAMI does: `print_route` says which printers print what, a
 * product's own routes beat its category's, and anything else prints on the one printer the
 * branch marks as its default kitchen printer.
 *
 * Each station's routing rules become routes to every printer the station had. A station with
 * no printers printed on the branch's kitchen printer, which is what the default now does, so
 * its rules are dropped. The first kitchen printer of each branch, by code, becomes its default:
 * the printer the old fallback picked.
 *
 * The kitchen screen's tables go with the stations: tickets, their lines, their events, the
 * screens and the routing rules. Only demo data used them.
 */
export class PrintersWithoutStations1700000000101 implements MigrationInterface {
  name = 'PrintersWithoutStations1700000000101';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "print_route" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "printer_id" uuid NOT NULL,
        "category_id" uuid NULL,
        "product_id" uuid NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_print_route_target" CHECK (("category_id" IS NULL) <> ("product_id" IS NULL))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_print_route_category" ON "print_route" ("printer_id", "category_id") WHERE "category_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_print_route_product" ON "print_route" ("printer_id", "product_id") WHERE "product_id" IS NOT NULL`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_print_route_branch" ON "print_route" ("tenant_id", "branch_id")`);

    await queryRunner.query(`ALTER TABLE "printer" ADD COLUMN IF NOT EXISTS "kitchen_default" boolean NOT NULL DEFAULT false`);

    const hasStations = await queryRunner.hasTable('kitchen_station');
    if (hasStations && (await queryRunner.hasTable('kds_routing_rule'))) {
      await queryRunner.query(`
        INSERT INTO "print_route" ("tenant_id", "branch_id", "printer_id", "category_id", "product_id")
        SELECT DISTINCT r."tenant_id", r."branch_id", p."id",
               CASE WHEN r."product_id" IS NULL THEN r."category_id" END,
               r."product_id"
          FROM "kds_routing_rule" r
          JOIN "kitchen_station" s ON s."id" = r."station_id" AND s."deleted_at" IS NULL AND s."is_active"
          CROSS JOIN LATERAL unnest(s."printer_ids") AS sp("printer_id")
          JOIN "printer" p ON p."id" = sp."printer_id" AND p."deleted_at" IS NULL
         WHERE r."deleted_at" IS NULL
           AND (r."product_id" IS NOT NULL OR r."category_id" IS NOT NULL)
        ON CONFLICT DO NOTHING
      `);
    }

    await queryRunner.query(`
      UPDATE "printer" p SET "kitchen_default" = true
        FROM (
          SELECT DISTINCT ON ("tenant_id", "branch_id") "id"
            FROM "printer"
           WHERE "deleted_at" IS NULL AND "is_active" AND upper("printer_type") LIKE 'KITCHEN%'
           ORDER BY "tenant_id", "branch_id", "code", "id"
        ) first
       WHERE p."id" = first."id"
    `);

    await queryRunner.query(`ALTER TABLE "print_job" DROP COLUMN IF EXISTS "station_id"`);

    for (const table of ['kds_event', 'kitchen_ticket_item', 'kitchen_ticket', 'kds_screen', 'kds_routing_rule', 'kitchen_station']) {
      if (await queryRunner.hasTable(table)) {
        await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_agent_data_notify" ON "${table}"`);
        await queryRunner.query(`DROP TABLE "${table}" CASCADE`);
      }
    }
    await queryRunner.query(`UPDATE "terminal" SET "deleted_at" = now() WHERE upper("terminal_type") = 'KDS' AND "deleted_at" IS NULL`);
  }

  public async down(): Promise<void> {
    // The kitchen screen and the stations are gone for good; the demo data they held is not kept.
  }
}
