import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customer groups and group discounts (2026-10-16), replacing yesterday's personal discount
 * groups: a group is a list of people (a customer can be in several), and a group discount
 * picks the groups it covers. Each personal discount group becomes a group and a discount of
 * the same id, so orders already given it keep counting against this month; each person in
 * one becomes a member, at the branch they work at. The old personal_discount_group table and
 * customer_discount rows are left in place, unused.
 */
export class CustomerGroups1700000000138 implements MigrationInterface {
  name = 'CustomerGroups1700000000138';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_group" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "kind" varchar(16) NOT NULL DEFAULT 'MANUAL',
        "branch_can_assign" boolean NOT NULL DEFAULT false,
        "sort_order" int NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_group" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_customer_group_tenant" ON "customer_group" ("tenant_id", "is_active")`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_group_member" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "group_id" uuid NOT NULL REFERENCES "customer_group"("id") ON DELETE CASCADE,
        "customer_id" uuid NOT NULL REFERENCES "customer"("id") ON DELETE CASCADE,
        "branch_id" uuid,
        "note" text,
        "created_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_group_member" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customer_group_member" ON "customer_group_member" ("group_id", "customer_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_customer_group_member_customer" ON "customer_group_member" ("tenant_id", "customer_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "group_discount" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "percent" numeric(5,2) NOT NULL,
        "group_ids" uuid[] NOT NULL DEFAULT '{}',
        "own_branch_only" boolean NOT NULL DEFAULT false,
        "monthly_cap" numeric(19,4),
        "uses_per_month" int,
        "per_visit_cap" numeric(19,4),
        "sort_order" int NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_group_discount" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_group_discount_tenant" ON "group_discount" ("tenant_id", "is_active")`);

    // Each personal discount group: a group (branches add people to the own-branch ones) and
    // a discount of the same id covering it.
    await queryRunner.query(`
      INSERT INTO "customer_group" ("id", "tenant_id", "name", "branch_can_assign", "sort_order", "is_active")
      SELECT p.id, p.tenant_id, p.name, NOT p.any_branch, p.sort_order, p.is_active
        FROM "personal_discount_group" p
       WHERE NOT EXISTS (SELECT 1 FROM "customer_group" g WHERE g.id = p.id)
    `);
    await queryRunner.query(`
      INSERT INTO "group_discount"
        ("id", "tenant_id", "name", "percent", "group_ids", "own_branch_only", "monthly_cap", "uses_per_month", "per_visit_cap", "sort_order", "is_active")
      SELECT p.id, p.tenant_id, p.name, p.percent, ARRAY[p.id], NOT p.any_branch, p.monthly_cap, p.uses_per_month, p.per_visit_cap, p.sort_order, p.is_active
        FROM "personal_discount_group" p
       WHERE NOT EXISTS (SELECT 1 FROM "group_discount" d WHERE d.id = p.id)
    `);
    await queryRunner.query(`
      INSERT INTO "customer_group_member" ("tenant_id", "group_id", "customer_id", "branch_id", "note", "created_by", "created_at")
      SELECT cd.tenant_id, cd.group_id, cd.customer_id, cd.branch_id, cd.note, cd.created_by, cd.created_at
        FROM "customer_discount" cd
        JOIN "customer_group" g ON g.id = cd.group_id
       WHERE cd.is_active AND cd.deleted_at IS NULL
      ON CONFLICT ("group_id", "customer_id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "group_discount"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_group_member"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_group"`);
  }
}
