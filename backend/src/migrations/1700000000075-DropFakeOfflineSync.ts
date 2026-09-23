import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The in-app "offline sync engine" was a simulation: a fake queue, conflicts and branch status
 * that no branch ever wrote to. The branch agent now keeps a real snapshot and uploads real
 * offline orders (agent_data_snapshot, agent_sync_order), so its tables go.
 */
export class DropFakeOfflineSync1700000000075 implements MigrationInterface {
  name = 'DropFakeOfflineSync1700000000075';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['sync_conflict_record', 'offline_queue_item', 'sync_category_log', 'branch_status_snapshot']) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }

  public async down(): Promise<void> {
    // The simulation is not brought back; its tables held only demo rows.
  }
}
