import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Electronic invoices for the Moadian tax system. One row per invoice sent or to be sent:
 * the original for a completed sale, and the cancellation or return that points back at
 * it through reference_tax_id.
 */
export class AddTaxInvoice1700000000049 implements MigrationInterface {
  name = 'AddTaxInvoice1700000000049';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tax_invoice" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid,
        "order_id" uuid NOT NULL,
        "order_number" character varying(50),
        "refund_id" uuid,
        "subject" smallint NOT NULL,
        "tax_id" character varying(22) NOT NULL,
        "serial" integer NOT NULL,
        "reference_tax_id" character varying(22),
        "status" character varying(20) NOT NULL DEFAULT 'QUEUED',
        "reference_number" character varying(64),
        "total_amount" numeric(18,4) NOT NULL DEFAULT 0,
        "vat_amount" numeric(18,4) NOT NULL DEFAULT 0,
        "payload" jsonb NOT NULL,
        "errors" jsonb,
        "attempts" integer NOT NULL DEFAULT 0,
        "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "sent_at" TIMESTAMP WITH TIME ZONE,
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tax_invoice" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tax_invoice_tenant_tax_id" UNIQUE ("tenant_id", "tax_id")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tax_invoice_tenant_status" ON "tax_invoice" ("tenant_id", "status");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tax_invoice_tenant_order" ON "tax_invoice" ("tenant_id", "order_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tax_invoice";`);
  }
}
