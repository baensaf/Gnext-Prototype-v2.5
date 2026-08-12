import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerDiscountSchema1700000000027 implements MigrationInterface {
  name = 'AddCustomerDiscountSchema1700000000027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_discount" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "discount_percentage" numeric(5,2) NOT NULL,
        "effective_from" TIMESTAMP WITH TIME ZONE,
        "effective_to" TIMESTAMP WITH TIME ZONE,
        "is_active" boolean NOT NULL DEFAULT true,
        "note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" uuid,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_customer_discount" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "IDX_customer_discount_tenant_cust" 
        ON "customer_discount" ("tenant_id", "customer_id", "is_active");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_discount";`);
  }
}
