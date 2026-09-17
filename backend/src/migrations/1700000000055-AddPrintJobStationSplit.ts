import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Kitchen tickets are split per print route: a burger, fries and a drink become one chit per
 * station. Each job remembers the printer group it was routed to and the station label printed
 * on it, so the print queue can say which station a chit belongs to.
 */
export class AddPrintJobStationSplit1700000000055 implements MigrationInterface {
  name = 'AddPrintJobStationSplit1700000000055';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "print_job"
        ADD COLUMN IF NOT EXISTS "printer_group_id" uuid,
        ADD COLUMN IF NOT EXISTS "label" character varying(160);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "print_job"
        DROP COLUMN IF EXISTS "label",
        DROP COLUMN IF EXISTS "printer_group_id";
    `);
  }
}
