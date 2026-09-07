import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeliveryZoneToOrder1700000000044 implements MigrationInterface {
  name = 'AddDeliveryZoneToOrder1700000000044';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "order_header" ADD COLUMN IF NOT EXISTS "delivery_zone_id" uuid;');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_order_header_delivery_zone" ON "order_header" ("delivery_zone_id");');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_order_header_delivery_zone";');
    await queryRunner.query('ALTER TABLE "order_header" DROP COLUMN IF EXISTS "delivery_zone_id";');
  }
}
