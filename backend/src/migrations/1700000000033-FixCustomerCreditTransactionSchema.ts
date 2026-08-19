import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixCustomerCreditTransactionSchema1700000000033 implements MigrationInterface {
  name = 'FixCustomerCreditTransactionSchema1700000000033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_credit_transaction"
        ADD COLUMN IF NOT EXISTS "tenant_id" uuid,
        ADD COLUMN IF NOT EXISTS "transaction_type" varchar(30) NOT NULL DEFAULT 'CHARGE',
        ADD COLUMN IF NOT EXISTS "note" text,
        ADD COLUMN IF NOT EXISTS "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();
    `);

    // Ensure type column if exists is dropped or synced
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customer_credit_transaction' AND column_name='type') THEN
          ALTER TABLE "customer_credit_transaction" ALTER COLUMN "type" DROP NOT NULL;
          UPDATE "customer_credit_transaction" SET "transaction_type" = "type" WHERE "transaction_type" IS NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reversible if needed
  }
}
