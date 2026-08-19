import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerAddressSchema1700000000034 implements MigrationInterface {
  name = 'AddCustomerAddressSchema1700000000034';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_address" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "title" character varying(80) NOT NULL,
        "address_text" text NOT NULL,
        "postal_code" character varying(20),
        "latitude" numeric(10, 7),
        "longitude" numeric(10, 7),
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" uuid,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_customer_address" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "IDX_customer_address_cust" ON "customer_address" ("tenant_id", "customer_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_address";`);
  }
}
