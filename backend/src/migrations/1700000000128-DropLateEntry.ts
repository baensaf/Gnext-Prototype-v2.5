import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Late entry is gone (2026-10-14). A forgotten order is rung up now like any other, as Toast and
 * Square do; a card already charged on another reader is recorded from its slip in the pay
 * dialog. The order no longer carries a late-entry flag, reason, served time or approver.
 */
export class DropLateEntry1700000000128 implements MigrationInterface {
  name = 'DropLateEntry1700000000128';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "late_entry_approved_by"`);
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "late_served_at"`);
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "late_entry_reason"`);
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "is_late_entry"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "is_late_entry" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "late_entry_reason" varchar(255)`);
    await queryRunner.query(`ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "late_served_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "late_entry_approved_by" uuid`);
  }
}
