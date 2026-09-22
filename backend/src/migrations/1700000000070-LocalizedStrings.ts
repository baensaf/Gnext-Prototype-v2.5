import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Translated names for catalogue records (a product's English name beside its Persian one).
 * The entity and the /localization API shipped without their table, so every read and the
 * translation import failed with "relation localized_string does not exist".
 */
export class LocalizedStrings1700000000070 implements MigrationInterface {
  name = 'LocalizedStrings1700000000070';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "localized_string" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "entity_type" character varying(60) NOT NULL,
        "entity_id" uuid NOT NULL,
        "field_name" character varying(60) NOT NULL,
        "locale" character varying(10) NOT NULL,
        "text_value" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_localized_string" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_localized_string_field" UNIQUE ("tenant_id", "entity_type", "entity_id", "field_name", "locale")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "localized_string";`);
  }
}
