import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What the till's Online orders panel needs to keep about an aggregator order. The rider the
 * platform sent and how far they have got (Snappfood's bikerName and bikerStatusV2), and an
 * alert the cashier must see: the platform cancelled an order the kitchen already had, or the
 * time limit turned one down. The alert stays on the panel until someone marks it seen.
 */
export class OnlineOrderPanel1700000000099 implements MigrationInterface {
  name = 'OnlineOrderPanel1700000000099';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_header"
        ADD COLUMN IF NOT EXISTS "aggregator_rider_name" character varying(100),
        ADD COLUMN IF NOT EXISTS "aggregator_rider_status" character varying(20),
        ADD COLUMN IF NOT EXISTS "online_alert" character varying(30),
        ADD COLUMN IF NOT EXISTS "online_alert_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "online_alert_seen_at" TIMESTAMP WITH TIME ZONE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_header"
        DROP COLUMN IF EXISTS "online_alert_seen_at",
        DROP COLUMN IF EXISTS "online_alert_at",
        DROP COLUMN IF EXISTS "online_alert",
        DROP COLUMN IF EXISTS "aggregator_rider_status",
        DROP COLUMN IF EXISTS "aggregator_rider_name";
    `);
  }
}
