import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `file_asset` holds uploaded files (product photos). The entity has been registered since the
 * media module landed, but no migration ever created its table, and the schema is managed by
 * migrations only, so every upload failed. `IF NOT EXISTS` in case a database got it by hand.
 */
export class FileAssets1700000000065 implements MigrationInterface {
  name = 'FileAssets1700000000065';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "file_asset" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "storage_kind" varchar(20) NOT NULL DEFAULT 'LOCAL',
        "file_path" varchar(255) NOT NULL,
        "mime_type" varchar(100) NOT NULL,
        "size_bytes" bigint NOT NULL,
        "checksum_sha256" char(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid,
        CONSTRAINT "pk_file_asset" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "ix_file_asset_tenant" ON "file_asset" ("tenant_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "file_asset"`);
  }
}
