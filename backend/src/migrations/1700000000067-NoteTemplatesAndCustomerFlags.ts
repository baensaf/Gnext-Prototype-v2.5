import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Three small additions that the till and the directory were missing:
 *
 * - `note_template`: the fixed phrases a cashier taps instead of typing a note.
 * - `customer.birth_date`: a plain date, no zone — see the entity.
 * - `customer.is_blocked` and friends: refusing to serve someone, which is not the same as
 *   retiring their record (`is_active`) or stopping their credit (the credit account's own
 *   `is_blocked`, which this deliberately does not touch).
 */
export class NoteTemplatesAndCustomerFlags1700000000067 implements MigrationInterface {
  name = 'NoteTemplatesAndCustomerFlags1700000000067';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "note_template" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "scope" character varying(20) NOT NULL DEFAULT 'ITEM',
        "text" character varying(200) NOT NULL,
        "category" character varying(60),
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" uuid,
        CONSTRAINT "PK_note_template" PRIMARY KEY ("id")
      )
    `);

    // The till asks for one tenant's active phrases of one scope, in display order, on
    // every note popover.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_note_template_lookup"
        ON "note_template" ("tenant_id", "scope", "is_active", "sort_order")
    `);

    // The same phrase twice in the picker is a data-entry slip, not a choice.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_note_template_text"
        ON "note_template" ("tenant_id", "scope", "text")
    `);

    await queryRunner.query(`ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "birth_date" date`);
    await queryRunner.query(`ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "is_blocked" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "blocked_reason" text`);
    await queryRunner.query(`ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "blocked_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "blocked_by" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN IF EXISTS "blocked_by"`);
    await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN IF EXISTS "blocked_at"`);
    await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN IF EXISTS "blocked_reason"`);
    await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN IF EXISTS "is_blocked"`);
    await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN IF EXISTS "birth_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_note_template_text"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_note_template_lookup"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "note_template"`);
  }
}
