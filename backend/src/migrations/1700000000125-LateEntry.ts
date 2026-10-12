import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Late entry (2026-10-12): an order that was served and paid for but never rung up is rung up
 * now, with a manager's PIN, and carries the reason. Nothing is backdated: the order has the
 * time, shift and business day of the moment it is entered. `late_served_at` is the cashier's
 * rough guess of when it really went out, kept only to explain the entry.
 */
export class LateEntry1700000000125 implements MigrationInterface {
  name = 'LateEntry1700000000125';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "is_late_entry" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "late_entry_reason" varchar(255)`);
    await queryRunner.query(`ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "late_served_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "late_entry_approved_by" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "late_entry_approved_by"`);
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "late_served_at"`);
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "late_entry_reason"`);
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "is_late_entry"`);
  }
}
