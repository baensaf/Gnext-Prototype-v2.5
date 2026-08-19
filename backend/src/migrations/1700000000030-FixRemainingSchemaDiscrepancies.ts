import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixRemainingSchemaDiscrepancies1700000000030 implements MigrationInterface {
  name = 'FixRemainingSchemaDiscrepancies1700000000030';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. order_item_option schema fixes
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'order_item_option' AND column_name = 'option_name'
        ) THEN
          ALTER TABLE "order_item_option" ALTER COLUMN "option_name" DROP NOT NULL;
        END IF;
      END $$;
    `);

    // 2. refund_allocation schema fixes
    await queryRunner.query(`
      ALTER TABLE "refund_allocation"
        ADD COLUMN IF NOT EXISTS "refund_request_id" uuid,
        ADD COLUMN IF NOT EXISTS "payment_method_id" uuid,
        ADD COLUMN IF NOT EXISTS "original_payment_id" uuid,
        ADD COLUMN IF NOT EXISTS "amount_refunded" numeric(19, 4);
    `);

    // 3. Create import_row table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "import_row" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "job_id" uuid NOT NULL,
        "row_number" int NOT NULL,
        "raw_data" jsonb NOT NULL,
        "parsed_data" jsonb,
        "status" character varying(20) NOT NULL DEFAULT 'STAGED',
        "errors" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_import_row" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "IDX_import_row_job" ON "import_row" ("job_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "import_row";`);
  }
}
