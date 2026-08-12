import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingPaymentAndSettlementColumns1700000000026 implements MigrationInterface {
  name = 'AddMissingPaymentAndSettlementColumns1700000000026';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "settlement_account" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(40) NOT NULL,
        "name" character varying(120) NOT NULL,
        "account_type" character varying(40) NOT NULL DEFAULT 'BANK',
        "masked_identifier" character varying(80),
        "currency_code" character varying(3) NOT NULL DEFAULT 'IRR',
        "is_company_owned" boolean NOT NULL DEFAULT true,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_settlement_account" PRIMARY KEY ("id")
      );

      ALTER TABLE "settlement_account"
        ADD COLUMN IF NOT EXISTS "account_type" character varying(40) DEFAULT 'BANK',
        ADD COLUMN IF NOT EXISTS "masked_identifier" character varying(80),
        ADD COLUMN IF NOT EXISTS "currency_code" character varying(3) DEFAULT 'IRR',
        ADD COLUMN IF NOT EXISTS "is_company_owned" boolean DEFAULT true,
        ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_device" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid,
        "code" character varying(40) NOT NULL,
        "name" character varying(120) NOT NULL,
        "kind" character varying(30) NOT NULL DEFAULT 'POS',
        "ownership" character varying(30) NOT NULL DEFAULT 'COMPANY',
        "settlement_account_id" uuid,
        "device_identifier" character varying(120),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_device" PRIMARY KEY ("id")
      );

      ALTER TABLE "payment_device"
        ADD COLUMN IF NOT EXISTS "branch_id" uuid,
        ADD COLUMN IF NOT EXISTS "kind" character varying(30) DEFAULT 'POS',
        ADD COLUMN IF NOT EXISTS "ownership" character varying(30) DEFAULT 'COMPANY',
        ADD COLUMN IF NOT EXISTS "settlement_account_id" uuid,
        ADD COLUMN IF NOT EXISTS "device_identifier" character varying(120),
        ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op for safety
  }
}
