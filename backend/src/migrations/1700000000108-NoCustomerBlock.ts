import { MigrationInterface, QueryRunner } from 'typeorm';

/** Blocking a customer is gone (2026-10-10). */
export class NoCustomerBlock1700000000108 implements MigrationInterface {
  name = 'NoCustomerBlock1700000000108';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const column of ['is_blocked', 'blocked_reason', 'blocked_at', 'blocked_by']) {
      await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN IF EXISTS "${column}"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "is_blocked" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "blocked_reason" text`);
    await queryRunner.query(`ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "blocked_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "blocked_by" uuid`);
  }
}
