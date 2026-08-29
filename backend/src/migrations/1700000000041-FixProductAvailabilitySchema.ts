import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixProductAvailabilitySchema1700000000041 implements MigrationInterface {
  name = 'FixProductAvailabilitySchema1700000000041';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ensure product_availability has all required entity columns
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_availability" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "branch_id" uuid,
        "channel" varchar(32),
        "is_suspended" boolean NOT NULL DEFAULT false,
        "suspended_until" timestamptz,
        "reason" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`ALTER TABLE "product_availability" ADD COLUMN IF NOT EXISTS "channel" varchar(32); `);
    await queryRunner.query(`ALTER TABLE "product_availability" ADD COLUMN IF NOT EXISTS "is_suspended" boolean NOT NULL DEFAULT false;`);
    await queryRunner.query(`ALTER TABLE "product_availability" ADD COLUMN IF NOT EXISTS "suspended_until" timestamptz;`);
    await queryRunner.query(`ALTER TABLE "product_availability" ADD COLUMN IF NOT EXISTS "created_at" timestamptz NOT NULL DEFAULT now();`);
    await queryRunner.query(`ALTER TABLE "product_availability" ALTER COLUMN "branch_id" DROP NOT NULL;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Non-destructive down
  }
}
