import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPriceEntryAndPricingSchema1700000000001 implements MigrationInterface {
  name = 'AddPriceEntryAndPricingSchema1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "price_group_branch" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "price_group_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_group_branch" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_price_group_branch_tenant_branch" UNIQUE ("tenant_id", "branch_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "price_entry" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "variant_id" uuid,
        "modifier_option_id" uuid,
        "price_group_id" uuid,
        "branch_id" uuid,
        "channel" character varying(32),
        "order_type" character varying(32),
        "currency_code" character(3) NOT NULL DEFAULT 'IRR',
        "price_type" character varying(32) NOT NULL DEFAULT 'BASE',
        "amount" numeric(19,4) NOT NULL,
        "effective_from" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "effective_to" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        CONSTRAINT "PK_price_entry" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_price_entry_tenant_prod_eff" ON "price_entry" ("tenant_id", "product_id", "effective_from");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "price_bulk_job" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'COMPLETED',
        "params" jsonb,
        "affected_rows" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        CONSTRAINT "PK_price_bulk_job" PRIMARY KEY ("id")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "price_bulk_job";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_price_entry_tenant_prod_eff";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "price_entry";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "price_group_branch";`);
  }
}
