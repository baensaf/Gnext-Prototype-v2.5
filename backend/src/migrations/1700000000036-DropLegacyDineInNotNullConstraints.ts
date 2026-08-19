import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropLegacyDineInNotNullConstraints1700000000036 implements MigrationInterface {
  name = 'DropLegacyDineInNotNullConstraints1700000000036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "dining_area" ALTER COLUMN "branch_id" DROP NOT NULL;

      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dining_table' AND column_name='area_id') THEN
          ALTER TABLE "dining_table" ALTER COLUMN "area_id" DROP NOT NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dining_table' AND column_name='number') THEN
          ALTER TABLE "dining_table" ALTER COLUMN "number" DROP NOT NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dining_table' AND column_name='capacity') THEN
          ALTER TABLE "dining_table" ALTER COLUMN "capacity" DROP NOT NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Non-destructive down
  }
}
