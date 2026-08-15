import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductVariantSchema1700000000028 implements MigrationInterface {
  name = 'AddProductVariantSchema1700000000028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_variant" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "sku" character varying(64),
        "barcode" character varying(64),
        "name" character varying(160) NOT NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "base_price" numeric(19,4) NOT NULL DEFAULT '0.0000',
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" uuid,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_product_variant" PRIMARY KEY ("id"),
        CONSTRAINT "FK_product_variant_product" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS "IDX_product_variant_tenant_prod" 
        ON "product_variant" ("tenant_id", "product_id", "is_active");

      CREATE INDEX IF NOT EXISTS "IDX_product_variant_tenant_prod_code" 
        ON "product_variant" ("tenant_id", "product_id", "code");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "product_variant";`);
  }
}
