import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixOrderItemOptionSchema1700000000021 implements MigrationInterface {
  name = 'FixOrderItemOptionSchema1700000000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add missing tenant_id, option_group_name, option_item_name, and price_delta to order_item_option table
    await queryRunner.query(`
      ALTER TABLE "order_item_option"
        ADD COLUMN IF NOT EXISTS "tenant_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "option_group_name" varchar(160) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "option_item_name" varchar(160) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "price_delta" numeric(19, 4) NOT NULL DEFAULT '0.0000';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback logic if needed
  }
}
