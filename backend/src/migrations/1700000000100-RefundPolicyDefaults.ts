import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The refund service now reads each payment method's refund policy, and every method had
 * `allows_alternative_refund` off, which would refuse paying a card sale back in cash or
 * card-to-card — the only ways an Iranian terminal's sale can go back. Card methods start on.
 *
 * A refund is now made and settled in one transaction, so none is left half-done. Ones left
 * PENDING or PROCESSING by the old two-step flow never paid anything out; they are closed as
 * abandoned so nothing can settle them later on top of a refund that did.
 */
export class RefundPolicyDefaults1700000000099 implements MigrationInterface {
  name = 'RefundPolicyDefaults1700000000099';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "payment_method" SET "allows_alternative_refund" = true
        WHERE "kind" IN ('CARD_POS', 'NETWORK_POS', 'CARD', 'MOBILE_POS')`,
    );
    await queryRunner.query(
      `UPDATE "refund" SET "status" = 'FAILED', "failure_code" = 'ABANDONED',
              "failure_message" = 'Left unfinished by the old two-step refund; nothing was paid out'
        WHERE "status" IN ('PENDING', 'PROCESSING')`,
    );
  }

  public async down(): Promise<void> {
    // Data only: which methods were off before, and which refunds were pending, is not kept.
  }
}
