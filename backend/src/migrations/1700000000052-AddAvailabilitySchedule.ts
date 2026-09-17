import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Weekly selling windows for a product or a category (breakfast 07:00–11:00, a Friday dish).
 * Items without a window stay on sale as before.
 */
export class AddAvailabilitySchedule1700000000052 implements MigrationInterface {
  name = 'AddAvailabilitySchedule1700000000052';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "availability_schedule" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "product_id" uuid,
        "category_id" uuid,
        "branch_id" uuid,
        "days_of_week" character varying(20) NOT NULL,
        "start_time" character varying(5) NOT NULL,
        "end_time" character varying(5) NOT NULL,
        "label" character varying(80),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_availability_schedule" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_availability_schedule_target" CHECK ((product_id IS NOT NULL) <> (category_id IS NOT NULL))
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_availability_schedule_product" ON "availability_schedule" ("tenant_id", "product_id");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_availability_schedule_category" ON "availability_schedule" ("tenant_id", "category_id");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "availability_schedule";`);
  }
}
