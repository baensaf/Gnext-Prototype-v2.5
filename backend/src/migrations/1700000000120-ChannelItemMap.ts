import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Our menu as an aggregator knows it (simulated Snappfood menu sync, 2026-10-12): one integer
 * per category, product, type, add-on group and add-on per channel, and the aggregator's own
 * codes per branch. See ChannelItemMap.
 */
export class ChannelItemMap1700000000120 implements MigrationInterface {
  name = 'ChannelItemMap1700000000120';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "channel_item_map" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "channel" varchar(32) NOT NULL,
        "entity_type" varchar(16) NOT NULL,
        "entity_id" uuid NOT NULL,
        "external_id" integer NOT NULL,
        "channel_codes" jsonb NOT NULL DEFAULT '{}',
        "synced_at" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_channel_item_map_entity" ON "channel_item_map" ("tenant_id", "channel", "entity_type", "entity_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_channel_item_map_external" ON "channel_item_map" ("tenant_id", "channel", "external_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "channel_item_map"`);
  }
}
