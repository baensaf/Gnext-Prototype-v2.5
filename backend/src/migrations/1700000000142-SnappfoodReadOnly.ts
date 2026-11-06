import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A branch can read its Snappfood orders while another system answers them (the parallel run
 * beside HAMI). The connection says so and when it last read; each Snappfood order keeps the
 * last status Snappfood gave it, so a read that brings nothing new changes nothing.
 */
export class SnappfoodReadOnly1700000000142 implements MigrationInterface {
  name = 'SnappfoodReadOnly1700000000142';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "snappfood_connection" ADD COLUMN IF NOT EXISTS "read_only" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "snappfood_connection" ADD COLUMN IF NOT EXISTS "last_read_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "snappfood_connection" ADD COLUMN IF NOT EXISTS "last_read_error" text`);
    await queryRunner.query(`ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "aggregator_status_code" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_header" DROP COLUMN IF EXISTS "aggregator_status_code"`);
    await queryRunner.query(`ALTER TABLE "snappfood_connection" DROP COLUMN IF EXISTS "last_read_error"`);
    await queryRunner.query(`ALTER TABLE "snappfood_connection" DROP COLUMN IF EXISTS "last_read_at"`);
    await queryRunner.query(`ALTER TABLE "snappfood_connection" DROP COLUMN IF EXISTS "read_only"`);
  }
}
