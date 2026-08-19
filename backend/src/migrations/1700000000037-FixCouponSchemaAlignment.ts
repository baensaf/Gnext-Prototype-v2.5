import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixCouponSchemaAlignment1700000000037 implements MigrationInterface {
  name = 'FixCouponSchemaAlignment1700000000037';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "coupon"
        ADD COLUMN IF NOT EXISTS "campaign_id" uuid,
        ADD COLUMN IF NOT EXISTS "discount_id" uuid,
        ADD COLUMN IF NOT EXISTS "max_uses" integer,
        ADD COLUMN IF NOT EXISTS "uses_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "effective_from" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "effective_to" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "created_by" uuid,
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "updated_by" uuid,
        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Non-destructive down
  }
}
