import { MigrationInterface, QueryRunner } from 'typeorm';

/** Moadian e-invoicing is out of the prototype (2026-10-10): its invoices and its setting go. */
export class NoMoadian1700000000105 implements MigrationInterface {
  name = 'NoMoadian1700000000105';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tax_invoice"`);
    await queryRunner.query(`DELETE FROM "tenant_setting" WHERE "key" = 'MOADIAN'`);
  }

  public async down(): Promise<void> {
    // Not restored: the feature is gone.
  }
}
