import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Personal discounts come in groups head office sets (2026-10-16), from Iran Burger's staff
 * scheme: a percent, a monthly cap on how much of their orders it covers, uses a month, a cap
 * per order, and whether it works at any branch or only the person's own. Every chain gets the
 * scheme's nine groups. Each person is in one group now, so a person with rates at several
 * branches keeps the newest; a rate given before groups becomes a group of its own percent,
 * with no limits, so nobody's discount changes.
 */
export class PersonalDiscountGroups1700000000137 implements MigrationInterface {
  name = 'PersonalDiscountGroups1700000000137';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "personal_discount_group" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "percent" numeric(5,2) NOT NULL,
        "monthly_cap" numeric(19,4),
        "uses_per_month" int,
        "per_visit_cap" numeric(19,4),
        "any_branch" boolean NOT NULL DEFAULT false,
        "sort_order" int NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_personal_discount_group" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_personal_discount_group_tenant" ON "personal_discount_group" ("tenant_id", "is_active")`,
    );
    await queryRunner.query(`ALTER TABLE "customer_discount" ADD COLUMN IF NOT EXISTS "group_id" uuid`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "customer_discount" ADD CONSTRAINT "FK_customer_discount_group"
          FOREIGN KEY ("group_id") REFERENCES "personal_discount_group"("id");
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // The scheme's nine groups, amounts in Rial (the sheet says Toman).
    await queryRunner.query(`
      INSERT INTO "personal_discount_group"
        ("tenant_id", "name", "percent", "monthly_cap", "uses_per_month", "per_visit_cap", "any_branch", "sort_order")
      SELECT t.id, g.name, g.percent, g.monthly_cap, g.uses, g.per_visit, g.any_branch, g.sort_order
        FROM "tenant" t
       CROSS JOIN (VALUES
         ('صاحبان مجموعه', 35.00, NULL::numeric, NULL::int, NULL::numeric, true, 1),
         ('معاونین مرکزی و سرمایه‌گذاران', 35.00, 100000000, 4, 25000000, false, 2),
         ('بازرسان بهداشت، کیفی و دیسیپلین', 35.00, 80000000, 4, 20000000, true, 3),
         ('مدیران دفتر مرکزی و مدیران شعب با سابقه بالای ۳ سال', 30.00, 80000000, 4, 20000000, true, 4),
         ('کارشناسان دفتر مرکزی', 30.00, 70000000, 4, 17500000, false, 5),
         ('مدیران شعب با سابقه ۱ تا ۳ سال', 30.00, 60000000, 4, 15000000, false, 6),
         ('مدیران شعب با سابقه کمتر از ۱ سال', 25.00, 50000000, 4, 12500000, false, 7),
         ('کارکنان شعب با سابقه بیش از ۱ سال', 25.00, 50000000, 4, 12500000, false, 8),
         ('کارکنان شعب با سابقه کمتر از ۱ سال و پیک‌ها', 25.00, 30000000, 4, 7500000, false, 9)
       ) AS g(name, percent, monthly_cap, uses, per_visit, any_branch, sort_order)
       WHERE NOT EXISTS (SELECT 1 FROM "personal_discount_group" x WHERE x.tenant_id = t.id)
    `);

    // One person, one rate: the newest stays.
    await queryRunner.query(`
      UPDATE "customer_discount" cd SET "is_active" = false
       WHERE cd.is_active AND cd.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM "customer_discount" n
            WHERE n.tenant_id = cd.tenant_id AND n.customer_id = cd.customer_id
              AND n.is_active AND n.deleted_at IS NULL
              AND (n.created_at, n.id) > (cd.created_at, cd.id))
    `);

    // A rate from before groups keeps its percent, in a group of its own with no limits.
    await queryRunner.query(`
      INSERT INTO "personal_discount_group" ("tenant_id", "name", "percent", "any_branch", "sort_order")
      SELECT DISTINCT cd.tenant_id, 'تخفیف اختصاصی ' || trim(trailing '.' from trim(trailing '0' from cd.discount_percentage::text)) || '٪',
             cd.discount_percentage, false, 100
        FROM "customer_discount" cd
       WHERE cd.is_active AND cd.deleted_at IS NULL AND cd.group_id IS NULL
    `);
    await queryRunner.query(`
      UPDATE "customer_discount" cd SET "group_id" = g.id
        FROM "personal_discount_group" g
       WHERE cd.group_id IS NULL AND cd.is_active AND cd.deleted_at IS NULL
         AND g.tenant_id = cd.tenant_id AND g.sort_order = 100 AND g.percent = cd.discount_percentage
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "customer_discount" DROP CONSTRAINT IF EXISTS "FK_customer_discount_group"`);
    await queryRunner.query(`ALTER TABLE "customer_discount" DROP COLUMN IF EXISTS "group_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "personal_discount_group"`);
  }
}
