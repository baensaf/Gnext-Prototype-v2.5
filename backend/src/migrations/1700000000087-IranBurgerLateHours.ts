import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Iran Burger's opening hours, as the product manager gave them on 2026-10-01: every branch
 * opens at 11:00 and closes at 04:00 the next morning, every day. The seed had applied the
 * Balad listings' hours (mostly closing at midnight), and the seed never replaces hours a
 * branch already has, so the demo chain's selling branches are set here once.
 *
 * Only the seeded demo tenant is touched, and only its Iran Burger storefronts (codes TEH-*
 * and SHZ-*, not the commissary). The same hours are in `IRANBURGER_CHAIN_HOURS` for a fresh
 * seed; they are written out here so this migration keeps doing what it did if that changes.
 */
export class IranBurgerLateHours1700000000087 implements MigrationInterface {
  name = 'IranBurgerLateHours1700000000087';

  /** The tenant the seed creates; see DEFAULT_TENANT_ID in src/seed.ts. */
  private readonly demoTenantId = 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const branches: Array<{ id: string }> = await queryRunner.query(
      `SELECT id FROM branch
        WHERE tenant_id = $1 AND deleted_at IS NULL AND branch_type = 'RESTAURANT'
          AND (code LIKE 'TEH-%' OR code LIKE 'SHZ-%')`,
      [this.demoTenantId],
    );
    for (const { id } of branches) {
      await queryRunner.query(`DELETE FROM branch_operating_hour WHERE tenant_id = $1 AND branch_id = $2`, [
        this.demoTenantId,
        id,
      ]);
      for (let day = 0; day < 7; day++) {
        await queryRunner.query(
          `INSERT INTO branch_operating_hour (tenant_id, branch_id, day_of_week, open_time, close_time, is_closed, spans_midnight)
           VALUES ($1, $2, $3, '11:00:00', '04:00:00', false, true)`,
          [this.demoTenantId, id, day],
        );
      }
    }
  }

  public async down(): Promise<void> {
    // The hours before were demo data; there is nothing to put back.
  }
}
