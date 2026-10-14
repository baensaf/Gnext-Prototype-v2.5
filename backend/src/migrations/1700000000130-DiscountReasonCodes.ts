import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The till's discount reasons are reason codes now (2026-10-14), kept on Settings → Reason codes
 * with the other reasons, instead of a fixed list in the POS screen. Each tenant gets the five
 * the till offered, scoped to DISCOUNT. FRIENDS_FAMILY keeps its meaning: it applies the
 * friends-and-family exclusions.
 */
const DISCOUNT_REASONS: Array<[string, string]> = [
  ['CUSTOMER_SATISFACTION', 'رضایت مشتری / مهمان‌نوازی'],
  ['FRIENDS_FAMILY', 'تخفیف اختصاصی'],
  ['STAFF_DISCOUNT', 'تخفیف کارکنان'],
  ['DAMAGED_ITEM', 'ایراد جزئی / مشکل بسته‌بندی'],
  ['VIP_COURTESY', 'عضو ویژه باشگاه'],
];

export class DiscountReasonCodes1700000000130 implements MigrationInterface {
  name = 'DiscountReasonCodes1700000000130';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [code, name] of DISCOUNT_REASONS) {
      await queryRunner.query(
        `INSERT INTO "reason_code" ("tenant_id", "code", "name", "type", "applies_to")
         SELECT t."id", $1::varchar, $2::varchar, 'DISCOUNT', ARRAY['DISCOUNT']::varchar[]
           FROM "tenant" t
          WHERE NOT EXISTS (SELECT 1 FROM "reason_code" r WHERE r."tenant_id" = t."id" AND r."code" = $1::varchar)`,
        [code, name],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "reason_code" WHERE "type" = 'DISCOUNT' AND "code" = ANY($1)`,
      [DISCOUNT_REASONS.map(([code]) => code)],
    );
  }
}
