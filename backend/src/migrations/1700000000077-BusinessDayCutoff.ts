import { MigrationInterface, QueryRunner } from 'typeorm';
import { DEFAULT_BUSINESS_DAY, isTimeZone, wallClock } from '../common/utils/business-day';

/**
 * The overnight business day: a 04:00 cutoff, 08:00–04:00 opening hours, and the day closed by
 * itself once its shifts are counted (common/utils/business-day.ts).
 *
 * Nothing already stored is re-dated. Every business_date written so far stays as it is, and so
 * do the days already closed. Each branch is given a timeline that says: until now the day
 * turned over at midnight on the business clock (BUSINESS_TIME_ZONE, which is what every date
 * so far was read on); from now on it turns over at the cutoff on the branch's own clock, never
 * earlier than the date midnight had already reached. So a deploy at 02:00 keeps that night on
 * the new date rather than sending the tills back to yesterday, and the first night after it is
 * the first one dated the new way.
 *
 * Auto-close starts from today: an older day nobody closed is left for a person to deal with.
 *
 * Refunds gain a business_date of their own. Old refunds keep none, and are read the old way.
 */
export class BusinessDayCutoff1700000000077 implements MigrationInterface {
  name = 'BusinessDayCutoff1700000000077';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "branch" ADD COLUMN IF NOT EXISTS "business_day_timeline" jsonb NULL`);
    await queryRunner.query(`ALTER TABLE "refund" ADD COLUMN IF NOT EXISTS "business_date" varchar(10) NULL`);

    // Every chain gets head office's rule written down, so the settings screen shows it and a
    // branch override has something to differ from.
    await queryRunner.query(
      `INSERT INTO "tenant_setting" ("tenant_id", "branch_id", "key", "value", "schema_version")
       SELECT t."id", NULL, 'BUSINESS_DAY', $1::jsonb, 1
         FROM "tenant" t
        WHERE NOT EXISTS (
          SELECT 1 FROM "tenant_setting" s
           WHERE s."tenant_id" = t."id" AND s."key" = 'BUSINESS_DAY' AND s."branch_id" IS NULL
        )`,
      [JSON.stringify(DEFAULT_BUSINESS_DAY)],
    );

    const legacyZone = isTimeZone(process.env.BUSINESS_TIME_ZONE) ? process.env.BUSINESS_TIME_ZONE! : 'Asia/Tehran';
    const now = new Date();
    const legacyToday = wallClock(now, legacyZone).date;
    const branches: { id: string; branch_zone: string | null; tenant_zone: string | null }[] = await queryRunner.query(
      `SELECT b."id", b."time_zone" AS branch_zone, t."time_zone" AS tenant_zone
         FROM "branch" b JOIN "tenant" t ON t."id" = b."tenant_id"
        WHERE b."business_day_timeline" IS NULL`,
    );
    for (const b of branches) {
      const zone = isTimeZone(b.branch_zone) ? b.branch_zone! : isTimeZone(b.tenant_zone) ? b.tenant_zone! : legacyZone;
      const timeline = {
        since: legacyToday,
        rules: [
          { cutoff: '00:00', time_zone: legacyZone, at: null, from: null },
          { cutoff: DEFAULT_BUSINESS_DAY.cutoff, time_zone: zone, at: now.toISOString(), from: legacyToday },
        ],
      };
      await queryRunner.query(`UPDATE "branch" SET "business_day_timeline" = $1::jsonb WHERE "id" = $2`, [
        JSON.stringify(timeline),
        b.id,
      ]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "tenant_setting" WHERE "key" = 'BUSINESS_DAY'`);
    await queryRunner.query(`ALTER TABLE "refund" DROP COLUMN IF EXISTS "business_date"`);
    await queryRunner.query(`ALTER TABLE "branch" DROP COLUMN IF EXISTS "business_day_timeline"`);
  }
}
