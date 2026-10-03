import { MigrationInterface, QueryRunner } from 'typeorm';
import { trackBusinessDayChange } from '../common/utils/business-clock';
import { BUSINESS_DAY_SETTING_KEY } from '../common/utils/business-day';

/**
 * The default business-day cutoff moves from 04:00 to 05:00 (Branch Management spec,
 * 2026-10-03): it should fall after the latest closing time, and Iran Burger closes at 04:00.
 *
 * A chain whose head-office setting still holds the old default moves to the new one. Branch
 * overrides are someone's choice and stay. The change goes through the branches' timelines like
 * any cutoff change, so it applies from now on and nothing already dated moves.
 */
export class BusinessDayCutoffFive1700000000089 implements MigrationInterface {
  name = 'BusinessDayCutoffFive1700000000089';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: { tenant_id: string }[] = await queryRunner.query(
      `SELECT "tenant_id" FROM "tenant_setting"
        WHERE "key" = $1 AND "branch_id" IS NULL AND "value"->>'cutoff' = '04:00'`,
      [BUSINESS_DAY_SETTING_KEY],
    );
    for (const { tenant_id } of rows) {
      await trackBusinessDayChange(queryRunner.manager, tenant_id, () =>
        queryRunner.query(
          `UPDATE "tenant_setting" SET "value" = jsonb_set("value", '{cutoff}', '"05:00"')
            WHERE "tenant_id" = $1 AND "key" = $2 AND "branch_id" IS NULL`,
          [tenant_id, BUSINESS_DAY_SETTING_KEY],
        ),
      );
    }
  }

  public async down(): Promise<void> {
    // A cutoff change is recorded on each branch's timeline; it is not undone.
  }
}
