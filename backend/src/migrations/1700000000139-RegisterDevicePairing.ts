import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A register knows which device it is paired with (2026-10-19). Until now only the device's
 * browser knew which register it was, so a lost or retired PC could be cut off only by
 * archiving its register. One device per register, as in Toast and Square: pairing a second
 * device moves the register to it. `last_seen_at` was already there, never written.
 */
export class RegisterDevicePairing1700000000139 implements MigrationInterface {
  name = 'RegisterDevicePairing1700000000139';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "terminal" ADD COLUMN IF NOT EXISTS "device_id" uuid`);
    await queryRunner.query(`ALTER TABLE "terminal" ADD COLUMN IF NOT EXISTS "device_name" varchar(160)`);
    await queryRunner.query(`ALTER TABLE "terminal" ADD COLUMN IF NOT EXISTS "device_paired_at" timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of ['device_paired_at', 'device_name', 'device_id']) {
      await queryRunner.query(`ALTER TABLE "terminal" DROP COLUMN IF EXISTS "${column}"`);
    }
  }
}
