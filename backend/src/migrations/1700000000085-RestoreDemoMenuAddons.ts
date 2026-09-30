import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The demo menu's add-on groups come back (migration 068 archived them). The register no
 * longer asks about an optional group unless it is set to (migration 084), so a burger still
 * rings straight through, as HAMI's counter does; the cashier adds extras from the order line.
 *
 * The groups 068 archived are restored, or created where they never were, none asking at the
 * POS, and each is put on its categories, which pass it to every product in them. A combo's
 * drink is optional with cola ticked, so a combo too goes straight onto the order.
 *
 * Only the seeded demo tenant is touched, and only when it exists. The same groups are in
 * `IRANBURGER_OPTION_GROUPS` for a fresh seed; they are written out here so this migration
 * keeps doing what it did when the seed changes.
 */
export class RestoreDemoMenuAddons1700000000085 implements MigrationInterface {
  name = 'RestoreDemoMenuAddons1700000000085';

  /** The tenant the seed creates; see DEFAULT_TENANT_ID in src/seed.ts. */
  private readonly demoTenantId = 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';

  private readonly groups = [
    {
      code: 'IB-OPT-EXTRA',
      name: 'افزودنی',
      min: 0,
      max: 3,
      items: [
        ['IB-OPT-EXTRA-CHEESE', 'پنیر گودا اضافه', 600_000, false],
        ['IB-OPT-EXTRA-MUSHROOM', 'قارچ اضافه', 500_000, false],
        ['IB-OPT-EXTRA-BACON', 'بیکن گوشت', 900_000, false],
        ['IB-OPT-EXTRA-JALAPENO', 'هالوپینو', 300_000, false],
      ],
      categories: ['IB-BURGER', 'IB-SANDWICH'],
    },
    {
      code: 'IB-OPT-WITHOUT',
      name: 'بدون',
      min: 0,
      max: 4,
      items: [
        ['IB-OPT-NO-PICKLE', 'بدون خیارشور', 0, false],
        ['IB-OPT-NO-ONION', 'بدون پیاز', 0, false],
        ['IB-OPT-NO-TOMATO', 'بدون گوجه', 0, false],
        ['IB-OPT-NO-SAUCE', 'بدون سس', 0, false],
      ],
      categories: ['IB-BURGER', 'IB-SANDWICH', 'IB-MINI'],
    },
    {
      code: 'IB-OPT-COMBO-DRINK',
      name: 'نوشیدنی کمبو',
      min: 0,
      max: 1,
      items: [
        ['IB-OPT-DRINK-COLA', 'نوشابه مشکی', 0, true],
        ['IB-OPT-DRINK-LEMON', 'نوشابه لیمویی', 0, false],
        ['IB-OPT-DRINK-DOOGH', 'دوغ', 100_000, false],
      ],
      categories: ['IB-COMBO'],
    },
  ] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tenant = await queryRunner.query(`SELECT 1 FROM "tenant" WHERE "id" = $1`, [this.demoTenantId]);
    if (!tenant.length) return;
    const t = this.demoTenantId;

    for (const [groupIndex, g] of this.groups.entries()) {
      let [group] = await queryRunner.query(`SELECT "id" FROM "option_group" WHERE "tenant_id" = $1 AND "code" = $2`, [t, g.code]);
      if (group) {
        await queryRunner.query(
          `UPDATE "option_group" SET "deleted_at" = NULL, "name" = $2, "min_selection" = $3, "max_selection" = $4,
             "is_required" = $3 > 0, "prompt_at_pos" = false WHERE "id" = $1`,
          [group.id, g.name, g.min, g.max],
        );
      } else {
        [group] = await queryRunner.query(
          `INSERT INTO "option_group" ("tenant_id", "code", "name", "min_selection", "max_selection", "is_required", "prompt_at_pos")
           VALUES ($1, $2, $3, $4, $5, $4 > 0, false) RETURNING "id"`,
          [t, g.code, g.name, g.min, g.max],
        );
      }

      for (const [itemIndex, [code, name, price, isDefault]] of g.items.entries()) {
        const [item] = await queryRunner.query(`SELECT "id" FROM "option_item" WHERE "tenant_id" = $1 AND "code" = $2`, [t, code]);
        if (item) {
          await queryRunner.query(
            `UPDATE "option_item" SET "deleted_at" = NULL, "option_group_id" = $2, "is_default" = $3, "sort_order" = $4 WHERE "id" = $1`,
            [item.id, group.id, isDefault, itemIndex],
          );
        } else {
          await queryRunner.query(
            `INSERT INTO "option_item" ("tenant_id", "option_group_id", "code", "name", "price_delta", "is_default", "sort_order")
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [t, group.id, code, name, price, isDefault, itemIndex],
          );
        }
      }

      for (const categoryCode of g.categories) {
        const [category] = await queryRunner.query(
          `SELECT "id" FROM "category" WHERE "tenant_id" = $1 AND "code" = $2 AND "deleted_at" IS NULL`,
          [t, categoryCode],
        );
        if (!category) continue;
        await queryRunner.query(
          `INSERT INTO "category_option_group" ("tenant_id", "category_id", "option_group_id") VALUES ($1, $2, $3)
           ON CONFLICT ("tenant_id", "category_id", "option_group_id") DO NOTHING`,
          [t, category.id, group.id],
        );
        await queryRunner.query(
          `INSERT INTO "product_option_group" ("tenant_id", "product_id", "option_group_id", "from_category_id", "sort_order")
           SELECT $1, p."id", $2, $3, $4 FROM "product" p
           WHERE p."tenant_id" = $1 AND p."category_id" = $3 AND p."deleted_at" IS NULL
             AND NOT EXISTS (SELECT 1 FROM "product_option_group" l WHERE l."product_id" = p."id" AND l."option_group_id" = $2)`,
          [t, group.id, category.id, groupIndex],
        );
      }
    }
  }

  /** Off the menu again, as 068 left it: links removed, groups and items archived. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const codes = this.groups.map((g) => g.code);
    const ids = `SELECT "id" FROM "option_group" WHERE "tenant_id" = $1 AND "code" = ANY($2)`;
    await queryRunner.query(`DELETE FROM "product_option_group" WHERE "tenant_id" = $1 AND "option_group_id" IN (${ids})`, [this.demoTenantId, codes]);
    await queryRunner.query(`DELETE FROM "category_option_group" WHERE "tenant_id" = $1 AND "option_group_id" IN (${ids})`, [this.demoTenantId, codes]);
    await queryRunner.query(`UPDATE "option_item" SET "deleted_at" = now() WHERE "tenant_id" = $1 AND "option_group_id" IN (${ids})`, [this.demoTenantId, codes]);
    await queryRunner.query(`UPDATE "option_group" SET "deleted_at" = now() WHERE "tenant_id" = $1 AND "code" = ANY($2)`, [this.demoTenantId, codes]);
  }
}
