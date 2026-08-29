import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBranchOperatingHourSchema1700000000042 implements MigrationInterface {
  name = 'CreateBranchOperatingHourSchema1700000000042';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "branch_operating_hour" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "day_of_week" smallint NOT NULL,
        "open_time" time,
        "close_time" time,
        "is_closed" boolean NOT NULL DEFAULT false,
        "spans_midnight" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" uuid,
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "uq_branch_operating_hour_tenant_branch_day" UNIQUE ("tenant_id", "branch_id", "day_of_week")
      );
      CREATE INDEX IF NOT EXISTS "idx_branch_operating_hour_tenant_branch" ON "branch_operating_hour" ("tenant_id", "branch_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "branch_operating_hour" CASCADE;`);
  }
}
