import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The shown-only ("fake") Snappfood discount is gone (2026-10-12): a discount on Snappfood is
 * a real item discount now. Strip its two keys, `display_discount_percent` and
 * `item_display_discounts`, from every stored CHANNEL_PRICING setting; the markup and the
 * rounding step stay.
 */
export class FakeDiscountOut1700000000122 implements MigrationInterface {
  name = 'FakeDiscountOut1700000000122';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "tenant_setting"
         SET "value" = COALESCE((
               SELECT jsonb_object_agg(e.key,
                        CASE WHEN jsonb_typeof(e.value) = 'object'
                             THEN e.value - 'display_discount_percent' - 'item_display_discounts'
                             ELSE e.value END)
                 FROM jsonb_each("value") AS e
             ), '{}'::jsonb)
       WHERE "key" = 'CHANNEL_PRICING' AND jsonb_typeof("value") = 'object'
    `);
  }

  public async down(): Promise<void> {
    // The shown discount is not coming back.
  }
}
