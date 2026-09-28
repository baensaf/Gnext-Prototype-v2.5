import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A courier becomes a user of the system with the Courier role, so the Android tracking app
 * can sign them in later. The courier row keeps what delivery needs (vehicle, pay, card
 * reader) and points at the account; the account holds who they are and where they work.
 *
 * Every courier already on file gets an account now. Its username is the mobile number in
 * its +98 form, or the courier code when there is no number; the password is no hash at all,
 * because a courier cannot sign in yet and nothing should verify against it.
 */
export class CourierAccounts1700000000082 implements MigrationInterface {
  name = 'CourierAccounts1700000000082';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "courier" ADD COLUMN IF NOT EXISTS "user_id" uuid NULL`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_courier_user" ON "courier" ("user_id") WHERE "user_id" IS NOT NULL`,
    );

    const couriers: Array<{ id: string; tenant_id: string; branch_id: string | null; code: string; name: string; phone: string | null; is_active: boolean }> =
      await queryRunner.query(`SELECT id, tenant_id, branch_id, code, name, phone, is_active FROM "courier" WHERE "user_id" IS NULL`);

    for (const courier of couriers) {
      const base = courierUsername(courier.phone, courier.code);
      let username = base;
      const taken = await queryRunner.query(
        `SELECT 1 FROM "admin_user" WHERE "tenant_id" = $1 AND lower("username") = lower($2) LIMIT 1`,
        [courier.tenant_id, username],
      );
      if (taken.length) username = `${base}-${courier.code}`.toLowerCase().slice(0, 80);

      const [user] = await queryRunner.query(
        `INSERT INTO "admin_user" ("tenant_id", "username", "display_name", "password_hash", "role", "branch_id", "is_active", "preferred_locale")
         VALUES ($1, $2, $3, '!courier-no-sign-in', 'COURIER', $4, $5, 'fa') RETURNING "id"`,
        [courier.tenant_id, username, courier.name, courier.branch_id, courier.is_active],
      );
      await queryRunner.query(`UPDATE "courier" SET "user_id" = $1 WHERE "id" = $2`, [user.id, courier.id]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "admin_user" WHERE "role" = 'COURIER' AND "id" IN (SELECT "user_id" FROM "courier" WHERE "user_id" IS NOT NULL)`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_courier_user"`);
    await queryRunner.query(`ALTER TABLE "courier" DROP COLUMN IF EXISTS "user_id"`);
  }
}

/** The mobile number in its +98 form, as the customer module stores numbers; else the code. */
function courierUsername(phone: string | null, code: string): string {
  const digits = (phone || '').replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[^\d+]/g, '');
  if (digits.startsWith('09') && digits.length === 11) return `+98${digits.slice(1)}`;
  if (digits.startsWith('989') && digits.length === 12) return `+${digits}`;
  if (digits) return digits.startsWith('+') ? digits : `+${digits}`;
  return code.toLowerCase();
}
