import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reports are down to the V2 set (2026-10-10). Saved views and the async export jobs are out;
 * a plain export is built and returned in the same request, so it keeps no row.
 */
export class ReportsToV2Set1700000000109 implements MigrationInterface {
  name = 'ReportsToV2Set1700000000109';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "report_export_job"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "saved_report_view"`);
  }

  public async down(): Promise<void> {
    // Not restored: the feature is gone.
  }
}
