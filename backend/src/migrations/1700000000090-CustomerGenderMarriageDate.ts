import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two optional fields asked for on the register form (2026-10-03): gender and wedding date.
 * Both feed the customer club later (greetings, anniversary offers); V1 only records them.
 */
export class CustomerGenderMarriageDate1700000000090 implements MigrationInterface {
  name = 'CustomerGenderMarriageDate1700000000090';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "gender" varchar(10)`);
    await queryRunner.query(`ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "marriage_date" date`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "customer" ADD CONSTRAINT "CHK_customer_gender" CHECK ("gender" IS NULL OR "gender" IN ('MALE', 'FEMALE'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "customer" DROP CONSTRAINT IF EXISTS "CHK_customer_gender"`);
    await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN IF EXISTS "marriage_date"`);
    await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN IF EXISTS "gender"`);
  }
}
