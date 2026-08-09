import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerExpandedSchema1700000000002 implements MigrationInterface {
  name = 'AddCustomerExpandedSchema1700000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_phone" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "phone_number" character varying(32) NOT NULL,
        "normalized_phone" character varying(32) NOT NULL,
        "label" character varying(32) NOT NULL DEFAULT 'MOBILE',
        "is_primary" boolean NOT NULL DEFAULT false,
        "is_verified" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_phone" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_phone_tenant_norm" ON "customer_phone" ("tenant_id", "normalized_phone");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "custom_field_definition" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "key" character varying(64) NOT NULL,
        "name" character varying(160) NOT NULL,
        "data_type" character varying(32) NOT NULL DEFAULT 'STRING',
        "is_required" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_custom_field_definition" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_custom_value" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "field_id" uuid NOT NULL,
        "value" text,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_custom_value" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_tag" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" character varying(64) NOT NULL,
        "color" character varying(16) NOT NULL DEFAULT '#3B82F6',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_tag" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_tag_link" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "tag_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_tag_link" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customer_tag_link" UNIQUE ("tenant_id", "customer_id", "tag_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_segment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" character varying(160) NOT NULL,
        "criteria_json" jsonb,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_segment" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_consent" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "consent_type" character varying(64) NOT NULL,
        "granted" boolean NOT NULL DEFAULT true,
        "granted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_consent" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_merge" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "target_customer_id" uuid NOT NULL,
        "source_customer_id" uuid NOT NULL,
        "field_resolutions_json" jsonb,
        "merged_by" uuid,
        "merged_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_merge" PRIMARY KEY ("id")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_merge";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_consent";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_segment";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_tag_link";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_tag";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_custom_value";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_field_definition";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customer_phone_tenant_norm";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_phone";`);
  }
}
