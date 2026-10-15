import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A print job is waiting, printed or failed, as in Toast and Square (K-20, 2026-10-15). The
 * removed states fold into Failed: "check printer" (UNCERTAIN), a kitchen chit expired at the
 * cutoff, one set aside on purpose (DISMISSED), and an unsent chit taken back (REPLACED,
 * CANCELLED). Reprint is the only thing a person does with a failed job now.
 */
export class PrintJobThreeStates1700000000136 implements MigrationInterface {
  name = 'PrintJobThreeStates1700000000136';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "print_job" SET "status" = 'FAILED'
       WHERE "status" IN ('UNCERTAIN', 'EXPIRED', 'DISMISSED', 'REPLACED', 'CANCELLED')
    `);
  }

  public async down(): Promise<void> {
    // The old states cannot be told apart once folded; nothing to undo.
  }
}
