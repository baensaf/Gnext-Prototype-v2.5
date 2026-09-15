import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How a courier is paid, kept apart from what the customer is charged. A courier carries a
 * pay rule (a fixed amount, the zone's listed delivery fee, or a per-zone courier rate); a
 * zone may name that rate; a delivery records which rule priced it; and each courier's
 * attempt carries its own pay, so a failed ride and the delivery that followed are paid
 * separately and a settlement can deduct them.
 *
 * Delivered attempts take the pay already snapshotted on their delivery, so batches opened
 * after this migration net out work done before it.
 */
export class AddCourierPayRules1700000000051 implements MigrationInterface {
  name = 'AddCourierPayRules1700000000051';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "courier"
        ADD COLUMN IF NOT EXISTS "pay_mode" character varying(20) NOT NULL DEFAULT 'FLAT';
    `);
    await queryRunner.query(`
      ALTER TABLE "delivery_zone"
        ADD COLUMN IF NOT EXISTS "courier_pay" numeric(19,4);
    `);
    await queryRunner.query(`
      ALTER TABLE "delivery"
        ADD COLUMN IF NOT EXISTS "compensation_basis" character varying(20);
    `);
    await queryRunner.query(`
      ALTER TABLE "delivery_assignment"
        ADD COLUMN IF NOT EXISTS "compensation_amount" numeric(12,2) NOT NULL DEFAULT 0;
    `);
    await queryRunner.query(`
      UPDATE "delivery_assignment" da
         SET "compensation_amount" = ROUND(d."compensation_amount", 2)
        FROM "delivery" d
       WHERE d."tenant_id" = da."tenant_id"
         AND d."order_id" = da."order_id"
         AND d."courier_id" = da."courier_id"
         AND da."status" = 'DELIVERED';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_assignment" DROP COLUMN IF EXISTS "compensation_amount";`);
    await queryRunner.query(`ALTER TABLE "delivery" DROP COLUMN IF EXISTS "compensation_basis";`);
    await queryRunner.query(`ALTER TABLE "delivery_zone" DROP COLUMN IF EXISTS "courier_pay";`);
    await queryRunner.query(`ALTER TABLE "courier" DROP COLUMN IF EXISTS "pay_mode";`);
  }
}
